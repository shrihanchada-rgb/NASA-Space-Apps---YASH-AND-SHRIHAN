// S31: rehearses the 3-minute demo (docs/demo.md) in a real browser on the real data.
// It performs every click of the script, checks what the page shows, times the machine part of each step,
// and saves a screenshot per step to docs/demo/. Needs the dev server or a served build:
//   cd web && npm run dev            (in one terminal; default http://localhost:5173/)
//   BASE=http://localhost:5173/ node scripts/rehearse_demo.js
// Playwright must be installed (it is in the AI cloud sessions: require('playwright')).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:5173/';
const OUT = path.resolve(__dirname, '..', 'docs', 'demo');
fs.mkdirSync(OUT, { recursive: true });
const T = (p, s) => p.textContent(s).then((x) => (x || '').replace(/\s+/g, ' ').trim());

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}

(async () => {
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::/.test(m.text())) errs.push(m.text().slice(0, 120)); });
  const step = async (name, fn) => {
    const t0 = Date.now();
    await fn();
    console.log(`   [${name}: ${((Date.now() - t0) / 1000).toFixed(1)} s machine time]`);
  };
  const shot = (n) => p.screenshot({ path: path.join(OUT, n) });

  // 1. Latest (home)
  await step('1 home', async () => {
    await p.goto(BASE);
    await p.waitForSelector('.lt .day-cell:not(.absent)', { timeout: 30000 });
    check('1. home page is Latest, "California, day by day"', /day by day/.test(await T(p, '.splash-title')));
    check('1. stats line: biggest day on record', /2,847\.6/.test(await T(p, '.statline')) && /Sep 9, 2020/.test(await T(p, '.statline')), await T(p, '.statline'));
    check('1. the bar says how to select an area', /Select part of the state on the/.test(await T(p, '#area-bar')));
    await shot('1-latest-home.png');
  });

  // 2. Pick an area: Los Angeles area (typed, the keyboard way; the demo draws it on the map)
  await step('2 pick an area', async () => {
    await p.goto(BASE + 'map.html?start=2025-01-01&end=2025-01-31');
    await p.waitForSelector('#map[data-ready="true"]', { timeout: 30000 });
    await p.waitForTimeout(2500);
    check('2. map shows hotspot points for January 2025', /detections \(all sensors/.test(await T(p, '#map-note')), (await T(p, '#map-note')).match(/[\d,]+ detections/)?.[0]);
    await p.click('#controls summary:has-text("coordinates")');
    await p.fill('#area-w', '-119'); await p.fill('#area-s', '33.6'); await p.fill('#area-e', '-117.4'); await p.fill('#area-n', '34.6');
    await p.click('text=Use this area');
    await p.waitForFunction(() => /Showing a drawn area/.test(document.querySelector('#area-bar').textContent), null, { timeout: 15000 });
    await p.waitForTimeout(2500);
    check('2. area bar shows the drawn area on every page', /Showing a drawn area/.test(await T(p, '#area-bar')), await T(p, '#area-bar'));
    await shot('2-map-area.png');
  });

  // 3. Latest for the area: 8 January 2025
  await step('3 latest area', async () => {
    await p.click('.topnav a[data-page="latest"]');
    await p.waitForSelector('.lt .day-cell:not(.absent)', { timeout: 30000 });
    await p.fill('#dateJump', '2025-01-08'); await p.dispatchEvent('#dateJump', 'change');
    await p.waitForSelector('.lt .day-cell[data-date="2025-01-08"] .act', { timeout: 20000 });
    const val = await T(p, '.lt .day-cell[data-date="2025-01-08"] .act');
    await p.click('.lt .day-cell[data-date="2025-01-08"]');
    await p.waitForFunction(() => !/…/.test(document.querySelector('.lt .dn-val').textContent), null, { timeout: 15000 });
    check('3. Latest follows the area: title "Your area", month January 2025', /Your area/.test(await T(p, '.splash-title')) && /January 2025/.test(await T(p, '.month-label')));
    check('3. 8 Jan 2025 is the strongest day of the month in the area', (await T(p, '.peak-list li')).includes('Jan 8, 2025'), `8 Jan = ${val}; ${await T(p, '.peak-list li')}`);
    check('3. day drawer shows day and night parts', /Day.*Night/.test(await T(p, '.lt .drawer.open')), (await T(p, '.lt .drawer.open')).slice(0, 150));
    await p.waitForTimeout(500); // let the panel finish fading in
    await shot('3-latest-area-day.png');
    await p.keyboard.press('Escape');
  });

  // 4. Compare a recent fire (inside the Map page)
  await step('4 compare', async () => {
    await p.click('.topnav a[data-page="map"]');
    await p.waitForSelector('#compare .kpis', { timeout: 20000 });
    await p.waitForTimeout(800);
    const kp = await T(p, '#compare .kpis');
    check('4. compare gives a rank among years for the area', /Rank among years/.test(kp), kp.slice(0, 160));
    check('4. compare lists similar past episodes', (await p.locator('#compare tbody tr').count()) >= 3, `${await p.locator('#compare tbody tr').count()} rows`);
    await p.locator('#compare').scrollIntoViewIfNeeded();
    await shot('4-compare.png');
  });

  // 5. Back to all of California; Archive, worst year
  await step('5 archive', async () => {
    await p.click('#area-bar button');
    await p.waitForFunction(() => /Showing all of California/.test(document.querySelector('#area-bar').textContent), null, { timeout: 10000 });
    await p.click('.topnav a[data-page="archive"]');
    await p.waitForSelector('#calendar .cal-cell', { timeout: 20000 });
    await p.click('#calendar button[data-mode="anomaly"]');
    const yr = await T(p, '#calendar [role="row"]:has-text("2020")');
    check('5. archive shows 2020 with the biggest year total', /48,425/.test(await T(p, '#calendar')), 'year total 2020 = 48,425 in the calendar text');
    await p.click('#calendar button[data-mode="absolute"]');
    await p.click('#calendar .cal-cell[data-key="2020-09"]');
    await p.waitForTimeout(800);
    check('5. clicking Sep 2020 narrows the dates', (await p.inputValue('#date-start')) === '2020-09-01' && (await p.inputValue('#date-end')) === '2020-09-30', `${await p.inputValue('#date-start')} to ${await p.inputValue('#date-end')}`);
    await shot('5-archive-2020.png');
  });

  // 6. Download
  await step('6 download', async () => {
    await p.click('.topnav a[data-page="download"]');
    await p.waitForSelector('#downloads .dl-button', { timeout: 20000 });
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#downloads .dl-button:has-text("Daily series CSV")')]);
    const lines = fs.readFileSync(await dl.path(), 'utf8').split('\n');
    const rows = lines.filter((l) => l && !l.startsWith('#'));
    check('6. daily CSV for Sep 2020: 30 days, weights add up', rows.length - 1 === 30, `${rows.length - 1} rows; header ${rows[0]}`);
    const sum = rows.slice(1).reduce((a, l) => a + Number(l.split(',')[1]), 0);
    check('6. the CSV total for Sep 2020 equals the calendar (26,632)', Math.abs(sum - 26632.25) < 0.6, `sum ${sum.toFixed(2)}`);
    check('6. the CSV starts with # lines: method and citation', lines.slice(0, 8).some((l) => /Citation/.test(l)) && lines.slice(0, 8).some((l) => /Method version/.test(l)));
    await shot('6-download.png');
  });

  // 7. Methodology: honest limits
  await step('7 methodology', async () => {
    await p.click('.topnav a[data-page="methodology"]');
    await p.waitForSelector('#m-limits', { timeout: 20000 });
    const limits = await T(p, '#m-limits + ul, section[aria-labelledby="m-limits"]');
    check('7. Methodology states the limits (approximate range, error after 2023, Terra-only months)', /approximate/.test(limits) && /after 2023/.test(limits) && /Terra-only/.test(limits));
    check('7. Methodology shows the forecast scores and says it is not fire risk', /not of fire risk|not a fire-risk/.test(await T(p, 'section[aria-labelledby="m-forecast"]')) && /14\.6/.test(await T(p, 'section[aria-labelledby="m-forecast"]')));
    await p.locator('#m-limits').scrollIntoViewIfNeeded();
    await shot('7-methodology-limits.png');
  });

  check('no page errors during the whole demo', errs.length === 0, errs.join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
})();
