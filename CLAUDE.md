# planning-test — notes pour Claude Code

Planning mensuel d'une équipe infirmière (service de soins, 4 horaires par jour). Démo publiée sur GitHub Pages :
https://m-igor90.github.io/planning-test/ (branche `main`, dossier racine). Tout en français : interface, code,
commentaires, messages de commit.

## Organisation

- `index.html` : page unique (styles, interface, logique d'affichage). Pas de dépendance ni d'étape de build.
- `planner.js` : moteur de génération et d'évaluation, utilisable dans le navigateur (`window.Planner`) et sous
  Node (`module.exports`). Construction gloutonne puis recuit simulé.
- `exemple.json` : équipe et plannings de démonstration, chargés au premier lancement.
- `tests/planner.test.js` : tests du moteur, `node --test tests/`.
- Données enregistrées dans le navigateur, clé localStorage `planning-soins-v1`. Ne pas la réutiliser dans un
  autre projet servi depuis `m-igor90.github.io` (même origine, les données se mélangeraient).
- Numéro de version affiché dans l'en-tête (`Démo · V1.4.0`) et paramètre `?v=` de `planner.js` : les augmenter
  ensemble à chaque version.

## Codes et règles principales

- Horaires : C1 (soir), M5 et M1 (matin), D2 (coupé) ; CS (administratif), T (tutorat), R, F, N ; V (vacances),
  X (désir de congé). Préfixe `!` = case fixée à la main, gardée par le générateur.
- Règles « non négociables » codées dans le moteur : un seul C1 et un seul D2 par série, repos obligatoires,
  3 jours d'affilée au plus (4 à 90 %), week-end samedi-dimanche indissociable.

## Fonctions ajoutées (V1.2 à V1.4)

- Désirs hebdomadaires et ponctuels, niveau ferme (jamais enfreint) ou souple ; rythme lissé ou condensé.
- Week-ends répartis équitablement selon le taux (au moins un chacun), option « volontaire pour plus ».
- Continuité avec le mois précédent (14 derniers jours) : séries, C1 de la veille, week-end commencé le samedi,
  alternance des week-ends ; fin du mois précédent affichée en grisé.
- Solde d'heures reporté : solde de départ, correction mensuelle, colonne Cumul, rattrapage (2 jours par mois au
  plus par défaut).
- Fiches dépliables par personne dans « Équipe & règles » ; jours fériés par région (cantons suisses, France,
  Alsace-Moselle ; Jura par défaut).

## Points ouverts

- Le test « janvier 2027 » échoue depuis avant la V1.2 : les journées CS de la personne administrative ne
  respectent pas la règle des deux jours de repos. Prochaine correction proposée.
- L'interface n'a jamais été testée dans un vrai navigateur pendant le développement (seulement avec un faux DOM
  sous Node) : vérifier le rendu sur téléphone et sur PC.
- Les listes de jours fériés cantonaux sont indicatives, à vérifier.

## Méthode de travail souhaitée

- Mesurer avant et après chaque changement du moteur sur plusieurs tirages (couverture, alertes, équité) et
  vérifier que, sans les nouvelles options, la génération reste identique.
- Ne pas mettre de vrais noms dans le dépôt (il est public).
- Publier sur `main` quand c'est demandé, puis vérifier le déploiement GitHub Pages.
