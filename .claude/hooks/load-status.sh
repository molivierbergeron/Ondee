#!/usr/bin/env bash
# SessionStart hook: loads a digest of status.json (portfolio dashboard format, schema 4)
# from the project root into the session.
dir="${CLAUDE_PROJECT_DIR:-}"
[ -n "$dir" ] || dir="$PWD"
# If the project carries its own copy of this hook, let that one speak (avoids loading twice).
self="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
if [ -f "$dir/.claude/hooks/load-status.sh" ] && [ "$self" != "$dir/.claude/hooks" ]; then
  exit 0
fi
f="$dir/status.json"
if [ ! -f "$f" ]; then
  echo "No status.json in this project. If this is a product repo, offer to run /init-product."
  exit 0
fi
if command -v python3 >/dev/null 2>&1 && python3 - "$f" <<'PY' 2>/dev/null; then exit 0; fi
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
if d.get("schema") != 4:
    sys.exit(1)
ids = {}
for o in d.get("objectives", []):
    for s in o.get("strategies", []):
        for i in s.get("initiatives", []):
            ids[i.get("id")] = ("initiative", i.get("title"), i.get("status"), o.get("title"))
for x in d.get("decisions", []):
    ids[x.get("id")] = ("decision", x.get("question"), x.get("status") or "ouverte", "")
for p in d.get("packages", []):
    ids[p.get("id")] = ("lot", p.get("title"), "", "")
out = ["Product state (status.json, dashboard format 4), digest loaded automatically:",
       f"- {d.get('name')} : {d.get('one_liner')}",
       f"- Where we are: {d.get('headline')}",
       f"- Course: {(d.get('posture') or {}).get('verdict')}"]
n = d.get("next") or {}
t = ids.get(n.get("ref"))
out.append(f"- Next ({n.get('type')} {n.get('ref')}): {t[1] if t else '?'} — {n.get('why')}")
opened = [i for i in ids.items() if i[1][0] == "initiative" and i[1][2] in ("en cours", "bloqué")]
for k, v in opened[:8]:
    out.append(f"- {v[2]}: {v[1]} [{k}]")
for x in d.get("decisions", []):
    if x.get("status") != "prise" and not x.get("answer"):
        out.append(f"- Open decision: {x.get('question')} [{x.get('id')}]")
p = d.get("plan") or {}
out.append(f"- Plan v{p.get('version')} ({p.get('updated_at')}), priorities validated: {p.get('priorities_validated')}")
out.append("Read status.json for the full detail. /next shows the tree, /wrap saves the session.")
print("\n".join(out))
PY
# Fallback: old format or no python3 — show the start of the raw file.
echo "Product state (status.json), loaded automatically:"
head -c 9000 "$f" 2>/dev/null
echo
size="$(wc -c < "$f" 2>/dev/null | tr -d ' ')"
if [ -n "$size" ] && [ "$size" -gt 9000 ] 2>/dev/null; then
  echo "[status.json truncated at 9000 characters; read the file for the rest]"
fi
exit 0
