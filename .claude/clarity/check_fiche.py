#!/usr/bin/env python3
"""Valide des fiches de statut au format actuel (schéma 4).

Usage : python3 check_fiche.py <fichier.json> [autres…]
Affiche « OK   <chemin> » ou « ERR  <chemin> » suivi d'une ligne par erreur.
Code de sortie 1 si au moins un fichier est en erreur.
(Pour l'ancien format v1, voir check_status.py.)
"""
import json
import sys

RACINE = ["schema", "id", "name", "one_liner", "status", "version", "plan", "posture", "headline",
          "resume", "links", "phases", "objectives", "decisions", "packages", "opportunities",
          "next", "chain", "evolutions", "history"]
PHASES = ["idee", "poc", "proto", "lancement", "amelioration", "maturite"]
PHASE_ST = {"fait", "en cours", "à venir"}
INIT_ST = {"à faire", "en cours", "bloqué", "plus tard", "fait", "abandonné"}
OWNERS = {"marco", "ia", "auto", "externe"}
EFFORTS = {"XS", "S", "M", "L"}
CHAIN_ST = {"fait", "en cours", "manquant", "ensuite", "plus tard"}
HORIZONS = {"Maintenant", "Ensuite", "Plus tard"}


def liste(v):
    """Une référence seule (chaîne) ou une liste de références."""
    if v is None:
        return []
    return [v] if isinstance(v, str) else list(v)


def verifier(d):
    """Renvoie la liste des erreurs de la fiche `d`."""
    e = []
    if not isinstance(d, dict):
        return ["la fiche n'est pas un objet JSON"]
    for k in RACINE:
        if k not in d:
            e.append(f"clé manquante à la racine : {k}")
    if e:
        return e  # inutile d'aller plus loin sur une fiche incomplète
    if d["schema"] != 4:
        e.append(f"schema vaut {d['schema']!r}, attendu 4")

    plan = d["plan"]
    if not isinstance(plan, dict):
        e.append("plan n'est pas un objet")
    else:
        for k in ["version", "updated_at", "updated_by", "priorities_validated", "changes"]:
            if k not in plan:
                e.append(f"plan.{k} manquant")
        if "version" in plan and (type(plan["version"]) is not int):
            e.append("plan.version n'est pas un entier")
        if "priorities_validated" in plan and type(plan["priorities_validated"]) is not bool:
            e.append("plan.priorities_validated n'est pas un booléen")
        ch = plan.get("changes")
        if "changes" in plan and not isinstance(ch, list):
            e.append("plan.changes n'est pas une liste")
        elif isinstance(ch, list) and ch and "version" in plan:
            dern = ch[-1].get("version") if isinstance(ch[-1], dict) else None
            if dern != plan["version"]:
                e.append(f"la dernière entrée de plan.changes est en version {dern!r}, plan.version vaut {plan['version']!r}")

    if not isinstance(d["posture"], dict):
        e.append("posture n'est pas un objet")
    else:
        for k in ["verdict", "why"]:
            if k not in d["posture"]:
                e.append(f"posture.{k} manquant")

    ph = d["phases"]
    ids = [p.get("id") for p in ph] if isinstance(ph, list) else []
    if ids != PHASES:
        e.append(f"phases : ids {ids}, attendu {PHASES}")
    else:
        for p in ph:
            if p.get("status") not in PHASE_ST:
                e.append(f"phase {p['id']} : status {p.get('status')!r} invalide")
        n = sum(1 for p in ph if p.get("status") == "en cours")
        if n != 1:
            e.append(f"phases : {n} phase(s) « en cours », attendu exactement 1")

    # Index des ids
    inits, objs, decs, pkgs = {}, set(), {}, {}
    for o in d["objectives"]:
        for k in ["id", "title", "why", "now", "target", "strategies"]:
            if k not in o:
                e.append(f"objectif {o.get('id', '?')} : clé manquante {k}")
        objs.add(o.get("id"))
        for s in o.get("strategies", []):
            for k in ["id", "title", "why", "initiatives"]:
                if k not in s:
                    e.append(f"stratégie {s.get('id', '?')} : clé manquante {k}")
            for it in s.get("initiatives", []):
                for k in ["id", "title", "status"]:
                    if k not in it:
                        e.append(f"initiative {it.get('id', '?')} : clé manquante {k}")
                i = it.get("id")
                if i in inits or i in decs or i in pkgs:
                    e.append(f"id en double : {i}")
                inits[i] = it
                if it.get("status") not in INIT_ST:
                    e.append(f"initiative {i} : status {it.get('status')!r} invalide")
                if "owner" in it and it["owner"] not in OWNERS:
                    e.append(f"initiative {i} : owner {it['owner']!r} invalide")
                if "effort" in it and it["effort"] not in EFFORTS:
                    e.append(f"initiative {i} : effort {it['effort']!r} invalide")
                if it.get("status") == "fait" and not it.get("done_on"):
                    e.append(f"initiative {i} : « fait » sans done_on")
    for x in d["decisions"]:
        i = x.get("id")
        if i in inits or i in decs or i in pkgs:
            e.append(f"id en double : {i}")
        decs[i] = x
    for x in d["packages"]:
        i = x.get("id")
        if i in inits or i in decs or i in pkgs:
            e.append(f"id en double : {i}")
        pkgs[i] = x
    tous = set(inits) | set(decs) | set(pkgs)

    def ref(ou, r):
        if r not in tous:
            e.append(f"{ou} : référence inconnue {r!r}")

    nx = d["next"]
    if isinstance(nx, dict) and "ref" in nx:
        ref("next.ref", nx["ref"])
    elif nx is not None:
        e.append("next sans ref")
    for i, it in inits.items():
        for b in liste(it.get("blocked_by")):
            ref(f"initiative {i}.blocked_by", b)
        if it.get("package") is not None and it["package"] not in pkgs:
            e.append(f"initiative {i} : lot inconnu {it['package']!r}")
    for i, x in decs.items():
        for b in liste(x.get("blocked_by")):
            ref(f"décision {i}.blocked_by", b)
        for u in liste(x.get("unblocks")):
            ref(f"décision {i}.unblocks", u)
    for i, x in pkgs.items():
        for b in liste(x.get("blocked_by")):
            ref(f"lot {i}.blocked_by", b)
        for it in x.get("items") or []:
            if it not in inits:
                e.append(f"lot {i} : item inconnu {it!r}")

    for c in d["chain"]:
        if c.get("state") not in CHAIN_ST:
            e.append(f"chain : state {c.get('state')!r} invalide")
    evo = {x.get("id") for x in d["evolutions"]}
    for x in d["evolutions"]:
        if x.get("horizon") not in HORIZONS:
            e.append(f"évolution {x.get('id')} : horizon {x.get('horizon')!r} invalide")
        if x.get("objective") is not None and x["objective"] not in objs:
            e.append(f"évolution {x.get('id')} : objectif inconnu {x['objective']!r}")
        for dep in x.get("depends") or []:
            if dep not in evo:
                e.append(f"évolution {x.get('id')} : dépendance inconnue {dep!r}")
    return e


def main(chemins):
    echec = False
    for c in chemins:
        try:
            with open(c, encoding="utf-8") as f:
                erreurs = verifier(json.load(f))
        except (OSError, ValueError) as ex:
            erreurs = [f"fichier illisible : {ex}"]
        if erreurs:
            echec = True
            print(f"ERR  {c}")
            for m in erreurs:
                print(f"       - {m}")
        else:
            print(f"OK   {c}")
    return 1 if echec else 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1:]))
