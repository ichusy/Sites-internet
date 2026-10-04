# Format des données (schéma v2)

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

### `templates` (modèles de page importés)
`{ id, name, assetId, kind: "image" | "pdf", pageIndex, width, height, createdAt }`.
Une page qui utilise un tel modèle en garde une copie autonome dans son
`template.source` (voir plus bas) : supprimer le modèle de la liste ne casse rien.

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
             template   { kind: "blank"|"lined"|"grid"|"dots"|"cornell"|"planner"|"custom",
                          spacing: number,
                          source?: { assetId, kind: "image"|"pdf", pageIndex, templateId?, name? } }  // kind = custom
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

Champs supplémentaires (v2), optionnels :

| Champ | Sens |
|---|---|
| `tool: "pencil"` | crayon (contour rempli d'un grain ; en PDF : légère transparence) |
| `shape` | `"line" \| "ellipse" \| "rect" \| "triangle" \| "polygon"` : forme reconnue ; les points sont alors les **sommets**, reliés par des segments droits et tracés comme une ligne de largeur `width` |
| `closed` | la forme est fermée (dernier sommet relié au premier) |

### Élément `text`

```jsonc
{
  "type": "text", "id": "…", "z": 1759600000000.0,
  "x": 50, "y": 300, "width": 300,   // zone (repère local), le texte revient à la ligne à `width`
  "height": 40,                      // hauteur calculée à la saisie
  "text": "Mitochondrie…\nDeuxième ligne",
  "fontSize": 14, "color": "#2f5fd0",
  "transform": [a,b,c,d,e,f],        // optionnel : rotation / échelle / déplacement
  "bbox": [minX, minY, maxX, maxY]
}
```

Police : Helvetica (ou équivalent), interligne 1,3 × `fontSize`, ligne de base de
la ligne *i* à `y + i·1,3·fontSize + fontSize`.

### Élément `image`

```jsonc
{
  "type": "image", "id": "…", "z": …, "assetId": "<sha256>",
  "x": 100, "y": 100, "width": 144, "height": 144,   // l'image remplit ce rectangle
  "sticker": true,                                   // optionnel : autocollant intégré
  "transform": [a,b,c,d,e,f], "bbox": […]
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
| `library.json` | `{ "folders": FolderRecord[], "notebooks": NotebookRecord[], "templates"?: TemplateRecord[] }` |
| `notebooks/<id>.json` | contenu lisible du carnet (voir ci-dessous) |
| `notebooks/<id>.ydoc` | état Yjs complet (`Y.encodeStateAsUpdate`), pour une restauration sans perte |
| `assets.json` | `[{ id, mime, size, file }]` |
| `assets/<sha256>.<ext>` | fichiers utilisés (fonds PDF/images, modèles importés, images et autocollants), à l'identique |

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

- **v1** : traits (stylo, surligneur), fonds PDF/images.
- **v2** : crayon, formes, texte, images/autocollants, modèles Cornell, semainier
  et importés. Un carnet v1 se lit tel quel en v2 (champs uniquement ajoutés).
