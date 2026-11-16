"""Refresh provisional FIRMS observations after the immutable standard-processing archive.

No Drive files are needed. Replaces each fetched source/date window (never appends
revisions), reuses the published calibration, and stages the whole result before
contract and arithmetic checks. The incomplete current UTC day is excluded.
"""
from __future__ import annotations
import argparse
import calendar
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from datetime import date, datetime, timedelta, timezone
import time
import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
import config

def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'pipeline' / file)
    obj = importlib.util.module_from_spec(spec); spec.loader.exec_module(obj); return obj

agg = module('aggregate06', '06_aggregate.py')
SOURCES = {'MODIS_NRT': ('T', 'A'), 'VIIRS_SNPP_NRT': ('N',),
           'VIIRS_NOAA20_NRT': ('N20',), 'VIIRS_NOAA21_NRT': ('N21',)}
KEYS = ['date', 'time_utc', 'latitude', 'longitude', 'satellite']
NOTE = ('Provisional near-real-time observations after the standard archive; refreshed nightly. '
        'NRT has not undergone standard-processing quality control. Where NASA omits fire type, '
        'nominal/high-confidence thermal anomalies are retained without a vegetation-only classification. '
        'The current UTC day is incomplete and excluded. Gaps are missing, never fabricated zeros.')

def read(path): return json.loads(Path(path).read_text(encoding='utf-8'))
def write(path, value):
    Path(path).write_text(json.dumps(value, allow_nan=False, separators=(',', ':'))+'\n', encoding='utf-8')
def dates(a, b):
    while a <= b:
        yield a
        a += timedelta(days=1)

def get_csv(endpoint, key):
    # Never emit response bodies, exception URLs, or the MAP_KEY into logs.
    for attempt in range(4):
        try:
            response = requests.get(f'{config.API_BASE}/{endpoint.format(key=key)}', timeout=120)
            if response.status_code == 200:
                text = response.text
                first = text.splitlines()[0] if text.splitlines() else ''
                if ',' in first and 'Invalid' not in first:
                    return pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False)
        except requests.RequestException:
            pass
        if attempt < 3: time.sleep(2 ** attempt)
    raise RuntimeError('FIRMS request failed; check key, API availability and transaction limits. No output published.')

def normalize(raw, source):
    sensor = 'MODIS' if source == 'MODIS_NRT' else 'VIIRS'
    required = {'latitude','longitude','acq_date','acq_time','satellite','confidence','frp','daynight'}
    if not required <= set(raw.columns): raise ValueError(f'{source}: unexpected FIRMS columns')
    d = pd.DataFrame(index=raw.index)
    d['date'] = pd.to_datetime(raw['acq_date'], format='%Y-%m-%d', errors='raise').dt.strftime('%Y-%m-%d')
    d['time_utc'] = raw['acq_time'].str.zfill(4)
    if not d['time_utc'].str.fullmatch(r'([01]\d|2[0-3])[0-5]\d').all(): raise ValueError('Invalid observation time')
    d['satellite'] = raw['satellite'].map(config.SATELLITE_CODES)
    if d['satellite'].isna().any() or not d['satellite'].isin(SOURCES[source]).all(): raise ValueError('Unexpected satellite')
    for col in ('latitude','longitude','frp'):
        d[col] = pd.to_numeric(raw[col], errors='raise')
        if not np.isfinite(d[col]).all(): raise ValueError('Non-finite observation')
    if not d.latitude.between(-90,90).all() or not d.longitude.between(-180,180).all() or (d.frp < 0).any(): raise ValueError('Invalid coordinates or FRP')
    if sensor == 'MODIS':
        conf = pd.to_numeric(raw.confidence, errors='raise')
        if not conf.between(0,100).all(): raise ValueError('Invalid confidence')
        d['confidence'] = np.where(conf >= 80,'high',np.where(conf >= 30,'nominal','low'))
    else:
        d['confidence'] = raw.confidence.map(config.VIIRS_CONFIDENCE)
        if d.confidence.isna().any(): raise ValueError('Invalid confidence')
    d['sensor'], d['source'], d['daynight'] = sensor, source, raw.daynight
    if not d.daynight.isin(['D','N']).all(): raise ValueError('Invalid day/night')
    # Outage evidence uses ALL anomalies before filtering, in the download box.
    counts = d.groupby(['date','satellite']).size()
    keep = d.confidence.isin(['nominal','high'])
    if 'type' in raw: keep &= pd.to_numeric(raw['type'], errors='raise').eq(0)
    return d[keep].drop_duplicates(KEYS, keep='last').copy(), counts

def intervals(flags):
    out=[]; start=last=None
    for day, flag in flags:
        if flag:
            if start is None: start=day
            last=day
        elif start is not None:
            out.append((start,last)); start=last=None
    if start is not None: out.append((start,last))
    return out

def replace_window(old, new, source, first, last):
    keep = ~((old.source == source) & old.date.between(first, last)) if not old.empty else []
    retained = old.loc[keep] if len(old) else old
    parts = [frame for frame in (retained,new) if not frame.empty]
    return pd.concat(parts,ignore_index=True).drop_duplicates(KEYS,keep='last') if parts else old.iloc[:0].copy()

def refresh(folder, key, closed_day, fetch=get_csv):
    folder=Path(folder); region='US-CA'; rdir=folder/'regions'/region
    meta=read(folder/'metadata.json'); original=read(rdir/'daily.json')
    if meta['is_sample']: raise ValueError('Refusing to update sample data')
    sp=[s for s in meta['sources'] if s['source'].endswith('_SP')]
    cutoff=max(date.fromisoformat(s['last_date']) for s in sp)
    if cutoff.day != calendar.monthrange(cutoff.year,cutoff.month)[1]: raise ValueError('Archive must end on a complete month before NRT extension')
    first=cutoff+timedelta(days=1)
    if closed_day < first: raise ValueError('No completed UTC days after the archive')
    state=read(rdir/'nrt-state.json') if (rdir/'nrt-state.json').exists() else {'coverage':{},'counts':{}}
    state.update(schema_version=meta['schema_version'], method_version=meta['method_version'], is_sample=False)
    old=[]
    for path in sorted((rdir/'hotspots').glob('*.csv')):
        if path.stem >= first.strftime('%Y-%m'):
            d=pd.read_csv(path,dtype={'date':str,'time_utc':str}); old.append(d)
    points=pd.concat(old,ignore_index=True) if old else pd.DataFrame(columns=agg.HOTSPOT_COLUMNS+['source'])
    if len(points):
        points['source']=points.satellite.map({'T':'MODIS_NRT','A':'MODIS_NRT','N':'VIIRS_SNPP_NRT','N20':'VIIRS_NOAA20_NRT','N21':'VIIRS_NOAA21_NRT'})
    available=fetch('data_availability/csv/{key}/all',key)
    if not {'data_id','min_date','max_date'} <= set(available.columns): raise ValueError('Unexpected availability response')
    latest=first-timedelta(days=1)
    for source,sats in SOURCES.items():
        rows=available[available.data_id == source]
        coverage=set(state['coverage'].get(source,[]))
        if len(rows):
            lo=max(first,date.fromisoformat(rows.iloc[0].min_date)); hi=min(closed_day,date.fromisoformat(rows.iloc[0].max_date))
            latest=max(latest,hi) if hi >= lo else latest
            # Fill missed days and re-fetch the most recent 14 available days for NRT revisions.
            needed=[d for d in dates(lo,hi) if d.isoformat() not in coverage or d >= closed_day-timedelta(days=13)]
            for a,b in intervals((d,d in set(needed)) for d in dates(lo,hi)):
                cursor=a
                while cursor <= b:
                    n=min(5,(b-cursor).days+1); end=cursor+timedelta(days=n-1)
                    box=','.join(str(v) for v in config.REGIONS[region]['bbox'])
                    raw=fetch(f'area/csv/{{key}}/{source}/{box}/{n}/{cursor.isoformat()}',key)
                    new,counts=normalize(raw,source)
                    if len(new) and not new.date.between(cursor.isoformat(),end.isoformat()).all(): raise ValueError('FIRMS returned dates outside request')
                    points=replace_window(points,new,source,cursor.isoformat(),end.isoformat())
                    for day in dates(cursor,end):
                        stamp=day.isoformat(); coverage.add(stamp)
                        for sat in sats: state['counts'][f'{stamp}/{sat}']=int(counts.get((stamp,sat),0))
                    cursor=end+timedelta(days=1)
        state['coverage'][source]=sorted(coverage)
        if coverage: latest=max(latest,date.fromisoformat(max(coverage)))
    if latest < closed_day-timedelta(days=3): raise ValueError('FIRMS data is more than three days old; existing site retained')
    end=min(closed_day,latest)
    points=points[points.date.between(first.isoformat(),end.isoformat())].copy()
    mask=agg.grid04.RegionMask(region,agg.grid04.load_polygons(region))
    sla,slo=agg.grid04.sub_index(points.latitude.to_numpy(dtype=float),points.longitude.to_numpy(dtype=float))
    keep=mask.contains(sla,slo); points=points[keep].copy()
    points['lat_idx']=sla[keep]//agg.grid04.SUB_PER_CELL; points['lon_idx']=slo[keep]//agg.grid04.SUB_PER_CELL
    # Every unavailable source/day is explicitly missing, including archive-to-NRT gaps.
    outages=pd.read_csv(rdir/'satellite_outages.csv').to_dict('records')
    outages=[o for o in outages if o['end'] <= cutoff.isoformat()]
    for source,sats in SOURCES.items():
        coverage=set(state['coverage'][source])
        for sat in sats:
            flags=[]
            for day in dates(first,end):
                stamp=day.isoformat(); missing=stamp not in coverage
                if sat in ('N','N20','N21'): missing |= state['counts'].get(f'{stamp}/{sat}',0)==0
                flags.append((stamp,missing))
            # MODIS multi-day outages need contradicting observations from the other platform.
            if sat in ('T','A'):
                other='A' if sat=='T' else 'T'
                for a,b in intervals((d,state['counts'].get(f'{d}/{sat}',0)==0 and d in coverage) for d,_ in flags):
                    ds=list(dates(date.fromisoformat(a),date.fromisoformat(b)))
                    if len(ds)>=agg.MODIS_RUN_DAYS and sum(state['counts'].get(f'{d.isoformat()}/{other}',0) for d in ds)>=agg.MODIS_RUN_OTHER:
                        flags=[(d,flag or a<=d<=b) for d,flag in flags]
            for a,b in intervals(flags):
                outages.append({'satellite':sat,'start':a,'end':b,'days':(date.fromisoformat(b)-date.fromisoformat(a)).days+1,'evidence':'NRT unavailable or outage inferred from unfiltered download-box counts'})
    ranges={s['source']:(date.fromisoformat(s['first_date']),date.fromisoformat(s['last_date'])) for s in sp}
    for source in SOURCES:
        pseudo=source.replace('_NRT','_SP'); a,b=ranges[pseudo]
        covered=state['coverage'][source]
        if covered: ranges[pseudo]=(a,max(b,min(end,date.fromisoformat(max(covered)))))
    h=agg.load_harmonization(region)
    with tempfile.TemporaryDirectory(prefix='califire-refresh-') as tmp:
        staged=Path(tmp)/'processed'; shutil.copytree(folder,staged)
        tail=Path(tmp)/'tail'
        result=agg.build_region(region,tail,h,datetime.now(timezone.utc).date().isoformat(),outages=outages,mask=mask,points=points,ranges=ranges,log=lambda _:None)
        tr=tail/'regions'/region; dest=staged/'regions'/region
        daily=read(tr/'daily.json'); old_n=(cutoff-date.fromisoformat(original['start'])).days+1
        for col,values in daily['columns'].items(): daily['columns'][col]=original['columns'][col][:old_n]+values[old_n:]
        write(dest/'daily.json',daily)
        monthly=read(tr/'monthly.json'); oldmonths=read(rdir/'monthly.json')['months']
        monthly['months']=[m for m in oldmonths if date(m['year'],m['month'],1)<=cutoff]+[m for m in monthly['months'] if date(m['year'],m['month'],1)>cutoff]
        # Keep enough precision for sparse provisional months as well as daily/point consistency.
        for month in monthly['months']:
            if date(month['year'],month['month'],1)>cutoff and month['count_harm'] is not None:
                a=date(month['year'],month['month'],1)
                b=min(end,date(month['year'],month['month'],calendar.monthrange(month['year'],month['month'])[1]))
                vals=daily['columns']['count_harm'][(a-date.fromisoformat(daily['start'])).days:(b-date.fromisoformat(daily['start'])).days+1]
                month['count_harm']=round(sum(v for v in vals if v is not None),4)
                month['count_low']=min(month['count_low'],month['count_harm'])
                month['count_high']=max(month['count_high'],month['count_harm'])
        write(dest/'monthly.json',monthly)
        g0=pd.read_csv(rdir/'grid_monthly.csv'); g1=pd.read_csv(tr/'grid_monthly.csv')
        keep=(g0.year*100+g0.month <= cutoff.year*100+cutoff.month)
        pd.concat([g0[keep],g1],ignore_index=True).to_csv(dest/'grid_monthly.csv',index=False)
        for oldfile in (dest/'hotspots').glob('*.csv'):
            if oldfile.stem>=first.strftime('%Y-%m'): oldfile.unlink()
        for newfile in (tr/'hotspots').glob('*.csv'): shutil.copyfile(newfile,dest/'hotspots'/newfile.name)
        pd.DataFrame(outages,columns=['satellite','start','end','days','evidence']).to_csv(dest/'satellite_outages.csv',index=False)
        meta['sources']=sp.copy()
        for source in SOURCES:
            covered=state['coverage'][source]
            if covered: meta['sources'].append({'source':source,'first_date':min(covered),'last_date':min(max(covered),end.isoformat()),'n_detections_kept':int((points.source==source).sum())})
        meta['time_coverage']['end']=daily['end']; meta['build_date']=daily['build_date']
        meta['reference_scale']=meta['reference_scale'].split(' Provisional near-real-time')[0]+' '+NOTE
        meta['filters']['types_kept']=[0,1,2,3]  # NRT may omit classification; disclose instead of inventing type=0.
        meta['known_gaps']=[g for g in meta['known_gaps'] if g['end']<=cutoff.isoformat()]
        meta['known_gaps'] += [{'start':o['start'],'end':o['end'],'sensor':'MODIS' if o['satellite'] in ('T','A') else 'VIIRS','note':o['satellite']+': '+o['evidence']} for o in outages if o['start']>cutoff.isoformat() and o['days']>=3]
        write(staged/'metadata.json',meta); write(dest/'nrt-state.json',state)
        # Existing baseline stays fixed; provisional months never change the historical reference distribution.
        # Nothing is published unless BOTH schema consistency and independent arithmetic checks pass.
        subprocess.run([sys.executable,str(ROOT/'scripts/validate_data.py'),str(staged)],check=True)
        subprocess.run([sys.executable,str(ROOT/'pipeline/06b_audit_processed.py'),'--folder',str(staged)],check=True)
        shutil.copytree(staged,folder,dirs_exist_ok=True)
        for oldfile in (rdir/'hotspots').glob('*.csv'):
            if not (dest/'hotspots'/oldfile.name).exists(): oldfile.unlink()
    print(f'Refreshed California through {daily["end"]}; NRT starts after {cutoff}.')

def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('--data',type=Path,default=ROOT/'data/processed'); p.add_argument('--through',type=date.fromisoformat)
    args=p.parse_args(); key=os.environ.get('FIRMS_MAP_KEY','').strip()
    if not key: raise SystemExit('Set the FIRMS_MAP_KEY Actions secret; never paste it into logs or code.')
    closed=datetime.now(timezone.utc).date()-timedelta(days=1)
    if args.through and args.through>closed: raise SystemExit('Cannot publish the incomplete current UTC day')
    refresh(args.data,key,args.through or closed)
if __name__=='__main__': main()
