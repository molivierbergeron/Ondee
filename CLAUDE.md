# ondee — contexte pour Claude

## Tableau de bord (Umbrella)

Ce repo a une fiche de statut : `status.json` à la racine. Elle alimente le tableau de bord
https://claude.ai/artifact/SgaTqQ5jkk6jEK5jBbjA7h (identifiant du produit : `ondee`).
Format et exemple : `dashboard-lab/app/data/ondee.json` dans le repo `molivierbergeron/Umbrella`.

**En début de session** : lis `status.json`, dis-moi en deux lignes où on en est et quelle est
la prochaine action proposée.

**À chaque commit que tu pousses**, dans le même commit :

1. Mets à jour `status.json` si quelque chose a changé pour l'utilisateur : une initiative
   terminée (statut `fait`, `done_on`, `result` en une phrase), une nouvelle initiative, un
   blocage, une décision prise ou nouvelle, la prochaine action (`next`), le cap (`posture`)
   ou la phrase « où on en est » (`headline`). Écris en français simple, sans jargon.
   Incrémente `plan.version`, mets `plan.updated_at` à l'heure actuelle et ajoute une ligne
   à `plan.changes`.
2. Régénère `history` à partir de `git log` (date, titre, numéro de PR ; sans les commits
   de robots ni les fusions) et `git.last_human_commit`.
3. Après le push, écris la fiche dans la base du tableau de bord avec l'outil `ArtifactData` :
   `action: "set"`, `url` ci-dessus, `collection: "products"`, `doc_id: "ondee"`,
   `file_path: status.json`, en ajoutant le champ `synced_at` (heure actuelle, ISO 8601).
   Si l'outil n'est pas disponible (autre agent, session hors ligne), ne fais que l'étape 1 et 2 :
   la prochaine session Claude synchronisera.

Ne touche jamais aux priorités marquées `priorities_validated: true` sans me le demander.
