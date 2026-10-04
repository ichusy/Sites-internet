# Papier — cahier numérique manuscrit

Web app installable (PWA) de prise de notes au stylet, pensée pour tablette
(Apple Pencil, stylets USI/Wacom/S Pen) et utilisable à la souris ou au trackpad.
Fonctionne entièrement hors ligne : les données restent dans le navigateur (IndexedDB).

## Lancer

Prérequis : Node.js 20 ou plus récent. (Le fichier `.npmrc` évite à `npm install`
de télécharger les binaires natifs d'ONNX Runtime pour Node, inutiles ici : la
transcription tourne dans le navigateur.)

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
| `npm run check` | vérification des types (application et serveur) |
| `npm run server` | serveur de synchronisation (voir plus bas) |

Le dossier `dist/` produit par `npm run build` est statique : il peut être servi
depuis n'importe quel sous-dossier (GitHub Pages, Netlify, serveur web…).

## Utilisation

| Action | Stylet / doigt | Souris / clavier |
|---|---|---|
| Écrire | stylet | clic gauche |
| Défiler | 1 doigt (dès qu'un stylet a été utilisé) | molette, clic milieu, Espace + glisser |
| Zoomer | pincer | Ctrl/⌘ + molette, pincement trackpad, `+` / `-`, `0` = ajuster |
| Annuler / rétablir | tap 2 doigts / tap 3 doigts | Ctrl/⌘+Z / Ctrl/⌘+Maj+Z |
| Outils | barre d'outils | `P` stylo, `C` crayon, `H` surligneur, `E` gomme, `L` lasso, `T` texte, `N` post-it, `K` connecteur |
| Audio | micro de la barre d'outils | `R` enregistrer, `Espace` lecture / pause |
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

**Tableau blanc infini** : *Nouveau carnet → Type : Tableau blanc infini*. Une
seule surface sans bords, fond pointillé ; on dézoome jusqu'à 8 % pour avoir une
vue d'ensemble, et `0` (ou un clic sur le pourcentage de zoom, *Tout voir*) cadre tout le contenu.
Tous les outils y fonctionnent (encre, texte, images, lasso, recherche, export PDF :
une page unique à la taille du contenu).

**Post-its** (`N`) : toucher pour en poser un et écrire dedans ; toucher un post-it
existant pour modifier son texte. Couleur et taille du texte dans la barre d'outils.
Il grandit avec son texte ; le lasso le déplace, le redimensionne, le fait pivoter.

**Connecteurs** (`K`) : glisser d'un élément (post-it, texte, image) vers un autre
pour les relier par une courbe ; ils suivent les éléments quand on les déplace et
disparaissent avec eux. Partir ou arriver dans le vide crée une extrémité libre.
Couleur, épaisseur et flèches (aucune, à la fin, aux deux bouts) dans la barre
d'outils. Disponibles aussi dans les carnets de pages.

**Audio synchronisé** (micro de la barre d'outils, ou `R`) :
- Pendant l'enregistrement, une pastille en haut de la page affiche la durée et le
  niveau sonore ; elle permet de mettre en pause, reprendre et arrêter. L'audio
  est écrit sur l'appareil au fil de l'eau : si l'onglet se ferme, l'enregistrement
  est récupéré à la prochaine ouverture du carnet.
- Onglet *Audio* du panneau latéral : liste des enregistrements, lecteur (±10 s,
  vitesse 0,75× à 2×). Pendant la lecture, l'écriture **réapparaît au rythme de la
  voix** (ce qui n'était pas encore écrit est estompé) et la vue suit ce qui s'écrit.
- *Toucher l'écriture pour écouter* (bouton oreille) : toucher un trait, un texte
  ou une image fait entendre ce qui se disait quand il a été écrit (2 s avant).
  Même chose depuis une sélection au lasso (bouton oreille de la barre de sélection).
- *Importer* : un fichier audio existant (mp3, m4a, wav…), lisible et transcriptible
  (sans synchronisation, puisqu'il n'a pas été enregistré pendant l'écriture).
- **Transcription** : bouton *Transcrire*. Whisper fonctionne dans le navigateur
  (WebGPU s'il est disponible, sinon le processeur) : l'audio ne quitte pas
  l'appareil. Le modèle (*Rapide* ~40 Mo, *Équilibré* ~80 Mo, *Précis* ~250 Mo)
  est téléchargé depuis Hugging Face à la première utilisation, puis disponible
  hors ligne. Les phrases s'affichent au fil de la transcription ; toucher une
  phrase lit l'audio à cet endroit. Export en texte (.txt) ou sous-titres (.vtt).
- Les transcriptions sont cherchables dans le carnet et dans la bibliothèque.

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

## Synchronisation, partage et collaboration (facultatif)

Sans compte, tout reste sur l'appareil. Avec votre propre **serveur Papier**, vous
retrouvez vos carnets sur tous vos appareils, ils sont sauvegardés (avec un
historique) et vous pouvez les partager par lien et écrire à plusieurs en temps réel.

### Installer le serveur (Docker, HTTPS automatique)

Sur une machine accessible depuis Internet (petit VPS, ~5 €/mois, ou machine chez
vous avec le port 443 ouvert), avec Docker installé :

```bash
git clone <ce dépôt> && cd <dépôt>/papier
cp .env.example .env        # puis indiquez votre domaine : DOMAIN=notes.exemple.fr
docker compose up -d        # Papier + Caddy (certificat HTTPS Let's Encrypt automatique)
```

Le nom de domaine doit pointer vers la machine (enregistrement DNS A/AAAA). Ouvrez
ensuite `https://notes.exemple.fr` : c'est l'application, servie par le serveur.
*Réglages ⚙ → Se connecter à un serveur…* : créez le **premier compte** (le vôtre).
La création d'autres comptes est fermée, sauf `ALLOW_SIGNUP=true` dans `.env` ;
les personnes avec qui vous partagez n'ont pas besoin de compte.

HTTPS est indispensable (installation PWA, micro, presse-papiers). Les données du
serveur sont dans le volume Docker `papier-data` (base SQLite + fichiers) : à
sauvegarder comme n'importe quel dossier (`docker compose cp papier:/data ./sauvegarde`).

Sans Docker (Node.js ≥ 22.18) : `npm run build` puis

```bash
PUBLIC_URL=https://notes.exemple.fr DATA_DIR=/var/lib/papier npm run server
```

derrière un proxy HTTPS (Caddy, nginx…) qui transmet aussi les WebSocket (`/sync/`).

| Variable | Défaut | Rôle |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:8787` | adresse publique, utilisée dans les liens de partage |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | écoute |
| `DATA_DIR` | `./papier-data` | base SQLite et fichiers |
| `ALLOW_SIGNUP` | `false` | autoriser d'autres comptes que le premier |
| `STATIC_DIR` | `./dist` | application servie (vide : API seule) |
| `MAX_UPLOAD_MB` | `500` | taille maximale d'un fichier envoyé |

### Utiliser

- **Se connecter** : *Réglages → Se connecter à un serveur…* (adresse pré-remplie si
  l'application est servie par votre serveur). Les carnets déjà présents sur
  l'appareil sont envoyés ; ceux des autres appareils arrivent. L'état s'affiche en
  bas de la barre latérale (*Synchronisé*, *Hors ligne*…).
- **Plusieurs appareils** : dossiers, carnets, pages, audio, PDF se synchronisent ;
  un carnet ouvert sur deux appareils se met à jour en direct. Hors ligne, on
  continue normalement : les modifications des deux côtés sont **fusionnées** au
  retour du réseau, sans conflit ni perte.
- **Partager** : dans un carnet, menu *⋯ → Partager…* → *Lien de lecture* ou *Lien
  de modification* (copié automatiquement). La personne ouvre le lien, sans compte ;
  le carnet apparaît dans sa bibliothèque avec la mention « Partagé par … ». Avec un
  lien de modification, on écrit ensemble : chacun voit le **curseur** et le **trait
  en cours** des autres. Un lien se désactive à tout moment (icône corbeille).
- **Historique** : menu *⋯ → Historique des versions…* : une version par heure de
  modification (toutes celles des 2 derniers jours, puis une par jour pendant un
  mois, une par semaine pendant un an). *Ouvrir une copie* crée un nouveau carnet
  à partir de cette version.
- **Se déconnecter** laisse les carnets sur l'appareil.

## Compatibilité

Navigateurs récents (Safari/iPadOS 16.4+, Chrome/Edge, Firefox). Enregistrement
audio : Opus (WebM/Ogg) sur Chrome, Edge, Firefox ; AAC (MP4) sur Safari. La
transcription demande un appareil récent (WebGPU accélère nettement sur Chrome,
Edge et Safari 26) ; une heure d'audio occupe environ 230 Mo de mémoire pendant
la transcription. Les PDF sont lus
avec la version « legacy » de pdf.js, qui embarque les compléments nécessaires aux
navigateurs un peu plus anciens. pdf.js n'est téléchargé qu'à la première ouverture
d'un PDF, puis gardé en cache pour le hors-ligne.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, organisation du code, moteur d'encre, feuille de route.
- [docs/FORMAT.md](docs/FORMAT.md) — format des données (pour ne jamais être enfermé).
