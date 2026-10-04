# Papier — cahier numérique manuscrit

Web app installable (PWA) de prise de notes au stylet, pensée pour tablette
(Apple Pencil, stylets USI/Wacom/S Pen) et utilisable à la souris ou au trackpad.
Fonctionne entièrement hors ligne : les données restent dans le navigateur (IndexedDB).

## Lancer

Prérequis : Node.js 20 ou plus récent.

```bash
cd papier
npm install
npm run dev          # http://localhost:5173 (et l'adresse réseau local affichée)
```

Pour tester sur une tablette, ouvrez l'adresse « Network » affichée par Vite
(même réseau Wi-Fi). Pour tester l'installation PWA et le hors-ligne :

```bash
npm run build
npm run preview      # sert la version de production (http://localhost:4173)
```

> L'installation PWA et le service worker exigent HTTPS, sauf sur `localhost`.
> Sur iPad : Safari → Partager → « Sur l'écran d'accueil ».

Autres commandes :

| Commande        | Rôle                                   |
|-----------------|----------------------------------------|
| `npm test`      | tests unitaires (Vitest)               |
| `npm run check` | vérification des types (svelte-check)  |

Le dossier `dist/` produit par `npm run build` est statique : il peut être servi
depuis n'importe quel sous-dossier (GitHub Pages, Netlify, serveur web…).

## Utilisation

| Action | Stylet / doigt | Souris / clavier |
|---|---|---|
| Écrire | stylet | clic gauche |
| Défiler | 1 doigt (dès qu'un stylet a été utilisé) | molette, clic milieu, Espace + glisser |
| Zoomer | pincer | Ctrl/⌘ + molette, pincement trackpad, `+` / `-`, `0` = ajuster |
| Annuler / rétablir | tap 2 doigts / tap 3 doigts | Ctrl/⌘+Z / Ctrl/⌘+Maj+Z |
| Outils | barre d'outils | `P` stylo, `H` surligneur, `E` gomme, `L` lasso |
| Sélection (lasso) | entourer, ou toucher un trait | Ctrl/⌘+C / X / V / D, Suppr, Échap, Ctrl/⌘+A |

**Lasso** : entourez des traits (ou touchez-en un) pour les sélectionner, glissez
la sélection pour la déplacer, tirez une poignée d'angle pour la redimensionner ;
la barre flottante permet de recolorer, copier, couper, dupliquer, supprimer.

**PDF et images** :
- *Bibliothèque → Importer* (ou glisser-déposer) : un PDF ou des images deviennent
  un nouveau carnet, une page par page/image. Le PDF d'origine est conservé tel quel.
- *Dans un carnet → menu ⋯ → Insérer un PDF ou des images* (ou glisser-déposer sur la page).
- *Exporter en PDF* (avec ou sans annotations) : depuis le menu ⋯ d'un carnet ouvert
  ou d'une couverture. Les pages PDF d'origine sont recopiées à l'identique (texte
  sélectionnable conservé) et l'encre reste vectorielle.

**Sauvegarde** : *Sauvegarder (.papier)* sur un carnet, ou *Réglages → Sauvegarder la
bibliothèque*. *Importer* ou *Restaurer une sauvegarde* relit ces fichiers ; tout est
importé en copie, rien d'existant n'est écrasé.

« Écrire au doigt » (réglages de la bibliothèque) : *Auto* (le doigt écrit tant
qu'aucun stylet n'a été détecté), *Toujours* ou *Jamais*.

## Compatibilité

Navigateurs récents (Safari/iPadOS 16.4+, Chrome/Edge, Firefox). Les PDF sont lus
avec la version « legacy » de pdf.js, qui embarque les compléments nécessaires aux
navigateurs un peu plus anciens. pdf.js n'est téléchargé qu'à la première ouverture
d'un PDF, puis gardé en cache pour le hors-ligne.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, organisation du code, moteur d'encre, feuille de route.
- [docs/FORMAT.md](docs/FORMAT.md) — format des données (pour ne jamais être enfermé).
