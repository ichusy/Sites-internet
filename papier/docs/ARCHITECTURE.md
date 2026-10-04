# Architecture

## Stack

| Rôle | Choix |
|---|---|
| Langage, build | TypeScript strict, Vite |
| Interface | Svelte 5 (runes) — uniquement l'habillage ; le moteur d'encre est en TS pur |
| PWA | vite-plugin-pwa (Workbox, mise à jour automatique) |
| Contenu des carnets | Yjs (CRDT) persisté par y-indexeddb — un Y.Doc par carnet |
| Index de la bibliothèque | Dexie (IndexedDB) |
| Tracé de l'encre | perfect-freehand (contour à épaisseur variable) |
| Index spatial | rbush (gomme, lasso) |

Pourquoi Yjs dès le départ : le même modèle fournit l'annulation illimitée
(`Y.UndoManager`, limitée aux modifications locales), la persistance
incrémentale, et servira tel quel à la synchronisation et à l'édition
collaborative en temps réel (étape 10), sans migration de données.

## Organisation du code

```
src/
├─ main.ts                 point d'entrée (thème, service worker, stockage persistant)
├─ app.css                 variables de thème clair/sombre, styles de base
├─ core/                   données, sans dépendance à l'interface
│  ├─ model/               types, schéma Yjs, encodage des points, formats de papier
│  └─ storage/             Dexie (bibliothèque), ouverture/création des Y.Doc
├─ engine/                 moteur d'encre, indépendant du framework
│  ├─ Editor.ts            façade : document ↔ scènes ↔ rendu ↔ saisie ↔ outils
│  ├─ Viewport.ts          zoom / défilement
│  ├─ layout.ts            empilement vertical des pages
│  ├─ scene.ts             état de rendu d'une page (éléments décodés, index spatial)
│  ├─ input/PointerRouter  stylet / doigt / souris, rejet de la paume, gestes
│  ├─ render/              Renderer (calques, caches), dessin des modèles et traits
│  ├─ ink/brushes.ts       pointes bille / plume / pinceau
│  ├─ geometry/            distances, gomme partielle
│  └─ tools/               stylo & surligneur (InkTool), gomme
└─ ui/                     composants Svelte (bibliothèque, carnet, dialogues)
```

## Moteur d'encre

- **Coordonnées** : points PDF (1/72 po), origine en haut à gauche de chaque page.
  Les pages sont empilées verticalement dans un « monde » commun.
- **Deux calques canvas** :
  - `main` : bureau + pages. Chaque page est rastérisée dans un **cache bitmap**
    à la résolution de l'écran (limité à 6 Mpx ; au-delà, rendu vectoriel direct
    de la seule zone visible). Un nouveau trait est **ajouté** au cache sans tout
    redessiner ; suppression, surligneur ou changement de modèle déclenchent un
    rendu complet de la page. Pendant un zoom, le cache est étiré puis
    recalculé net 160 ms après la fin du geste.
  - `wet` (encre fraîche) : uniquement le trait en cours, contexte
    `desynchronized` quand disponible, `mix-blend-mode: multiply`.
- **Saisie** : Pointer Events avec `getCoalescedEvents()` (tous les échantillons
  du stylet) et `getPredictedEvents()` (affichage anticipé, non enregistré).
- **Ordre de dessin** : modèle de page → surligneurs (mode *multiply*) → encre.
  Le surligneur passe donc toujours derrière l'encre.
- **Rejet de la paume** : pendant un trait au stylet, tout contact tactile est
  ignoré ; une fois un stylet détecté, le doigt ne dessine plus (mode Auto).
- **Annulation** : chaque trait = une étape ; tout un geste de gomme = une étape.

## Feuille de route

| Étape | Contenu | État |
|---|---|---|
| 0 | Socle : Vite, TS, PWA, Dexie, Yjs, thèmes, tests | ✅ |
| 1a | Bibliothèque, pages, stylo (3 pointes, pression, tirets/pointillés), surligneur, gomme, zoom, rejet de paume, annuler/rétablir | ✅ |
| 1b | Lasso ; import PDF/images ; export PDF avec/sans annotations ; archive `.papier` | à venir |
| 2 | Crayon, gribouiller-pour-effacer, formes, texte, images, autocollants, modèles Cornell/planner/importés | |
| 3 | PDF : sommaire, liens ; recherche plein texte | |
| 4 | Canevas infini, post-its, connecteurs | |
| 5 | Audio synchronisé, transcription | |
| 6 | Reconnaissance d'écriture, recherche manuscrite | |
| 7 | Flashcards (SM-2) | |
| 8 | Couche IA optionnelle | |
| 9 | Présentation, pointeur laser | |
| 10 | Synchro, partage, collaboration temps réel | |
