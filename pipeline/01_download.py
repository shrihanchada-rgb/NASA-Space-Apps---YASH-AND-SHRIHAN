"""Step 1: download FIRMS standard-processing (SP) hotspots for one region into data/raw/.

Reads the key from the FIRMS_MAP_KEY environment variable (Colab Secrets) or from a local .env
file. The key is never printed. Downloads are resumable: finished chunks are skipped.

Examples:
  python3 pipeline/01_download.py --check-availability
  python3 pipeline/01_download.py --region US-CA --year 2023
  python3 pipeline/01_download.py --region US-CA --start 2000-11-01 --end 2026-10-31
  python3 pipeline/01_download.py --region US-CA --year 2023 --dry-run
"""
import argparse
import collections
import csv
import datetime as dt
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"


class FirmsError(Exception):
    pass


def load_key():
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    env = ROOT / ".env"
    if not key and env.exists():
        for line in env.read_text().splitlines():
            if line.strip().startswith("FIRMS_MAP_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        raise FirmsError("No FIRMS_MAP_KEY found. Set it in Colab Secrets or in a local .env file (see README S03).")
    return key


def mask(text, key):
    return text.replace(key, "<MAP_KEY>") if key else text


def chunks(start, end, size=config.MAX_DAY_RANGE):
    """Split [start, end] into windows of at most `size` days. Yields (first_day, n_days)."""
    d = start
    while d <= end:
        n = min(size, (end - d).days + 1)
        yield d, n
        d += dt.timedelta(days=n)


def source_dates(source, availability=None):
    """(first, last) dates for a source: from data/raw/data_availability.csv if present, else config."""
    path = availability if availability is not None else RAW / "data_availability.csv"
    if path and Path(path).exists():
        for row in csv.DictReader(Path(path).read_text().splitlines()):
            if row.get("data_id") == source:
                return dt.date.fromisoformat(row["min_date"]), dt.date.fromisoformat(row["max_date"])
    return config.SOURCES[source]


def clip_to_source(source, start, end, availability=None):
    first, last = source_dates(source, availability)
    s, e = max(start, first), min(end, last) if last else end
    return (s, e) if s <= e else None


SUMMARY_COLUMNS = ("satellite", "instrument", "confidence", "version", "daynight", "type")


def value_summary(texts, columns=SUMMARY_COLUMNS, top=8):
    """Count the values seen in a few columns, to confirm formats (e.g. confidence letters)."""
    counts = {c: collections.Counter() for c in columns}
    for text in texts:
        for row in csv.DictReader(text.splitlines()):
            for c in columns:
                if c in row:
                    counts[c][row[c]] += 1
    return {c: counts[c].most_common(top) for c in columns if counts[c]}


class RateLimiter:
    """Keeps the number of 'transactions' (we count 1 per day requested) under a budget per window."""

    def __init__(self, budget=config.TRANSACTION_BUDGET, window=config.WINDOW_SECONDS, clock=time.monotonic, sleep=time.sleep):
        self.budget, self.window, self.clock, self.sleep = budget, window, clock, sleep
        self.events = collections.deque()

    def take(self, cost):
        while True:
            now = self.clock()
            while self.events and now - self.events[0][0] >= self.window:
                self.events.popleft()
            used = sum(c for _, c in self.events)
            if used + cost <= self.budget:
                self.events.append((now, cost))
                return
            wait = self.window - (now - self.events[0][0]) + 1
            print(f"  rate limit: waiting {wait:.0f} s")
            self.sleep(wait)


def http_get(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "fire-calendar-pipeline"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def fetch(url, key, get=http_get, retries=4, sleep=time.sleep):
    """GET with retries for network/5xx errors. Raises FirmsError for answers that are not CSV."""
    for attempt in range(retries + 1):
        try:
            text = get(url)
            break
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace").strip()[:200] if hasattr(e, "read") else ""
            if e.code < 500 or attempt == retries:
                raise FirmsError(f"HTTP {e.code}: {body or e.reason} ({mask(url, key)})") from None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if attempt == retries:
                raise FirmsError(f"network error: {e} ({mask(url, key)})") from None
        sleep(min(60, 5 * 2 ** attempt))
    first = text.lstrip().split("\n", 1)[0]
    if "," not in first:
        raise FirmsError(f"FIRMS did not return CSV: {first[:200]!r} ({mask(url, key)})")
    return text


def area_url(key, source, bbox, day, n):
    area = ",".join(f"{v:g}" for v in bbox)
    return f"{config.API_BASE}/area/csv/{key}/{source}/{area}/{n}/{day.isoformat()}"


def download(region, start, end, sources, key, out=RAW, get=http_get, limiter=None, dry_run=False, log=print):
    bbox = config.REGIONS[region]["bbox"]
    limiter = limiter or RateLimiter()
    summary = {}
    for source in sources:
        span = clip_to_source(source, start, end)
        stats = {"chunks": 0, "skipped": 0, "rows": 0, "header": None, "values": {}}
        texts = []
        summary[source] = stats
        if span is None:
            log(f"{source}: no data in {start}..{end} (outside source dates), skipped")
            continue
        folder = out / source / region
        folder.mkdir(parents=True, exist_ok=True)
        for day, n in chunks(*span):
            path = folder / f"{day.isoformat()}_{n}d.csv"
            stats["chunks"] += 1
            if path.exists():
                stats["skipped"] += 1
                text = path.read_text()
            elif dry_run:
                continue
            else:
                limiter.take(n)
                text = fetch(area_url(key, source, bbox, day, n), key, get=get)
                tmp = path.with_suffix(".part")
                tmp.write_text(text)
                tmp.rename(path)
            texts.append(text)
            lines = [ln for ln in text.splitlines() if ln.strip()]
            if lines:
                stats["header"] = stats["header"] or lines[0]
                stats["rows"] += len(lines) - 1
        log(f"{source}: {stats['chunks']} chunks ({stats['skipped']} already on disk), {stats['rows']} rows")
        if stats["header"]:
            log(f"  header: {stats['header']}")
        stats["values"] = value_summary(texts)
        for col, vals in stats["values"].items():
            log(f"  {col}: " + ", ".join(f"{v!r} x{n}" for v, n in vals))
    return summary


def check_availability(key, get=http_get, out=RAW, log=print):
    text = fetch(f"{config.API_BASE}/data_availability/csv/{key}/ALL", key, get=get)
    out.mkdir(parents=True, exist_ok=True)
    (out / "data_availability.csv").write_text(text)
    log("FIRMS data availability (also saved to data/raw/data_availability.csv):")
    log(text.strip())
    return text


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", choices=sorted(config.REGIONS))
    p.add_argument("--year", type=int)
    p.add_argument("--start", type=dt.date.fromisoformat)
    p.add_argument("--end", type=dt.date.fromisoformat)
    p.add_argument("--sources", nargs="+", default=list(config.SOURCES), choices=list(config.SOURCES))
    p.add_argument("--check-availability", action="store_true", help="print FIRMS date ranges per source")
    p.add_argument("--dry-run", action="store_true", help="show what would be downloaded, no requests")
    a = p.parse_args(argv)
    if a.year:
        a.start, a.end = dt.date(a.year, 1, 1), dt.date(a.year, 12, 31)
    if not a.check_availability and not (a.region and a.start and a.end):
        p.error("give --region and --year (or --start and --end), or --check-availability")
    try:
        key = "" if a.dry_run and not a.check_availability else load_key()
        if a.check_availability:
            check_availability(key)
        if a.region:
            print(f"Region {a.region} {config.REGIONS[a.region]['bbox']}, {a.start} to {a.end}{' (dry run)' if a.dry_run else ''}")
            download(a.region, a.start, a.end, a.sources, key, dry_run=a.dry_run)
    except FirmsError as e:
        sys.exit(f"STOPPED: {e}")


if __name__ == "__main__":
    main()
