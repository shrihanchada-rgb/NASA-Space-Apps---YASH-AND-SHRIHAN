"""Build the editable NASA Space Apps submission deck. Run: python submission/build_slides.py"""
import json
from pathlib import Path
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

ROOT = Path(__file__).resolve().parent.parent
prs = Presentation(); prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)
BG='101B24'; PAPER='F6F3EC'; MUTED='B3C0C4'; ACCENT='FFB86C'; TEAL='79D1BA'; PURPLE='D8BEFF'
def rgb(c): return RGBColor.from_string(c)
def rect(s,x,y,w,h,color):
    sh=s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h)); sh.fill.solid(); sh.fill.fore_color.rgb=rgb(color); sh.line.fill.background(); return sh
def text(s, x,y,w,h, value, size=20, color=PAPER, bold=False, font='Aptos', align=None):
    box=s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h)); tf=box.text_frame; tf.clear(); tf.word_wrap=True
    tf.margin_left=tf.margin_right=Inches(.02); tf.margin_top=Inches(.02); tf.margin_bottom=0
    p=tf.paragraphs[0]; p.text=value; p.font.name=font; p.font.size=Pt(size); p.font.bold=bold; p.font.color.rgb=rgb(color)
    if align: p.alignment=align
    return box
def slide(kicker,title,sub=None):
    s=prs.slides.add_slide(prs.slide_layouts[6]); s.background.fill.solid(); s.background.fill.fore_color.rgb=rgb(BG)
    text(s,.65,.35,11,.28,kicker.upper(),10,TEAL,True); text(s,.65,.85,12,1.0,title,32,PAPER,True)
    if sub: text(s,.68,1.82,11.9,.55,sub,15,MUTED)
    rect(s,.65,7.1,12,.012,'40535A'); text(s,.68,7.17,10,.2,'YASH + SHRIHAN  /  NASA SPACE APPS',9,MUTED,True); text(s,12,7.14,.6,.25,f'{len(prs.slides):02}',10,MUTED,align=PP_ALIGN.RIGHT)
    return s
def pic(s,path,x,y,w): s.shapes.add_picture(str(ROOT/path), Inches(x), Inches(y), width=Inches(w))
def line(s,x,y,n,title,body):
    text(s,x,y,.5,.5,n,18,ACCENT,True); text(s,x+.55,y,5.3,.4,title,20,PAPER,True); text(s,x+.55,y+.48,5.2,.75,body,15,MUTED)

s=slide('NASA Space Apps Challenge','Califire', 'A clearer record of California’s satellite-detected fire activity')
text(s,.7,2.7,5.7,1.2,'See the past.\nExplore what comes next.',30,PAPER,True)
text(s,.72,4.55,5.4,1,'A harmonized fire calendar with an experimental seven-day Timestral forecast.',18,MUTED)
pic(s,'docs/demo/1-latest-home.png',7.0,2.37,5.65)
text(s,.72,6.55,5,.3,'YASH  +  SHRIHAN  /  MAIN PROJECT REPOSITORY',12,TEAL,True)

s=slide('01  /  The challenge & data','From satellite detections to a shared scale','MODIS and VIIRS detect different numbers of hotspots. We harmonize NASA FIRMS observations onto one comparable scale.')
for x,n,t,b in [(0.8,'01','Collect','MODIS + VIIRS detections'),(3.9,'02','Clean & grid','Filter, deduplicate and clip'),(7.0,'03','Harmonize','Learn monthly conversion factors'),(10.1,'04','Explore','Calendar, map and downloads')]:
    rect(s,x,3.0,2.55,2.1,'20333D'); text(s,x+.2,3.2,2,.3,n,12,TEAL,True); text(s,x+.2,3.72,2.2,.4,t,19,PAPER,True); text(s,x+.2,4.3,2.15,.6,b,14,MUTED)
text(s,.85,5.8,11.6,.7,'Missing satellite observations stay missing. Counts describe detected hotspots, not individual fires or burned area.',17,ACCENT)

s=slide('02  /  Updated features','Explore the record at different scales','Draw an area or enter coordinates; Latest, Archive, comparisons and CSV downloads follow the same selection.')
pic(s,'docs/demo/2-map-area.png',.7,2.5,6.0); pic(s,'docs/demo/5-archive-2020.png',6.85,2.5,5.8)
text(s,.8,6.38,5.7,.3,'MAP  /  Select an area and inspect daily details',13,TEAL,True); text(s,6.95,6.38,5.7,.3,'ARCHIVE  /  Compare seasons and anomalies',13,TEAL,True)

# Plot the forecast from this repository; never substitute the reference repository's output.
forecast=json.loads((ROOT/'data/processed/regions/US-CA/forecast.json').read_text())
s=slide('03  /  Timestral forecast','Timestral-5M, on our harmonized counts','730 days of log-transformed counts feed Timestral-5M. Missing days stay missing. Output: seven days with percentile bounds.')
cd=CategoryChartData(); cd.categories=[v['date'][5:] for v in forecast['predictions']]
for key,label in [('q10','10th percentile'),('median','Median'),('q90','90th percentile')]: cd.add_series(label,[v[key] for v in forecast['predictions']])
chart=s.shapes.add_chart(XL_CHART_TYPE.LINE, Inches(.85), Inches(2.6), Inches(7.3), Inches(3.8), cd).chart
chart.has_legend=True; chart.legend.position=XL_LEGEND_POSITION.BOTTOM; chart.legend.include_in_layout=False; chart.legend.font.size=Pt(11); chart.legend.font.color.rgb=rgb(PAPER)
for axis in (chart.category_axis,chart.value_axis): axis.tick_labels.font.size=Pt(11); axis.tick_labels.font.color.rgb=rgb(PAPER)
chart.value_axis.minimum_scale=0
for series,col in zip(chart.series,[MUTED,PURPLE,TEAL]): series.format.line.color.rgb=rgb(col); series.format.line.width=Pt(2)
text(s,8.65,2.85,3.8,.3,'ARCHIVE FORECAST',12,PURPLE,True)
text(s,8.65,3.4,3.8,.7,'1-7 Sep 2026',27,PAPER,True)
text(s,8.65,4.35,3.7,1.5,'Origin: 31 Aug 2026. Purple days on Latest show medians and 10th-90th percentile bounds, in MODIS-equivalent hotspots/day.',18,MUTED)
text(s,.85,6.55,11.6,.3,'Source: data/processed/regions/US-CA/forecast.json in the Yash-Shrihan repository. Historical projection; not a live forecast.',11,ACCENT)

s=slide('04  /  Validation','Useful context, with clear limits','Retrospective seven-day forecasts: starts on the 1st and 15th of each month in 2023–2025; 504 reported days scored.')
for x,title,value,desc in [(0.8,'TIMESTRAL','14.6','mean absolute error'),(4.9,'PERSISTENCE','14.4','repeat last observed day'),(9.0,'SEASONAL','18.9','median of earlier years')]:
    rect(s,x,2.85,3.55,1.85,'20333D'); text(s,x+.2,3.05,3,.3,title,11,TEAL,True); text(s,x+.2,3.45,3,.65,value,32,PAPER,True); text(s,x+.2,4.2,3,.35,desc,13,MUTED)
text(s,.85,5.15,11.7,.95,'The model underestimates the busiest 10% of days. Its 10th–90th percentile interval covered 76% of scored days. This is not a wildfire risk or emergency tool.',17,ACCENT)
text(s,.85,6.35,11.7,.3,'Backtest uses the current archive, not data as it was available at each historical start.',12,MUTED)

s=slide('05  /  Impact & next steps','Turn observations into understanding','Califire makes long-term fire activity easier to inspect, compare and communicate.')
line(s,.75,2.65,'01','Investigate','Explore timing and geography with maps and a burning calendar.')
line(s,.75,4.0,'02','Verify','Download data and inspect the harmonization and forecast methods.')
line(s,.75,5.35,'03','Extend','Add more recent observations and evaluate forecasts prospectively before claiming live usefulness.')
text(s,7.6,3.05,4.5,1.6,'Thank you.',36,PAPER,True); text(s,7.65,4.7,4.5,.9,'NASA FIRMS  ·  MODIS  ·  VIIRS\nMistral Timestral-5M',16,MUTED)

s=slide('06  /  Project & evidence','Built in the Yash-Shrihan repository','Implementation, data, validation and submission materials live together in the main project.')
for y,title,url in [(2.65,'Main project: NASA Space Apps - Yash and Shrihan','https://github.com/shrihanchada-rgb/NASA-Space-Apps---YASH-AND-SHRIHAN'),(3.65,'Project website','https://shrihanchada-rgb.github.io/NASA-Space-Apps---YASH-AND-SHRIHAN/'),(4.65,'Forecast method attribution: yashneil75/califire (MIT)','https://github.com/yashneil75/califire'),(5.65,'Timestral model and inference code','https://github.com/mistralai/timestral')]:
    box=text(s,.8,y,11.8,.4,title,20,TEAL,True); box.text_frame.paragraphs[0].runs[0].hyperlink.address=url
    text(s,.8,y+.43,11.8,.3,url,11,MUTED)

# Speaker notes identify the main project and the evidence snapshot.
for sl in prs.slides:
    sl.notes_slide.notes_text_frame.text = ('Main project: shrihanchada-rgb/NASA-Space-Apps---YASH-AND-SHRIHAN. '
        'Snapshot d58fa86 plus local forecasting reliability/deployment updates. '
        'Feature evidence: web/README.md and docs/demo.md. Forecast values and backtest: '
        'data/processed/regions/US-CA/forecast.json. Archive ends 2026-08-31. '
        'Forecast method adapted from yashneil75/califire; inference uses Mistral Timestral-5M.')

assert len(prs.slides) == 7, 'Submission must contain exactly seven slides'
out=ROOT/'submission/Yash-Shrihan-Submission.pptx'; prs.save(out); print(f'Wrote {out} ({len(prs.slides)} slides)')
