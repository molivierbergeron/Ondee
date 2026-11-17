#!/usr/bin/env python3
"""Régénère `history` et `git.last_human_commit` dans le status.json d'un repo.

Usage : python3 dashboard-lab/tools/fiche.py <chemin-du-repo>
Ne remplace que ces deux clés ; le reste de la fiche ne bouge pas.
(Copie du kit Clarity : garde l'indentation du fichier et l'ordre des clés de `history`,
pour que le diff ne montre que ce qui a changé.) Si le repo a
`dashboard-lab/app/data/umbrella.json` (la copie publiée avec la page), la même
fiche y est écrite aussi.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # pas de __pycache__ dans tools/
sys.path.insert(0, str(Path(__file__).resolve().parent))
from git_facts import AUTO, ROUTINE  # robots et routine : mêmes règles que git_facts.py

PR = re.compile(r"\s*\(#(\d+)\)\s*$")


def commits(repo):
    """Commits retenus (hors fusions, robots et routine), du plus récent au plus ancien."""
    sortie = subprocess.run(
        ["git", "-C", str(repo), "log", "--no-merges", "--format=%h%x1f%cs%x1f%an%x1f%s"],
        capture_output=True, text=True, check=True).stdout
    gardes = []
    for ligne in sortie.splitlines():
        if not ligne:
            continue
        sha, date, auteur, sujet = ligne.split("\x1f", 3)
        if AUTO.search(auteur) or ROUTINE.search(sujet):
            continue
        gardes.append({"sha": sha, "date": date, "sujet": sujet})
    return gardes


def main(repo):
    repo = Path(repo)
    chemin = repo / "status.json"
    brut = chemin.read_text(encoding="utf-8")
    d = json.loads(brut)
    m = re.search(r"\n( +)\"", brut)
    indent = len(m.group(1)) if m else 1
    ordre = list(d["history"][0].keys()) if d.get("history") else ["date", "title", "pr"]
    rows = commits(repo)
    history = []
    for r in rows:
        m = PR.search(r["sujet"])
        ligne = {"date": r["date"], "title": PR.sub("", r["sujet"]) if m else r["sujet"],
                 "pr": int(m.group(1)) if m else None}
        history.append({k: ligne[k] for k in ordre if k in ligne} | ligne)
    d["history"] = history
    d.setdefault("git", {})["last_human_commit"] = (
        {"sha": rows[0]["sha"], "date": rows[0]["date"], "subject": rows[0]["sujet"]} if rows else None)
    texte = json.dumps(d, ensure_ascii=False, indent=indent) + "\n"
    chemin.write_text(texte, encoding="utf-8")
    copie = repo / "dashboard-lab" / "app" / "data" / "umbrella.json"
    if copie.exists():
        copie.write_text(texte, encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1])
