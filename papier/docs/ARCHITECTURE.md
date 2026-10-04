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
| Lecture des PDF | pdf.js (build *legacy*, chargé à la demande, worker) |
| Écriture des PDF | pdf-lib (chargé à la demande) |
| Archives `.papier` | fflate (zip) |
| Audio | MediaRecorder (Opus / AAC), Web Audio (décodage, vumètre) |
| Transcription | transformers.js + ONNX Runtime Web (Whisper, dans un worker ; wasm servi par l'app) |

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
│  ├─ audio/               chronologie horloge ↔ audio, enregistreur, découpage et nettoyage des transcriptions
│  ├─ model/               types, schéma Yjs, encodage des points, formats de papier
│  ├─ search/              normalisation, correspondances, index des carnets, recherche bibliothèque
│  └─ storage/             Dexie (bibliothèque), ouverture/création des Y.Doc
├─ engine/                 moteur d'encre, indépendant du framework
│  ├─ Editor.ts            façade : document ↔ scènes ↔ rendu ↔ saisie ↔ outils
│  ├─ Viewport.ts          zoom / défilement
│  ├─ layout.ts            empilement vertical des pages
│  ├─ scene.ts             état de rendu d'une page (éléments décodés, index spatial)
│  ├─ input/PointerRouter  stylet / doigt / souris, rejet de la paume, gestes
│  ├─ render/              Renderer (calques, caches), dessin des modèles et traits
│  ├─ ink/brushes.ts       pointes bille / plume / pinceau
│  ├─ geometry/            distances, gomme partielle, matrices, polygones,
│  │                       reconnaissance de formes / gribouillis (recognize.ts)
│  ├─ render/              + grain du crayon, mise en page du texte, modèles (primitives)
│  └─ tools/               stylo, crayon & surligneur (InkTool), gomme, lasso, texte, post-it,
│                          connecteur, écoute (ListenTool)
├─ audio/                  transcription : moteurs (abstraction), Whisper local (worker), décodage 16 kHz
├─ pdf/                    pdf.js (chargement), import PDF/images, export PDF,
│                          analyse (texte positionné, sommaire, liens)
├─ io/                     archives .papier, sélection et enregistrement de fichiers
└─ ui/                     composants Svelte (bibliothèque, carnet, dialogues, actions)
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
- **Annulation** : chaque trait = une étape ; tout un geste de gomme = une étape ;
  un déplacement ou redimensionnement au lasso = une étape.
- **Fonds importés** (`render/backgrounds.ts`) : les pages PDF sont rendues par
  pdf.js en arrière-plan, à une résolution quantifiée (pas de √2, 8 Mpx max),
  un rendu à la fois, le plus récent demandé en premier ; le cache de la page est
  recalculé quand un rendu plus net arrive.
- **Lasso** : sélection = éléments dont ≥ 50 % des points sont dans la boucle
  (ou trait touché). Pendant un déplacement, les éléments sont retirés du cache
  et dessinés en aperçu sur le calque d'encre fraîche ; à la fin, une seule
  transaction met à jour leur `transform` (et leur épaisseur en cas d'agrandissement).

## Étape 2 : éléments et gestes

- **Éléments** : trait (stylo, crayon, surligneur ; éventuellement *forme*),
  texte, image (photo ou autocollant). Texte et images ont un rectangle local et
  une matrice `transform` ; les traits ont leurs points transformés.
- **Crayon** : contour perfect-freehand rempli d'un motif de grain (bruit généré,
  teinté par couleur, mis en cache). En PDF : même contour, légère transparence.
- **Reconnaissance de formes** (`recognize.ts`, sans dépendance) : ligne si tous
  les points sont proches de la corde ; sinon courbe fermée → ajustement d'ellipse
  (analyse en composantes principales, erreur radiale) comparé à un polygone
  (Douglas-Peucker sur courbe fermée) ; régularisation (cercle si axes proches,
  rectangle à angles droits aimanté aux axes). Déclenchée par 450 ms d'immobilité.
- **Gribouillis** : longueur ≥ 3 × diagonale et ≥ 4 rebroussements ; efface les
  traits dont ≥ 60 % des points sont dans son enveloppe convexe.
- **Entourer puis toucher** : boucle fermée → éléments à ≥ 50 % dedans retenus ;
  un toucher dans la boucle annule la boucle (Y.UndoManager) et sélectionne.
- **Texte** : mise en page commune (`render/text.ts`) écran / PDF, police
  Helvetica (à l'écran : Helvetica/Arial) pour des retours à la ligne identiques.
  L'édition passe par un `<textarea>` superposé, toujours présent dans le DOM
  pour pouvoir ouvrir le clavier de l'iPad pendant le geste.
- **Modèles** : `templatePrimitives()` décrit lignes, structure, points et
  libellés ; partagé par l'écran et l'export. Modèle importé = image ou page de
  PDF étirée sur la page (rendue par le même `BackgroundStore` que les fonds).

## Étape 3 : PDF navigables et recherche

- **Analyse des PDF** (`pdf/analyze.ts`), en arrière-plan dès l'import, ou à la
  demande pour les PDF importés avant : pour chaque page, les morceaux de texte de
  pdf.js avec leur position dans le repère de la page, les liens (zone, page et
  hauteur visées, ou adresse web) et le sommaire (destinations résolues).
  Résultat stocké dans IndexedDB (`pdftext`, `pdfmeta`), réanalysé si
  `ANALYSIS_VERSION` change. Ce sont des données dérivées : jamais exportées.
- **Normalisation** (`core/search/match.ts`) : minuscules, accents retirés,
  ligatures (œ → oe), apostrophes, tirets et espaces unifiés, avec une table qui
  ramène chaque correspondance à sa position dans le texte d'origine.
  Une page correspond si elle contient **tous** les termes ; toutes leurs
  occurrences sont surlignées.
- **Dans un carnet** (`engine/search.ts`) : texte tapé mesuré exactement (lignes
  calculées comme au rendu, rotation comprise) ; texte des PDF positionné par
  morceau, l'abscisse dans un morceau étant estimée par le rapport des largeurs
  mesurées. Les surlignages sont dessinés sur le calque d'encre fraîche.
- **Dans la bibliothèque** (`core/search/librarySearch.ts`) : un index par carnet
  (`searchindex` : texte tapé de chaque page et page de PDF associée) est tenu à
  jour à chaque modification, et reconstruit au besoin pour les carnets plus
  anciens. Recherche par simple parcours (rapide pour des milliers de pages) ;
  un index inversé dans un worker pourra venir si les volumes l'exigent.
- **Liens** : toucher simple du doigt (quand le doigt ne dessine pas), toucher
  avec le lasso hors de tout élément, ou Ctrl/⌘ + clic.

## Étape 4 : tableau blanc infini

- **Page infinie** (`PageData.infinite`) : la mise en page (`engine/layout.ts`) la
  place seule à l'origine et ne renvoie pas de bornes ; `containsPoint` /
  `intersectsRect` remplacent les tests de rectangle partout (outils, liens,
  surcouches). La vue n'est plus bornée (`Editor.clampView`), le zoom descend à 8 %,
  *Ajuster* cadre le contenu (`fitContent`).
- **Rendu** : pas de cache par page (la page n'a pas de taille) ; on dessine le fond
  pointillé sur le seul rectangle visible (pas doublé tant qu'il fait moins de
  12 px) puis les éléments que l'index rbush renvoie pour ce rectangle.
- **Post-it** : un `BoxElement` (rectangle local + matrice) comme le texte et les
  images, donc lasso, rotation, export et recherche sans code spécifique, à part
  le dessin et l'éditeur de texte (fond coloré, hauteur recalculée).
- **Connecteurs** (`engine/geometry/connector.ts`) : courbe calculée à l'affichage
  depuis les boîtes des éléments reliés (`resolveEnd` + `ItemLookup` de la scène).
  La scène charge les connecteurs en dernier et recalcule ceux qui touchent un
  élément modifié (`refreshConnectors`) pour garder une boîte englobante exacte
  dans l'index (sélection et gomme précises). Les coordonnées de repli stockées sont
  mises à jour dans la même transaction que le déplacement (un seul pas d'annulation),
  et supprimer un élément supprime ses connecteurs.
- **Export PDF** : une page infinie devient une page à la taille du contenu
  (+ 32 pt de marge), sans modèle ; post-its et connecteurs y sont vectoriels.

## Étape 5 : audio synchronisé et transcription

- **Synchronisation sans nouveau champ** : chaque élément porte déjà son instant de
  création (`t0` des traits, `z` = horodatage pour les autres, voir `nextZ`).
  Un enregistrement garde ses **plages horaires** (`spans` : début, fin, position
  dans le fichier) ; `core/audio/timeline.ts` convertit dans les deux sens, pauses
  comprises. Écouter un trait = `audioTimeAt(spans, t0) − 2 s`.
- **Enregistreur** (`core/audio/recorder.ts`) : MediaRecorder, un morceau par
  seconde écrit dans IndexedDB (`recchunks`) avec les plages (`recdrafts`). À
  l'arrêt, les morceaux sont assemblés en un fichier (`assets`) et l'enregistrement
  ajouté au Y.Doc (hors historique d'annulation). Un brouillon abandonné depuis
  plus de 10 s est récupéré à l'ouverture du carnet.
- **Relecture** : `Editor.setReplay(t)` installe un prédicat « fantôme » dans le
  Renderer ; les pages passent en rendu vectoriel direct (sans cache) et les
  éléments postérieurs à `t` sont dessinés à 16 % d'opacité. On ne redessine que
  lorsque le nombre d'éléments visibles change.
- **Transcription** (`src/audio/`) : interface `Transcriber` et registre ; la couche
  IA (étape 8) y ajoutera des moteurs distants. Moteur fourni : Whisper
  (transformers.js) dans un worker. L'audio est décodé en mono 16 kHz, découpé
  en blocs d'environ 5 min **coupés dans les silences** (aucun mot tranché,
  progression mesurable, phrases affichées bloc par bloc), chaque bloc passe par
  le pipeline Whisper (fenêtres de 30 s, horodatage des phrases). Annuler arrête
  le worker immédiatement ; le modèle se recharge depuis le cache. Les blocs silencieux sont ignorés et les « hallucinations »
  classiques de Whisper (Amara.org, répétitions) filtrées.
- **Hors ligne** : ONNX Runtime (wasm) est copié dans `ort/` et servi par
  l'application (jamais par un CDN) ; transformers.js garde le modèle dans le
  cache du navigateur (`transformers-cache`). Ces gros fichiers sont exclus du
  précache du service worker : ils ne se téléchargent que si l'on transcrit.
- **Recherche** : transcriptions dans `searchindex.audio` (bibliothèque) et
  recherche directe dans le carnet (`core/search/audioSearch.ts`).

## Export PDF

- Page issue d'un PDF : la page d'origine est **recopiée** (pdf-lib `copyPages`),
  son contenu est isolé (`q … Q`), puis l'encre est ajoutée dans le repère de la
  page via l'inverse de la transformation de pdf.js (rotation et CropBox gérées).
  PDF chiffré ou illisible par pdf-lib : repli sur une image à 150 dpi.
- Page vierge ou image : nouvelle page aux mêmes dimensions ; un modèle importé
  PDF y est intégré en vectoriel (`embedPdf`), une image en image.
- Texte : Helvetica standard (caractères hors WinAnsi remplacés par « ? »),
  glyphes redressés (matrice de texte à Y inversé) ; images intégrées une fois
  par fichier et dessinées via `Do` avec leur matrice.
- Encre : contour perfect-freehand converti en courbes de Bézier cubiques (remplies) ;
  surligneur et pointillés en traits de ligne médiane ; surligneur en mode de
  fusion *Multiply* (ExtGState), comme à l'écran.

## Feuille de route

| Étape | Contenu | État |
|---|---|---|
| 0 | Socle : Vite, TS, PWA, Dexie, Yjs, thèmes, tests | ✅ |
| 1a | Bibliothèque, pages, stylo (3 pointes, pression, tirets/pointillés), surligneur, gomme, zoom, rejet de paume, annuler/rétablir | ✅ |
| 1b | Lasso ; import PDF/images ; export PDF avec/sans annotations ; archive `.papier` | ✅ |
| 2 | Crayon, gribouiller-pour-effacer, formes, texte, images, autocollants, modèles Cornell/planner/importés | ✅ |
| 3 | PDF : sommaire, liens ; recherche plein texte | ✅ |
| 4 | Canevas infini, post-its, connecteurs | ✅ |
| 5 | Audio synchronisé, transcription | ✅ |
| 6 | Reconnaissance d'écriture, recherche manuscrite | |
| 7 | Flashcards (SM-2) | |
| 8 | Couche IA optionnelle | |
| 9 | Présentation, pointeur laser | |
| 10 | Synchro, partage, collaboration temps réel | |
