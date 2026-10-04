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
| Outils | barre d'outils | `P` stylo, `C` crayon, `H` surligneur, `E` gomme, `L` lasso, `T` texte |
| Sélection (lasso) | entourer, ou toucher un trait | Ctrl/⌘+C / X / V / D, Suppr, Échap, Ctrl/⌘+A |

**Lasso** : entourez des traits (ou touchez-en un) pour les sélectionner, glissez
la sélection pour la déplacer, tirez une poignée d'angle pour la redimensionner ;
la barre flottante permet de recolorer, copier, couper, dupliquer, supprimer.

**Gestes d'écriture** (désactivables dans les réglages ⚙ du stylo) :
- *Maintenir* la pointe immobile ~½ s en fin de tracé : le trait devient une ligne,
  un cercle/ellipse, un rectangle, un triangle ou un polygone net (aimanté aux axes).
- *Gribouiller* par-dessus des traits : ils sont effacés (le gribouillis aussi).
- *Entourer* des éléments au stylo puis *toucher* l'intérieur dans les 2,5 s :
  la boucle disparaît et son contenu est sélectionné ; la sélection levée, on
  retrouve le stylo.

**Lasso** : poignées d'angle pour redimensionner, poignée ronde au-dessus pour
faire pivoter (aimantée tous les 45°). Fonctionne sur l'encre, le texte, les images.

**Texte tapé** (`T`) : toucher la page pour créer une zone (glisser horizontalement
pour choisir sa largeur), toucher une zone existante pour la modifier. Couleur et
taille dans la barre d'outils, y compris pendant la saisie.

**Images et autocollants** : bouton d'insertion de la barre d'outils (photo,
image ou l'un des 16 autocollants intégrés), placés au centre de la page.

**Modèles de page** : blanc, ligné, quadrillé, pointillé, Cornell, semainier, ou
*Importer un modèle…* (une image ou la 1re page d'un PDF), depuis le menu d'une
page ou à la création d'un carnet.

**Sommaire et liens des PDF** : bouton *Sommaire* de la barre d'outils (sommaire
intégré au PDF, cliquable, sur plusieurs niveaux). Les liens d'un PDF se suivent
d'un toucher du doigt, ou avec l'outil lasso (ils y sont matérialisés), ou par
Ctrl/⌘ + clic ; un lien vers le web demande confirmation avant de s'ouvrir.

**Recherche** :
- dans un carnet : *Ctrl/⌘+F* ou bouton loupe. Cherche dans le texte tapé et le
  texte des PDF, sans tenir compte des accents ni des majuscules ; toutes les
  occurrences sont surlignées, *Entrée* / *Maj+Entrée* passent d'une page à l'autre ;
- dans toute la bibliothèque : le champ de recherche affiche aussi les pages dont
  le contenu correspond ; un clic ouvre le carnet à la bonne page, recherche active.

L'écriture manuscrite n'est pas encore cherchable (reconnaissance d'écriture : étape 6).

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
