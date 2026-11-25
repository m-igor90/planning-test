# Planning infirmier

Application web de démonstration pour planifier le mois d'une équipe infirmière.
Une seule page (`index.html`) et le moteur de génération (`planner.js`), sans installation ni serveur.

## Utilisation

- Ouvrir `index.html` dans un navigateur, ou en ligne : https://m-igor90.github.io/planning-test/
- **Équipe & règles** : personnes, taux, groupe (tertiaire / secondaire), rôle (soins ou administratif CS),
  jours exclus, tutorat, nombre de week-ends, maximum de jours de suite, jours fériés du mois.
- **Saisie** : choisir un code (C1, M5, M1, D2, CS, T, R, F, N, vacances, désir ✕) puis toucher les cases.
  Les cases saisies à la main sont gardées par le générateur.
- **Générer le planning** : remplit le reste du mois. « Annuler » revient en arrière.
- **Exporter (CSV)** pour Excel, **Exporter les données (JSON)** / **Importer une sauvegarde** pour sauvegarder ou
  reprendre l'équipe et les plannings.

Application de démonstration, sans serveur ni base de données : les données sont enregistrées dans le navigateur
(localStorage) et ne sont pas partagées entre appareils. Pour passer d'un appareil à l'autre, utiliser
« Exporter les données (JSON) » puis « Importer une sauvegarde ».

À la première ouverture, la page charge `exemple.json` : une équipe de 10 personnes désignées par les 2 premières lettres de leur prénom
et un planning de janvier 2027. Pour repartir de zéro, effacer les données du site dans le navigateur ou modifier
l'équipe dans « Équipe & règles ».

## Règles du générateur

- Chaque jour : un C1 (soir), un M5 et un M1 ; en semaine en plus un D2. Pas de D2 le week-end ni les jours fériés.
- Option « Compléter les heures » : un renfort en semaine (au plus un par jour) pour que chacune atteigne son temps dû.
- Jamais un horaire du matin après un C1 en semaine. Le week-end, rotation des horaires (M1→M5, M5→C1, C1→M1),
  jamais deux C1 le même week-end.
- Jamais deux D2 (horaires coupés) dans la même série de jours travaillés, même courte.
- Séries régulières de 2 à 3 jours, pas de jour isolé ni de « 5 jours – 1 congé – 5 jours » ;
  maximum de jours de suite par personne.
- Répartition équitable des C1, M5, M1 et D2, des week-ends (selon le taux, en alternance) et des jours de travail.
- Jours exclus respectés (par exemple : jamais le mercredi). Vacances comptées comme jours dus.
- Jours fériés préremplis, modifiables mois par mois.

## Tests

```
node --test tests/*.test.js
```

## Confidentialité

Le dépôt est public : les personnes n'y figurent que par leurs initiales. Ne pas y ajouter de sauvegarde avec des noms.
