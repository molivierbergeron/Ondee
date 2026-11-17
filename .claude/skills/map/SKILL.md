---
name: map
description: "Build a visual map of the product (objective tree, decisions, workflow) from status.json as an HTML page. Use when the user types /map or asks to see the product visually."
model: opus
---

# /map

Make the product visible. Read `status.json` at the repo root first. If missing, say so in one line and suggest /init-product. If it has no `"schema": 4` (old kit format), say in one line to run /init-product to convert it, and stop.

What the map shows, all taken from status.json (schema 4, the portfolio dashboard format):
- top: `name`, `headline`, `posture.verdict`, and the 6 `phases` as a strip with the one `en cours` highlighted
- the tree `objectives` > `strategies` > `initiatives`, each initiative with its status shown by colour AND a text label (`à faire`, `en cours`, `bloqué`, `plus tard`, `fait`, `abandonné`), its owner (`marco` = the user, `ia` = Claude) and effort; the item `next.ref` points to marked ▶ with `next.why`
- open `decisions` (no `status: "prise"`, no `answer`) with their options and recommendation
- the `chain` (the product's workflow, step by step with its state), if not empty

Write all text with `html.escape`. Pages are static and self-contained: no external dependency, no network.

## Case A: no `map_layout` key in status.json (no layout chosen yet)
Build 3 clearly different layout options in `design-lab/`: `map-a.html`, `map-b.html`, `map-c.html`. For example: A = top-down tree, B = left-to-right flow with swimlanes by owner, C = board by status. Name the three options in plain words, open them if the environment allows, and ask the user to pick A, B or C. Record the pick as a root key `"map_layout": "A"` (or B, C) in status.json: change nothing else, keep it valid, do not bump `plan.version` (the layout is not product news). Do not build further until he picks.

## Case B: `map_layout` is set
1. If `tools/render-map.py` does not exist, write it once: a small Python 3 script, standard library only, that reads `status.json` and writes `map.html` in the chosen layout, with the look of the chosen file in `design-lab/` as the reference. It must run with no LLM and no network: `python3 tools/render-map.py`.
2. Run it. Tell the user where `map.html` is (and open it if the environment allows).
3. If the script already exists, just run it. Only edit it if status.json has fields it does not handle.

Then reply with a 3-line summary (what the map shows, where it is, what changed). No code talk.
