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
| Outils | barre d'outils | `P` stylo, `H` surligneur, `E` gomme |

« Écrire au doigt » (réglages de la bibliothèque) : *Auto* (le doigt écrit tant
qu'aucun stylet n'a été détecté), *Toujours* ou *Jamais*.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, organisation du code, moteur d'encre, feuille de route.
- [docs/FORMAT.md](docs/FORMAT.md) — format des données (pour ne jamais être enfermé).
