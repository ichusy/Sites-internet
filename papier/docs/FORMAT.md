# Format des données (schéma v1)

Toutes les données sont stockées localement dans IndexedDB. Ce document décrit
leur structure pour qu'elles restent lisibles sans l'application. Les archives
`.papier` (voir en fin de document) reprennent exactement ces structures.

## Unités

- Coordonnées en **points PDF** (1/72 de pouce), origine en haut à gauche de la
  page, axe Y vers le bas. A4 portrait = 595,28 × 841,89.
- Couleurs en hexadécimal CSS `#rrggbb`. Dates en millisecondes Unix.

## Base `papier` (Dexie)

### `folders`
| Champ | Type | |
|---|---|---|
| id | string | |
| parentId | string \| null | null = racine |
| name | string | |
| createdAt, updatedAt | number | |

### `notebooks`
| Champ | Type | |
|---|---|---|
| id | string | |
| folderId | string \| null | |
| title | string | |
| kind | `"paged"` \| `"canvas"` | |
| cover | `{ color, pattern }` | pattern ∈ plain, stripes, dots, grid, diagonal |
| favorite | boolean | |
| tags | string[] | |
| pageCount | number | copie pour l'affichage |
| paper | `{ width, height }` | format des nouvelles pages |
| template | TemplateRef | modèle des nouvelles pages |
| createdAt, updatedAt, openedAt | number | |

### `assets`
Fichiers binaires (PDF, images, audio) adressés par leur empreinte SHA-256 :
`{ id, mime, size, blob, createdAt }`. Un même fichier importé deux fois n'est
stocké qu'une fois.

Une page issue d'un PDF a pour fond `{ kind: "pdf", assetId, pageIndex }`
(`pageIndex` commence à 0) et prend la taille de la page affichée par pdf.js
(CropBox, rotation appliquée). Une page issue d'une image a pour fond
`{ kind: "image", assetId }`, l'image étant étirée sur toute la page.

## Base `papier-nb-<id>` (un document Yjs par carnet)

Base y-indexeddb contenant les mises à jour Yjs du document :

```
meta       Y.Map    { schemaVersion: 1, title }
pageOrder  Y.Array<string>          identifiants des pages, dans l'ordre
pages      Y.Map<string, Y.Map>     une Y.Map par page :
             id         string
             width      number
             height     number
             template   { kind: "blank"|"lined"|"grid"|"dots", spacing: number }
             background { kind: "pdf", assetId, pageIndex } | { kind: "image", assetId }   (optionnel)
             elements   Y.Map<string, Element>
```

### Élément `stroke`

```jsonc
{
  "type": "stroke",
  "id": "…",
  "z": 1759600000000.0,       // ordre d'empilement (croissant = au-dessus)
  "tool": "pen" | "highlighter",
  "brush": "ballpoint" | "fountain" | "brush",
  "color": "#1f2430",
  "width": 1.1,               // épaisseur nominale (points)
  "opacity": 1,
  "dash": "solid" | "dashed" | "dotted",
  "pressure": true,           // pression matérielle (stylet) ou simulée
  "points": Uint8Array,       // voir ci-dessous
  "transform": [a,b,c,d,e,f], // optionnel : matrice appliquée aux points (x' = a·x + c·y + e, y' = b·x + d·y + f)
  "bbox": [minX, minY, maxX, maxY],
  "t0": 1759600000000         // horodatage du premier point
}
```

**Encodage de `points`** : suite de points de 16 octets, chacun composé de
4 flottants IEEE-754 32 bits **little-endian** :

| Octets | Champ |
|---|---|
| 0–3 | x (points, repère de la page) |
| 4–7 | y |
| 8–11 | pression 0..1 (0,5 si simulée) |
| 12–15 | t : millisecondes écoulées depuis `t0` |

L'horodatage par point servira à la relecture synchronisée avec l'audio.

Le lasso ne réécrit jamais les points : un déplacement ou un redimensionnement
compose la matrice `transform` existante, et un agrandissement multiplie `width`
par le même facteur. Les coordonnées affichées sont donc `transform(points)`.

Rendu de référence : contour [perfect-freehand](https://github.com/steveruizok/perfect-freehand)
pour le stylo plein ; ligne médiane de largeur `width` pour le surligneur
(composition *multiply*) et les traits pointillés/tirets.

## Archive `.papier`

Fichier zip :

| Chemin | Contenu |
|---|---|
| `manifest.json` | `{ "format": "papier-archive", "version": 1, "exportedAt": "…" }` |
| `library.json` | `{ "folders": FolderRecord[], "notebooks": NotebookRecord[] }` |
| `notebooks/<id>.json` | contenu lisible du carnet (voir ci-dessous) |
| `notebooks/<id>.ydoc` | état Yjs complet (`Y.encodeStateAsUpdate`), pour une restauration sans perte |
| `assets.json` | `[{ id, mime, size, file }]` |
| `assets/<sha256>.<ext>` | fichiers importés (PDF, images), à l'identique |

`notebooks/<id>.json` :

```jsonc
{
  "schemaVersion": 1,
  "title": "Biologie cellulaire",
  "pages": [
    { "id": "…", "width": 595.28, "height": 841.89,
      "template": { "kind": "lined", "spacing": 22.68 },
      "background": { "kind": "pdf", "assetId": "…", "pageIndex": 0 },   // optionnel
      "elements": [ { "type": "stroke", …, "points": "<base64>" } ]       // triés par z
    }
  ]
}
```

`points` y est le même binaire que ci-dessus, encodé en base64. À l'import, Papier
utilise `.ydoc` s'il est présent, sinon reconstruit le carnet depuis le JSON : une
archive produite par un autre outil n'a besoin que du JSON. Tout est importé sous
de nouveaux identifiants ; rien d'existant n'est écrasé.

## Évolution

Toute modification incompatible incrémente `meta.schemaVersion` et s'accompagne
d'une migration automatique à l'ouverture du carnet.
