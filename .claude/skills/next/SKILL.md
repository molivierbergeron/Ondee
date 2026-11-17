---
name: next
description: "Show where the product stands and the single next action, from status.json. Use when the user types /next or asks what is next."
model: haiku
---

# /next

Read `status.json` at the repo root (the project root, not a subfolder). Do not edit any file. Never invent state: show only what the file says.

- File missing: say in one line "No status.json here. Run /init-product to set this repo up." and stop.
- File has no `"schema": 4` (for example it has a `tree` key): say in one line "This status.json is in the old kit format. Run /init-product to convert it." and stop.

## How the file is built (schema 4, the portfolio dashboard format)

- `name`, `one_liner`, `headline` (where we are), `posture.verdict` (the current course)
- `objectives[]` > `strategies[]` > `initiatives[]`. Initiative: `id`, `title`, `status` (`à faire`, `en cours`, `bloqué`, `plus tard`, `fait`, `abandonné`), optional `owner` (`marco` = the user, `ia` = Claude, `auto`, `externe`), `effort` (XS/S/M/L), `blocked_by`, `package`.
- `decisions[]`: `id`, `question`, `options`, `recommendation`, `minutes`, `unblocks`. A decision is open unless it has `status: "prise"` or an `answer`.
- `packages[]`: bundles of initiatives (`items`) that Claude can do in one go.
- `next`: `{type, ref, why}`. `ref` is the id of an initiative, a decision or a package.

## Print, in UNDER 15 LINES, in the language the user writes in, no code talk, no file names

1. One line: `name`, then `headline`.
2. One line: "Course: " + `posture.verdict`.
3. An ASCII tree, objective > strategy > initiative, of what is still open (skip `fait` and `abandonné`; skip a strategy with nothing open). Each initiative: title, who (marco → "you", ia → "Claude"), effort, status when it is not `à faire`. Max 7 nodes; if more, keep the branch that holds the next action and say "+N more".
4. Mark the next action with ▶: the item `next.ref` points to. If it points to a package, mark the package's first open item and name the package. If it points to a decision, show the decision as the ▶ line. Then one line: "▶ " + its title + ": " + `next.why`.
5. Open decisions, one line each: "question: option / option / option (pick: recommendation, N min)".
6. One line for what is blocked (`bloqué`) and how many are `plus tard`, if any.
