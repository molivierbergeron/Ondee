---
name: wrap
description: "End-of-session save. Updates status.json with what changed this session, then shows the /next view. Use when the user types /wrap or says they are done for now."
model: sonnet
---

# /wrap

Save the state of the product to `status.json` at the repo root. This file is also the source of the portfolio dashboard: change values, never its structure.

## 0. Checks
- File missing: tell the user in one line to run /init-product, and stop.
- No `"schema": 4` (old kit format, for example a `tree` key): tell the user in one line to run /init-product to convert it, and stop.
- Read the project's CLAUDE.md (or AGENTS.md) first. Its rules on status.json, commits, pushes and the dashboard come first; this skill fills the gaps.

## 1. Update what changed for the product's user this session
Write in the language the file already uses, in plain words, no jargon. NEVER invent progress: if you are not sure something is finished, it stays `en cours`.
- Initiative finished: `status: "fait"`, `done_on` (YYYY-MM-DD), `result` (one sentence).
- Initiative started, blocked or set aside: `en cours`, `bloqué` (+ `blocked_by`: an existing id), `plus tard`, `abandonné`.
- New initiative: add it under the right objective > strategy, with a unique `id` (follow the file's prefix style), `title`, `status`, `owner` (`marco` = the user, `ia` = Claude, `auto`, `externe`), `effort` (XS/S/M/L), `phase`.
- Decision the user made: `status: "prise"`, `decided_on`, `answer`. New open question: add to `decisions` with `id` "dec:…", `question`, `options`, `recommendation`, `unblocks`.
- `next` (`type`, `ref` = an existing id, `why`), `headline`, `posture`, `phases` (exactly one `en cours`), `chain[].state`: update only if they changed.
- If `plan.priorities_validated` is true, do not reorder or reprioritise anything without asking the user first.
- If anything above changed: `plan.version` + 1 (integer), `plan.updated_at` now (YYYY-MM-DDTHH:MM), `plan.updated_by` "Claude", and append `{version, date, summary}` to `plan.changes` (same version number). If nothing changed for the product's user, leave the plan block alone.

## 2. Refresh history and check the file
Find the kit's tools: `K=.claude/clarity; [ -f "$K/check_fiche.py" ] || K="${CLAUDE_CONFIG_HOME:-$HOME/.claude}/clarity"`
- `python3 "$K/fiche.py" .` rebuilds `history` and `git.last_human_commit` from git (no merges, no robot or routine commits). Do this after the session's last commit, so history includes it.
- `python3 "$K/check_fiche.py" status.json` must print OK. Fix any error you introduced. Errors that were already there before this session: list them to the user in one line each, do not change their meaning on your own.

## 3. Commit, push, dashboard
Follow the project's CLAUDE.md. If it has a dashboard section (Tableau de bord), do what it says: status.json goes in the commit that is pushed, then the dashboard record is written with the ArtifactData tool (`set`, collection `products`, the product's id, plus `synced_at`). Before writing, read the record: if its `plan.version` is higher than the file's, another session wrote it; merge from the record instead of overwriting it. If ArtifactData is not available, skip the dashboard write: the next session will sync it.
If the project gives no rule on pushing, do not push: say in one line what is left uncommitted.

## 4. Finish
Print the same view as /next: under 15 lines, name and headline, course, ASCII tree of open initiatives with the next action marked ▶, open decisions one line each, what is blocked. No code talk.
