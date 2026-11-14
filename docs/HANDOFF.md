# Handoff log

One entry per shift or step, **newest first**. Shrihan and Yash (and Claude and Codex) work at different times, so this file is how the next person continues without asking anyone. Read the newest entry before you start; write a new one before you stop. Rules: README Section 11.

Status is one of `STARTED`, `DONE`, `PAUSED`, `BLOCKED`. When you finish or pause a step, change your own `STARTED` entry in place instead of adding a second one.

## Template (copy this to the top of the entries below)

```
### <date> — <step id and name> — <STATUS>
- **Who / AI:** <Shrihan or Yash> using <Claude or Codex>
- **Did:** <2–5 plain sentences: what is now true that was not true before>
- **Files changed:** <paths>
- **How to check it:** <exact commands to run and what you should see>
- **Results / numbers:** <counts, metrics, plot file names; say "none" if none>
- **Decisions and why:** <what you chose, what you rejected, why>
- **Problems / open questions:** <anything broken, unclear, or needing the other person>
- **Next step:** <step id and what to do first>
- **If PAUSED — branch and resume command:** <branch name; command to continue>
```

Rules for entries:
- Say only what you verified. Write "not tested" if you did not test it.
- Never paste secrets (the FIRMS key) here.
- If you found a mistake in the previous entry, write it first under "Problems".

## Entries

### 2026-11-14 — S03 FIRMS key — DONE
- **Who / AI:** Shrihan using Claude
- **Did:** Shrihan has a FIRMS key. `.env` with the key is committed on `main` (commit `c2dd4b5`, 47 bytes, checked by name and size only; the AI never saw the contents). Shrihan also reports adding the key to Colab Secrets as `FIRMS_MAP_KEY` with notebook access on (not verified by the AI). `.env.example` (empty template) is also in the repo.
- **Files changed:** `README.md` (S03 ticked, decision noted), `docs/HANDOFF.md`
- **How to check it:** `git pull`, then `ls -la .env` shows a small file; do NOT print it. To test the key, run the S09 download script when it exists.
- **Results / numbers:** none. The key has **not been tested** against FIRMS.
- **Decisions and why:** The repo is private, so committing a free key was accepted by Shrihan, so Yash can use it without his own. Rejected: key only in `.env` ignored by git (the safer default).
- **Problems / open questions:** (1) `CLAUDE.md` and `AGENTS.md` still say "`.env` ... are gitignored" and "never commit secrets", which now contradict the repo; to be updated. (2) If the repo is made public, the key is exposed in git history: request a new key. (3) The Colab notebook still cannot clone the private repo (cell 3, no login); decision pending between a Drive zip copy and a read-only token.
- **Next step:** S04 (pilot regions, a decision for both) and S05 (verify FIRMS facts, web research only).

### 2026-11-14 — S01 Read the plan, S02 Tools installed — DONE
- **Who / AI:** Shrihan using Claude (running in the cloud session, not on a personal laptop)
- **Did:** Read `README.md`, `CLAUDE.md` and `docs/HANDOFF.md`. Plan in one sentence: build a harmonized MODIS + VIIRS fire-hotspot history (2000 to now) and a website with a region/date picker, a burning-activity calendar, analytics and CSV download. Checked tool versions in the cloud session's environment and ticked S01 and S02.
- **Files changed:** `README.md` (ticked S01, S02), `docs/HANDOFF.md`
- **How to check it:** run `python3 --version && node --version && git --version`. Expected on the cloud session: Python 3.13.18, Node v22.23.4, git 2.43.0 (also npm 10.9.9, and `python3.11` and `python3.12` exist).
- **Results / numbers:** Python 3.13.18 (needs 3.11+: ok), Node v22.23.4 (needs 20+: ok).
- **Decisions and why:** These versions are for the **cloud session only**. They say nothing about Shrihan's or Yash's own computers, or about Colab. Each person should run the same two commands wherever they will work and add the result under their own entry. Not verified: Colab's Node.js version (the notebook only needs Python).
- **Problems / open questions:** None for S01/S02. S03 (FIRMS key) can only be done by a person. S04 (pilot regions) needs a decision from the two of you.
- **Next step:** S05 (verify FIRMS facts) needs only web research and can be done without S03/S04. S03 and S04 are for a person.

### 2026-11-14 — Colab runner notebook — DONE
- **Who / AI:** Shrihan using Claude
- **Did:** Added `notebooks/run_pipeline_colab.ipynb`, which clones the repo in Colab, installs packages, reads the FIRMS key from Colab Secrets, keeps raw and interim data on Google Drive, runs chosen pipeline scripts and tests, and prints a summary for the handoff. Added README Section 14 and a Colab note in `CLAUDE.md` and `AGENTS.md`.
- **Files changed:** `notebooks/run_pipeline_colab.ipynb`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/HANDOFF.md`
- **How to check it:** in Python, `json.load` the notebook and `ast.parse` each code cell (this was done: all 9 cells parse). To run it for real, follow README Section 14.1 and run with `STEPS = []`; expect "nothing to run".
- **Results / numbers:** none. The notebook has **not been run in Colab**, because no tool here can open Colab. The `pipeline/` scripts do not exist yet, so the run cells are untested.
- **Decisions and why:** Data stays on Drive and is not committed; no GitHub token goes into Colab, so results come back through handoff entries and manual downloads.
- **Problems / open questions:** Script command-line arguments are not defined yet; the notebook runs each script with no arguments. When S09 is written, update the notebook cell 6 to pass the region and year.
- **Next step:** S01, S05 as before; the first person to open the notebook in Colab should run it with `STEPS = []` and note whether setup worked.

### 2026-11-14 — Planning docs — DONE
- **Who / AI:** Shrihan using Claude
- **Did:** Wrote the project plan in `README.md`, `CLAUDE.md`, `AGENTS.md`, and the step-by-step checklist (Section 10) with this handoff log. No code exists yet.
- **Files changed:** `README.md`, `CLAUDE.md`, `AGENTS.md`, `.gitignore`, `docs/HANDOFF.md`
- **How to check it:** open `README.md` on GitHub and confirm Sections 0–13 render; the checklist boxes in Section 10 are all unticked.
- **Results / numbers:** none
- **Decisions and why:** Work is one-person-at-a-time with a single ordered checklist, because the two people work at different times. Sensor dates and FIRMS column names in the README are from memory and unverified until step S05.
- **Problems / open questions:** The FIRMS key-request link and sensor start dates are unverified. Pilot regions are a suggestion until S04.
- **Next step:** S01 (read the plan), then S05 (verify FIRMS facts).
