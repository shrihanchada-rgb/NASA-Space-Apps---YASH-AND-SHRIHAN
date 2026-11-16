"""Offline tests for nightly updates; synthetic NRT never touches the published folder."""
import importlib.util
from pathlib import Path
from datetime import date
import shutil
import pandas as pd
import pytest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('refresh08',ROOT/'pipeline/08_refresh_nrt.py')
r=importlib.util.module_from_spec(spec); spec.loader.exec_module(r)

def rows(day, satellite, confidence='80'):
    return {'latitude':'34.05','longitude':'-118.25','acq_date':day,'acq_time':'1200',
            'satellite':satellite,'confidence':confidence,'frp':'5.0','daynight':'D'}

def archive_copy(folder):
    # Tests stay independent of whichever provisional dates are currently published.
    shutil.copytree(ROOT/'data/processed',folder)
    meta=r.read(folder/'metadata.json'); rd=folder/'regions/US-CA'
    meta['sources']=[v for v in meta['sources'] if v['source'].endswith('_SP')]
    cutoff=max(v['last_date'] for v in meta['sources'])
    meta['time_coverage']['end']=cutoff
    meta['known_gaps']=[v for v in meta['known_gaps'] if v['end']<=cutoff]
    r.write(folder/'metadata.json',meta)
    daily=r.read(rd/'daily.json'); n=(date.fromisoformat(cutoff)-date.fromisoformat(daily['start'])).days+1
    daily['end']=cutoff; daily['columns']={k:v[:n] for k,v in daily['columns'].items()}; r.write(rd/'daily.json',daily)
    monthly=r.read(rd/'monthly.json'); monthly['months']=[m for m in monthly['months'] if f"{m['year']}-{m['month']:02d}"<=cutoff[:7]]; r.write(rd/'monthly.json',monthly)
    grid=pd.read_csv(rd/'grid_monthly.csv'); grid=grid[grid.year*100+grid.month<=int(cutoff[:4])*100+int(cutoff[5:7])]; grid.to_csv(rd/'grid_monthly.csv',index=False)
    outages=pd.read_csv(rd/'satellite_outages.csv'); outages[outages.end<=cutoff].to_csv(rd/'satellite_outages.csv',index=False)
    for p in (rd/'hotspots').glob('*.csv'):
        if p.stem>cutoff[:7]: p.unlink()
    (rd/'nrt-state.json').unlink(missing_ok=True)


def test_missing_type_is_not_fabricated_and_low_confidence_is_removed():
    d=pd.DataFrame([rows('2026-09-01','Terra'),rows('2026-09-01','Aqua','10')])
    points, counts=r.normalize(d,'MODIS_NRT')
    assert list(points.satellite)==['T']
    assert counts.sum()==2 and 'type' not in points


def test_revisions_replace_a_window_without_double_counting():
    old,_=r.normalize(pd.DataFrame([rows('2026-09-01','Terra')]),'MODIS_NRT')
    new=old.copy(); new['frp']=7
    got=r.replace_window(old,new,'MODIS_NRT','2026-09-01','2026-09-01')
    assert len(got)==1 and got.iloc[0].frp==7


def test_update_failure_leaves_published_data_unchanged(tmp_path):
    folder=tmp_path/'data'; archive_copy(folder)
    before=(folder/'regions/US-CA/daily.json').read_bytes()
    def fail(*args): raise RuntimeError('offline')
    with pytest.raises(RuntimeError): r.refresh(folder,'fake-not-a-key',date(2026,9,2),fetch=fail)
    assert (folder/'regions/US-CA/daily.json').read_bytes()==before


def test_full_refresh_keeps_archive_and_is_idempotent(tmp_path):
    folder=tmp_path/'data'; archive_copy(folder)
    before=r.read(folder/'regions/US-CA/daily.json')
    def fake(endpoint,key):
        if endpoint.startswith('data_availability'):
            return pd.DataFrame([{'data_id':s,'min_date':'2026-09-02','max_date':'2026-09-03'} for s in r.SOURCES])
        source=endpoint.split('/')[3]
        # one nominal/high anomaly per platform on each requested day, all synthetic
        records=[rows(d,sat,'80' if source=='MODIS_NRT' else 'n')
                 for d in ['2026-09-02','2026-09-03'] for sat in r.SOURCES[source]]
        return pd.DataFrame(records)
    r.refresh(folder,'fake-not-a-key',date(2026,9,3),fetch=fake)
    after=r.read(folder/'regions/US-CA/daily.json')
    assert after['end']=='2026-09-03'
    assert after['columns']['count_harm'][-3] is None  # unavailable September 1 stays missing
    for col,values in before['columns'].items(): assert after['columns'][col][:len(values)]==values
    assert all(v>0 for v in after['columns']['count_harm'][-2:])
    r.refresh(folder,'fake-not-a-key',date(2026,9,3),fetch=fake)
    assert r.read(folder/'regions/US-CA/daily.json')['columns']==after['columns']
