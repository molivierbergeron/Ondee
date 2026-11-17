#!/usr/bin/env python3
"""Faits git d'un dépôt, sans LLM — prototype du step de la future GitHub Action.

Usage : python3 git_facts.py <chemin-du-repo> [--today AAAA-MM-JJ]
Écrit sur stdout le bloc JSON `git` de status.json. Ce bloc est régénéré
en entier à chaque exécution : il ne s'édite jamais à la main.
"""
import json, re, subprocess, sys
from datetime import date, datetime, timedelta
from pathlib import Path

# Commits de robots ou de routine : ils prouvent que la machine tourne,
# pas que le produit avance. Comptés à part.
AUTO = re.compile(r"(\[bot\]|github-actions)", re.I)
ROUTINE = re.compile(r"^(Vérification quotidienne|Recalibrage hebdomadaire|Rattrapage|"
                     r"sauvegarde auto|backup:|Rafraîchit le catalogue|\d+ livret\(s\))", re.I)

def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=True).stdout

def main():
    repo = sys.argv[1]
    today = date.fromisoformat(sys.argv[sys.argv.index("--today") + 1]) if "--today" in sys.argv else date.today()
    since = today - timedelta(days=30)
    rows = []
    for line in git(repo, "log", "--since", (today - timedelta(days=56)).isoformat(),
                    "--format=%H%x1f%cI%x1f%an%x1f%s").splitlines():
        sha, when, author, subject = line.split("\x1f")
        d = datetime.fromisoformat(when).date()
        auto = bool(AUTO.search(author) or ROUTINE.search(subject))
        rows.append({"sha": sha[:7], "date": d.isoformat(), "author": author, "subject": subject, "auto": auto})
    last = git(repo, "log", "-1", "--format=%H%x1f%cI%x1f%an%x1f%s").strip().split("\x1f")
    human = [r for r in rows if not r["auto"]]
    r30 = [r for r in rows if r["date"] >= since.isoformat()]
    weeks = [0] * 8
    for r in human:
        age = (today - date.fromisoformat(r["date"])).days
        if 0 <= age < 56:
            weeks[7 - age // 7] += 1
    wf = sorted(p.name for p in Path(repo, ".github/workflows").glob("*.y*ml"))
    out = {
        "_generated": "AUTO — généré par tools/git_facts.py (future Action). Ne pas éditer à la main.",
        "generated_at": today.isoformat(),
        "last_commit": {"sha": last[0][:7], "date": last[1][:10], "author": last[2], "subject": last[3]},
        "last_human_commit": ({k: human[0][k] for k in ("sha", "date", "subject")} if human else None),
        "commits_30d": len(r30),
        "human_commits_30d": sum(1 for r in r30 if not r["auto"]),
        "auto_commits_30d": sum(1 for r in r30 if r["auto"]),
        "active_days_30d": len({r["date"] for r in r30 if not r["auto"]}),
        "human_commits_per_week_8w": weeks,
        "workflows": wf,
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
