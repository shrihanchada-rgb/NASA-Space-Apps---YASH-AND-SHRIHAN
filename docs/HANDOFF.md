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

### 2026-11-14 — Planning docs — DONE
- **Who / AI:** Shrihan using Claude
- **Did:** Wrote the project plan in `README.md`, `CLAUDE.md`, `AGENTS.md`, and the step-by-step checklist (Section 10) with this handoff log. No code exists yet.
- **Files changed:** `README.md`, `CLAUDE.md`, `AGENTS.md`, `.gitignore`, `docs/HANDOFF.md`
- **How to check it:** open `README.md` on GitHub and confirm Sections 0–13 render; the checklist boxes in Section 10 are all unticked.
- **Results / numbers:** none
- **Decisions and why:** Work is one-person-at-a-time with a single ordered checklist, because the two people work at different times. Sensor dates and FIRMS column names in the README are from memory and unverified until step S05.
- **Problems / open questions:** The FIRMS key-request link and sensor start dates are unverified. Pilot regions are a suggestion until S04.
- **Next step:** S01 (read the plan), then S05 (verify FIRMS facts).
