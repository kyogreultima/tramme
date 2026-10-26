# Refonte de la direction artistique : un seul design pour toute l'application

Plan d'implémentation. La référence visuelle et la source des valeurs est la planche [board.html](board.html), à ouvrir dans un navigateur (le sélecteur en haut change de thème). Ce plan dit quoi changer, où et dans quel ordre ; la planche dit à quoi ça ressemble.

## 0. Contexte

L'éditeur a deux vues :
- le **Studio**, où l'on dirige le film par des notes (ajouté récemment) ;
- l'**Atelier**, avec les calques, la timeline, les courbes et l'inspecteur.

L'organisation du Studio est validée. Trois problèmes restent :

1. **Couleur hors thème.** Le Studio utilise une couleur qui n'appartient à aucun thème : `--ai`, un violet `#8b7bff`. Il l'accompagne de dégradés, de halos et d'étincelles ✦. Tout cela est à retirer.
2. **Design classique d'éditeur.** Tout le reste (accueil, paramètres, Atelier, menus, dialogues) ressemble encore à Adobe :
   - panneaux bord à bord séparés par des filets ;
   - onglets ;
   - textes de 10,5 à 12 px ;
   - une douzaine de rayons différents (de 3 à 13 px) ;
   - une quarantaine de couleurs hexadécimales et une trentaine de `rgba()` écrites en dur dans les feuilles.
3. **Aucune police chargée.** `Inter` n'est utilisée que si elle est installée sur la machine ; sinon c'est Segoe UI.

**But** : une direction artistique uniforme dans toute l'application, construite uniquement sur le système de thèmes. Elle s'aligne sur celle du site (`apps/site/src/styles/global.css`) :
- Geist et Geist Mono ;
- le teal comme seul accent ;
- médias et panneaux à 14 px ;
- boutons en pilule.

**Prérequis** : committer l'état actuel (le Studio est dans l'arbre de travail, non commité), pour pouvoir comparer avant et après.

## 1. Principes (partout, sans exception)

1. **L'image d'abord.** Le chrome s'efface ; l'accent est réservé à ce qui compte.
2. **Une seule matière.** Des surfaces arrondies posées sur un fond calme, séparées par de l'espace (gouttières de 8 px) et non par des filets. La profondeur vient de la valeur des surfaces et d'ombres douces.
3. **La couleur du thème, rien d'autre.** Aucune couleur en dur hors des blocs de tokens. Un seul accent, le teal, pour :
   - l'action principale ;
   - la sélection ;
   - le focus ;
   - « Tramme au travail ».
4. **Pas de clichés IA.** Ni violet, ni dégradé décoratif, ni halo, ni étincelle. L'assistant, c'est Tramme : sa marque (`LogoMark`) et l'accent du thème. Une prise se signale par une claquette (nouvelle icône `clap`).
5. **Des formes cohérentes.** Une seule échelle de rayons :
   - boutons texte en pilule ;
   - boutons icône en carré arrondi à 8 px ;
   - panneaux et cartes à 14 px ;
   - dialogues à 20 px.
6. **Lisible.**
   - Le texte de base passe de 12 à 13 px.
   - Chiffres, temps et tailles en Geist Mono tabulaire.
   - Contrastes AA, vérifiés pour chaque thème (§2).
7. **Un composant par motif.** Un seul contrôle segmenté, un seul menu, un seul type d'étiquette, de puce, de carte et de ligne de liste (§4).

## 2. Thèmes

- **Les thèmes restent.** Studio, obsidienne, carbone, crépuscule et papier, plus « système ». Leurs valeurs changent un peu.
- **Une même règle par thème** : une teinte, une saturation, et des paliers de luminosité fixes pour chaque rôle. Les thèmes se valent donc tous. Contrastes mesurés sur les surfaces :
  - texte principal : 13:1 ou plus ;
  - texte secondaire : 7:1 ou plus ;
  - texte tertiaire : environ 4,4:1 ou plus ;
  - accent : 8:1 en sombre, 4,8:1 en clair.
- **Papier rejoint le thème clair du site** : fond `#f0f4f7`, surfaces blanches. Son accent devient `#0b8075`, celui du site, plus lisible que l'actuel `#12968a`. Ses couleurs de sens (validé, alerte, lien, expression, danger) sont foncées pour rester lisibles en texte.
- **Source unique des valeurs** : la partie `1. TOKENS` de [board.html](board.html). Elle se copie telle quelle dans `apps/editor/src/theme/tokens.css`.
- **Deux tables à recopier** dans `apps/editor/src/settings.ts` :
  - `THEMES` (les couleurs de l'aperçu de chaque thème) reprend `bg`, `surface` et `accent` de chaque thème ;
  - `BAR` (la couleur de la barre de fenêtre) reprend `bg`.

### 2.1 Rôles

| Rôle | Tokens | Sert à |
|---|---|---|
| Fond | `--bg` | derrière les panneaux, la barre du haut |
| Surfaces | `--surface`, `--surface-2`, `--raised` | panneaux et cartes ; zones internes (rangées groupées, puits) ; ce qui flotte (menus, popovers, dialogues) |
| Champs | `--field`, `--field-hover`, `--field-active` | champs, boutons secondaires, pistes des contrôles segmentés |
| Scène | `--stage` | derrière l'image (studio, viewport de l'atelier) |
| Texte | `--text`, `--text-2`, `--text-3`, `--text-4` | principal, secondaire, tertiaire (méta, aides), désactivé |
| Filets | `--line`, `--line-strong`, `--line-soft` | rares : séparations internes, contours ; transparents, ils vont sur toutes les surfaces |
| États | `--hover`, `--press` | survol et appui des lignes, boutons fantômes, boutons icône |
| Accent | `--accent`, `--accent-hover`, `--accent-soft`, `--accent-line`, `--accent-text`, `--on-accent` | action principale ; sélection (fond doux) ; focus et contours ; accent en texte ; texte sur l'accent |
| Sens | `--ok`, `--danger`, `--key`, `--expr`, `--link` (et leurs `-soft`), `--on-danger` | validé, danger, images clés et alertes, expressions, liens |
| Types de calque | `--t-shape`, `--t-text`, `--t-image`, `--t-group`, `--t-code`, `--t-audio` | icônes et clips de la timeline : des couleurs de données, jamais de chrome |
| Élévation | `--shadow-1`, `--shadow-2`, `--shadow-3`, `--picture-shadow` | panneaux et cartes au repos ; ce qui flotte ; dialogues ; l'image |
| Verre, voile | `--float`, `--scrim` | ce qui flotte sur l'image ; derrière un dialogue |
| Sur une image | `--on-media`, `--media-scrim` | étiquettes posées sur des images (les mêmes dans tous les thèmes) |
| Technique | `--grid`, `--handle`, `--handle-line`, `--mark`, `--mark-ring`, `--out-range`, `--error-bg`, `--error-text`, `--tour-overlay`, `--tour-overlay-opacity`, `--checker-a`, `--checker-b`, `--scroll`, `--scroll-hover`, `--code` | grille et poignées sur l'image, image clé choisie, hors durée, erreur de rendu, visite guidée, damier, défilement, code |

### 2.2 Échelles (dans `:root`, communes à tous les thèmes)

**Typographie**
- Tailles :
  - `--fs-xs` 11 ;
  - `--fs-sm` 12 ;
  - `--fs-md` 13 (la base) ;
  - `--fs-lg` 15 ;
  - `--fs-xl` 18 ;
  - `--fs-2xl` 24 ;
  - `--fs-hero` de 32 à 48.
- Graisses :
  - 400 pour le texte ;
  - 500 pour les contrôles ;
  - 600 pour les titres ;
  - 650 pour les grands titres.
- Les titres sont resserrés de −0,01 à −0,035 em, comme sur le site.

**Rayons**
- Échelle :
  - `--r-xs` 4 ;
  - `--r-sm` 8 ;
  - `--r-md` 12 ;
  - `--r-lg` 14 ;
  - `--r-xl` 20 ;
  - `--r-pill` 999.
- Aucune autre valeur. Seules exceptions : 6 px pour les clips et les étiquettes, 50 % pour les ronds.

**Espace**
- `--sp-1` à `--sp-10`, de 4 à 40 px.
- `--gutter` : 8 px.

**Hauteurs**
- `--h-xs` 22 ;
- `--h-sm` 26 ;
- `--h-md` 30 ;
- `--h-lg` 36 ;
- `--row` 28 (au lieu de 26).
- Les règles `pointer: coarse` existantes agrandissent toujours les cibles tactiles.

**Mouvement**
- `--ease`, la courbe du site.
- `--t-fast` 120 ms, `--t-med` 180 ms, `--t-slow` 260 ms.
- Respecter `prefers-reduced-motion`.

**Focus**
- `--focus` : un anneau d'accent de 2 px, détaché du composant.

### 2.3 Renommages (ancien vers nouveau)

| Ancien | Nouveau |
|---|---|
| `--panel`, `--panel-2` | `--surface`, `--surface-2` |
| `--accent-2` | `--accent-hover` |
| `--hover-soft` | `--hover` |
| `--edge-soft`, `--edge`, `--edge-hover` | `--line`, `--line-strong`, `--line-strong` |
| `--radius` (6), `--radius-sm` (4) | `--r-sm` (8) ; revoir chaque usage (contrôles 8, cartes 14) |
| `--shadow`, `--shadow-soft`, `--card-shadow` | `--shadow-2` |
| `--glass` | `--float` |
| `--picture-shadow` (une couleur) | `--picture-shadow` (une ombre entière : `box-shadow: var(--picture-shadow)`) |
| `--clip-base`, `--sunken` | `--surface-2` |
| `--media` | `--stage` |
| `--play-hover` | supprimé (la lecture suit `--text`) |
| `--ai`, `--ai-soft`, `--ai-line`, `--ai-grad`, `--ai-glow` (studio.css) | supprimés ; à la place `--accent`, `--accent-soft`, `--accent-line` |

### 2.4 Police

- Installer les deux paquets (licence OFL-1.1) :
  - `npm i @fontsource-variable/geist@5.3.0 @fontsource-variable/geist-mono@5.3.0` ;
  - ajouter les deux à `THIRD_PARTY_NOTICES.md`.
- Les importer en tête de `apps/editor/src/main.tsx` **et** de `apps/editor/src/vault/main.tsx` :
  - `import '@fontsource-variable/geist';`
  - `import '@fontsource-variable/geist-mono';`
- esbuild empaquette les `.woff2` : le chargeur `file` existe déjà dans `apps/editor/build.ts`. La police marche donc hors ligne (mode personnel, application de bureau).
- Les familles s'appellent `'Geist Variable'` et `'Geist Mono Variable'`. Elles sont déjà en tête de `--ui` et `--mono` dans les tokens.
- Ne pas confondre avec le dossier `fonts/` à la racine : ce sont les polices que les films embarquent, rien à y changer.

## 3. Organisation des feuilles de style

`styles.css` (1 250 lignes) et `studio.css` (400) mêlent tout. Les découper et les importer dans cet ordre, dans `main.tsx` et `vault/main.tsx` :

| Fichier (dans `apps/editor/src/`) | Contenu |
|---|---|
| `theme/tokens.css` | les thèmes et les échelles (copie de la planche) |
| `theme/base.css` | reset, `body`, typographie, défilement, focus, sélection, utilitaires (`.mono`, `.t2`, `.t3`) |
| `theme/components.css` | les composants du §4 |
| `screens/home.css` | l'accueil et ses dialogues |
| `screens/settings.css` | les paramètres et la page du coffre (mode personnel) |
| `screens/conversation.css` | le fil (notes, travail, prises) et la zone de saisie, communs au studio et à l'atelier |
| `screens/studio.css` | le studio (l'actuel `studio.css`, nettoyé) |
| `screens/atelier.css` | le cadre de l'atelier, le panneau gauche, le viewport, le transport, la timeline, les courbes, l'inspecteur |

Les sections actuelles de `styles.css` (`/* ── top bar ── */`, `/* ── buttons ── */`…) se répartissent dans ces fichiers. Chaque règle est réécrite avec les tokens.

## 4. Composants : un par motif

La partie `2. COMPOSANTS` de la planche donne la forme exacte de chacun : classes, tailles, états. Ce qui change dans le code :

| Motif | Aujourd'hui | Cible |
|---|---|---|
| Bouton texte | `.btn` : rayon 6, bordure, 28 px | `.btn` en pilule, sans bordure, 30 px ; variantes `primary`, `outline`, `ghost`, `danger` (+ `solid`) ; tailles `sm`, `lg` |
| Bouton icône | `.icon-btn` (+ `.sm`, `.xs`), `.send`, `.sb-play`, `.transport .play`, `.pill-stop`, `.kbtn`, `.twist` | `.icon-btn` en carré arrondi à 8 px (variante `round` dans les barres flottantes). Lecture : rond plein `--text`. Envoi : rond `--accent` |
| Contrôle segmenté | six variantes (détail sous le tableau) | **un seul** : `Seg` de `controls.tsx`, étendu (sous le tableau) |
| Champ | `.field` : 24 px, rayon 4 | `.field` : 30 px, rayon 8, sans bordure, anneau d'accent au focus ; `num`, `area`, `code` gardés |
| Liste de choix | `Select` = `<select>` natif, dont la liste déroulante est celle du système et ne se stylise pas | `Select` = un champ et son chevron qui ouvre un **menu** (le même `MenuHost`) ; clavier complet (détail sous le tableau) ; garder le `<select>` natif sur écran tactile (`pointer: coarse`) |
| Interrupteur | `.toggle` 28×16 | 34×20 |
| Étiquette, à lire | neuf classes (détail sous le tableau) | `.tag` (+ `accent`, `ok`, `danger`, `key`) |
| Puce, à cliquer | `.suggest button`, `.hero-ideas button`, `.chip-btn`, `.ctx-chip`, `.sb-focus` | `.chip` (+ `on`) |
| Menu | `.menu` : rayon 8, éléments de 28 px | rayon 12, éléments de 32 px au rayon 8 ; ajouts détaillés sous le tableau |
| Popover | `.popover` : rayon 10 | rayon 14, `--shadow-2` |
| Dialogue | `Modal` (`.modal`, rayon 12) | rayon 20 ; titre 15/600 ; pied avec boutons en pilule (« Annuler » en `ghost`) ; voile `--scrim` flouté de 4 px |
| Notification | `.toast` | rayon 12, icône d'état, `--shadow-2` (emplacements inchangés) |
| Panneau | `.col`, `.panel-head`, `.assistant`, `.inspector-wrap`, bord à bord | `.panel` : `--surface`, rayon 14, `--shadow-1`, posé dans une gouttière ; `.panel-head` de 44 px sans filet |
| Carte | onze classes (détail sous le tableau) | `.card` (+ `interactive`) et `.well` (zone interne `--surface-2`, rayon 12) |
| Ligne de liste | neuf classes (détail sous le tableau) | `.row-item` : 28 px, rayon 8, en retrait de 6 px dans son panneau, sélection `--accent-soft` ; plus de barre pleine largeur ni de liseré gauche |
| Marque de l'assistant | `Icon name="spark"` partout | `LogoMark` dans un carré `--accent-soft` (`.mark`), qui respire quand Tramme travaille |

**Contrôle segmenté.**
- Les six variantes à remplacer :
  - `.seg` (`Seg`) ;
  - `.view-switch` (`views.tsx`) ;
  - `.side-tabs` (`Notes.tsx`) ;
  - `.tabs` / `.tab` (`LeftPanel`, `Transport`) ;
  - `.brief-formats` (`Home`) ;
  - `.ab` (`TakeActions`).
- Ce que `Seg` doit apprendre :
  - une icône par option ;
  - les tailles `sm`, `md` et `lg` ;
  - le rôle `tablist` ou `radiogroup` ;
  - un `data-tour` par option, pour garder les visites guidées.

**Liste de choix au clavier.** Flèches, Entrée, Échap, saisie de la première lettre, et une coche sur l'option choisie.

**Étiquettes, les neuf classes à remplacer.** `.route`, `.ptag`, `.set-badge`, `.take-state`, `.dir-tags span`, `.stage-pill`, `.note-scene`, `.command-from`, et `.chip` quand il sert d'étiquette de contexte au message.

**Menu, les ajouts.**
- Une ligne de détail facultative (`MenuItem.detail`).
- Le raccourci à droite, en mono.
- Les titres de section sans majuscules.
- La navigation au clavier : flèches, Entrée, Échap, focus sur le premier élément à l'ouverture.

**Cartes, les onze classes à remplacer.** `.card`, `.example`, `.note`, `.take`, `.proposal`, `.command-card`, `.access`, `.set-confirm`, `.set-info`, `.dir-film`, `.home-note`.

**Lignes de liste, les neuf classes à remplacer.** `.tree-row`, `.tl-name`, `.list-row`, `.history-item`, `.set-nav-item`, `.command-row`, `.model-opt`, `.graph-side button`, `.recent-chats button`.

**Icônes** (`icons.tsx`) : ajouter `clap`, la claquette tracée dans la planche ; supprimer `spark` quand plus rien ne l'utilise.

## 5. Écrans

### 5.1 Accueil (`Home.tsx`)

**Barre du haut**
- Transparente sur `--bg`, 56 px.
- La marque à gauche.
- Aide et paramètres en `icon-btn`.
- « Autres façons de commencer » en `btn outline sm`.

**Le menu « Autres façons de commencer »**
- C'est le menu à détails de la planche.
- Trois choix, chacun avec sa ligne de détail : Projet vierge, Depuis une vidéo, Ouvrir un fichier.

**Le menu « … » des cartes**
- Le même composant de menu.
- Ouvrir, Renommer, Dupliquer, Enregistrer sur l'ordinateur, un séparateur, puis Supprimer en `danger`.

**Titre**
- « Quel film fait-on ? » au corps héros, graisse 650, −0,035 em.
- Sous-titre en 15,5 px, `--text-2`.

**La boîte de direction**
- Carte au rayon 20, `--shadow-2`, **sans bordure en dégradé**.
- Focus : `0 0 0 2px var(--accent-line)`.
- Texte en 15,5 px.
- La barre du bas contient :
  - « Matière » en `btn ghost sm` ;
  - le dossier en `icon-btn sm` ;
  - les formats en `Seg`, avec le petit rectangle de chaque format ;
  - « Lancer » en `btn primary`, avec une flèche et non une étincelle.

**Idées**
- En `.chip`.

**Vos films**
- Une grille de `.card.interactive`.
- La vignette en haut ; le nom en 13/600 ; les détails en 12, `--text-3`.
- Le bouton « … » visible au survol, et toujours sur tactile.

**Exemples**
- Le même langage, en carte horizontale.

**États**
- Vide et progression d'import : en carte `--surface`.
- Zone de dépôt : rayon 20, en tirets `--accent-line`.

**Dialogues** (Projet vierge, Renommer, Supprimer, Échec d'import)
- Tous au `Modal` cible.
- Les formats du projet vierge en cartes sélectionnables au rayon 12 ; la sélection, c'est `--accent-soft` avec un contour `--accent-line`.
- La cadence en `Seg`.

### 5.2 Paramètres (`Settings.tsx`, `SettingsRows.tsx`, `Providers.tsx`, `ModelPicker.tsx`)

**Le dialogue**
- Rayon 20.
- `min(920px, 100%)` de large, `min(640px, 100dvh − 80px)` de haut.

**Navigation à gauche** (220 px)
- La recherche en haut.
- Les groupes « Éditeur » et « Assistant » en 11 px, `--text-3`, **sans majuscules**.
- Les éléments font 34 px, au rayon 10.
- L'élément choisi : fond `--hover`, texte `--text` en 600, icône `--accent-text`.

**Volet droit**
- Le titre de section en 18/600.
- Les rangées d'une section sont **groupées dans une carte** (`.set-group`) : `--surface-2`, rayon 14, un filet `--line` entre deux rangées.
- Une rangée : le libellé en 13/500, l'aide en 12 `--text-3`, le contrôle à droite.
- `stack` pour les contrôles larges.

**Thème**
- Remplacer les puces (`.theme-chip`) par des **aperçus** (`.theme-card` de la planche).
- Chaque aperçu est dessiné avec les couleurs de son thème, lues dans `THEMES`.
- L'aperçu « Système » est coupé en deux.

**Vue**
- Le `Seg` Studio / Atelier.

**Fournisseurs**
- Une rangée par fournisseur, dans une carte.
- Le statut en `.tag` : `ok` pour connecté, neutre pour une clé serveur.
- Les actions en `btn sm` : `outline` pour changer, normal pour connecter, `danger` pour retirer.
- Le formulaire de clé s'ouvre sous la rangée, dans la carte.

**Le reste**
- La confirmation sous une rangée (`Confirm`) : un `.well` avec des boutons `sm`.
- La page du coffre (mode personnel, `vault/`) importe les mêmes feuilles : vérifier qu'elle suit sans règle propre.
- Sur téléphone : plein écran, et la navigation devient une rangée de puces qui défile au-dessus du volet.

### 5.3 Studio (`Studio.tsx`, `Storyboard.tsx`, `Notes.tsx`, `Direction.tsx`, `studio.css`)

L'organisation ne change pas ; tout l'habillage revient au thème.

**Retirer**
- `--ai*` et toutes ses utilisations : dégradés (`--ai-grad`), halos (`--ai-glow`), l'anneau conique animé (`@property --ring`).
- Les bordures en dégradé du composer et de la boîte de l'accueil.

**Le cadre**
- Le studio passe lui aussi aux panneaux en gouttière : la scène, le storyboard et la colonne des notes deviennent trois panneaux arrondis sur `--bg`.

**Tramme au travail**
- La pastille du haut montre `.mark.working`, l'étape, le détail, le temps et le bouton d'arrêt.
- Autour de l'image, un liseré d'accent de 2 px qui respire (un `outline` animé, voir la planche). L'image elle-même ne bouge pas.

**Prise**
- Pastille et carte portent l'icône `clap`, avec « Prise N » en `--accent-text`.
- Pendant une prise, le cadre de l'image est un liseré `--accent-line` fixe.
- « Garder » en `btn primary`, « Écarter » en `btn`.
- « Une autre prise » : `icon-btn` dans la pastille, lien dans la carte.

**Notes**
- Le numéro sur `--accent-soft` / `--accent-text`.
- Les épingles en `--accent` / `--on-accent`, avec un anneau `--on-media`.
- Les étapes du travail en `.tag` avec un point, en `--accent` pour l'étape en cours.

**Suggestions au-dessus de la barre**
- En `.chip`, sans icône.
- Les idées « à compléter » gardent leur bordure en tirets.

**Barre de direction**
- Carte flottante : `--float` avec flou, rayon `--r-xl`.
- Le bouton d'envoi : rond `--accent`.

**Storyboard**
- Un panneau ; les scènes au rayon 8.
- La scène ciblée : anneau `--accent` de 2 px.
- Les étiquettes de scène sur `--media-scrim` / `--on-media`.
- Le son :
  - la musique en `--text-3` ;
  - la voix en `--accent` ;
  - les effets en traits `--text-4` ;
  - les effets héros en `--key`.
- La tête de lecture en `--text`, la même que dans l'atelier.

**Direction**
- La carte « L'idée » en `.card` simple sur `--surface-2`, sans dégradé.
- Le nuancier et les polices en `.well`.

### 5.4 Atelier

Fichiers : `App.tsx` (fonction `Atelier`), `LeftPanel.tsx`, `Viewport.tsx`, `Timeline.tsx`, `GraphEditor.tsx`, `Inspector.tsx`, `Assistant.tsx`.

**Cadre**
- `.workspace` devient une grille sur `--bg`, avec `gap: var(--gutter)` et `padding: 0 var(--gutter) var(--gutter)`.
- Chaque zone devient un `.panel` : le panneau gauche, le viewport, le bas, l'inspecteur, l'assistant.
- Les `.resizer` deviennent invisibles dans les gouttières : une zone de 8 px qui montre un trait `--accent-line` arrondi de 2 px au survol et pendant le glisser.

**Barre du haut** (partagée avec le studio, `TopBar.tsx`)
- 52 px, transparente.
- Le nom du projet en 13,5/600.
- L'état d'enregistrement en `.tag` avec un point.
- Le `Seg` des vues.
- Le format et la cadence en `Select` cible.
- Aide et paramètres en `icon-btn`.
- « Exporter » en `btn primary`.

**Panneau gauche**
- Les onglets Calques / Assets / Jetons deviennent un `Seg` dans l'en-tête.
- La recherche en `.field`.
- L'arbre en `.row-item` :
  - 14 px d'indentation par niveau ;
  - l'icône dans la couleur de son type ;
  - l'œil et le cadenas au survol ;
  - le point de dépôt en trait `--accent` arrondi.
- Les assets en grille de vignettes au rayon 12.
- Les jetons en `.well` : pastille au rayon 8, nom, valeur en mono.

**Viewport**
- Un panneau sur `--stage`.
- L'image avec `--picture-shadow`, rayon 6.
- La barre d'outils devient une pastille flottante (`--float`, flou, `--shadow-2`) :
  - les boutons en `icon-btn round` ;
  - le zoom en mono ;
  - la qualité en `btn ghost sm`.
- La bannière de proposition prend la même forme de pastille que dans le studio.

**Transport** (l'en-tête du panneau du bas, 48 px)
- Lecture en rond `--text`.
- Le temps en mono 15/600 ; le compte d'images en mono 11, `--text-3`.
- Timeline / Courbes en `Seg`.
- Le zoom en curseur stylé : piste en pilule, pouce rond.

**Timeline**
- La règle fait 26 px : graduations `--line-strong`, libellés en mono 10,5 `--text-3`.
- Les noms en `.row-item` de 26 px.
- Les clips :
  - rayon 6 ;
  - fond `--c` à 20 % sur `--surface-2`, contour `--c` à 45 % ;
  - le clip choisi passe à 34 %, avec un anneau `--accent` de 1,5 px.
- Les images clés : losange `--key`, détouré de `--surface`.
- **La tête de lecture est celle du storyboard** (trait `--text` de 2 px et pastille ronde). Elle remplace la ligne rouge `--danger`.
- L'aimantation en `--key`, le lasso en `--accent-soft`.

**Courbes**
- Fond `--surface-2`, grille `--line`, courbes de 1,75 px.
- La liste des propriétés en carte flottante au rayon 12 (`--shadow-2`).
- Les préréglages en `Seg`.

**Inspecteur**
- L'en-tête, avec 14 px de marge :
  - l'icône du type dans un carré au rayon 8, sur `--surface-2` ;
  - le nom en 15/600, modifiable ;
  - le type en 12, `--text-3`.
- Les sections se replient : titre en 13/600 avec un chevron, séparées par un filet `--line` en retrait.
- Les propriétés en grille : le bouton d'image clé en losange, le libellé en 12 `--text-2`, les champs cibles.
- Les modificateurs et les effets en `.well`.

**Assistant**
- Le même fil que le studio (notes, travail en étapes, prises) à la place des bulles.
- Sortir `Thread`, `Note`, `Work`, `TakeCard` et `TakeActions` de `Notes.tsx` vers un module partagé (par exemple `ui/thread.tsx`), utilisé par les deux vues.
- Garder le `Composer` comme barre de saisie.

**Téléphone**
- Les onglets (`.mobile-tabs`) deviennent une barre flottante en pilule, au-dessus de la zone sûre.

### 5.5 Commun

**Popovers à reprendre**
- export (`ExportPop`) : les formats en lignes sélectionnables au rayon 10, la progression, les boutons ;
- choix du modèle (`ModelPicker`) ;
- accès à l'IA (`AccessSettings`) ;
- conversations (`History`) ;
- couleur (`ColorField`) ;
- choix des dessins d'une séquence ;
- menu « / » (`CommandMenu`, `CommandCard`).

**Menus contextuels**
- Calques, clips, images clés, cartes : tous passent au menu cible.

**Visites guidées** (driver.js, fin de `styles.css`)
- Popover au rayon 14, `--raised`, `--shadow-2`.
- Titre en 14/600 ; boutons en pilule ; progression en mono.

**Divers**
- `QuestionDialog`, la visionneuse d'images (`lightbox`), le glisser-déposer.
- L'erreur de rendu (`.viewport .error`) : `--error-bg` / `--error-text`, rayon 12.

**Application de bureau** (`WindowControls.tsx`)
- La barre de fenêtre s'aligne sur la barre du haut (52 px).
- La croix de fermeture garde son rouge système : c'est la seule exception de couleur, documentée.

## 6. Suggestions d'organisation (facultatives, à valider une par une)

1. **Colonne de droite de l'atelier.** Un `Seg` « Propriétés | Notes » en tête de colonne, un seul panneau à la fois, en pleine hauteur. Aujourd'hui les deux sont empilés et s'écrasent : l'inspecteur est coupé dès qu'une conversation existe.
2. **Panneaux repliables.** Chaque panneau latéral se replie en un rail de 44 px qui montre son icône, pour laisser la place à l'image. L'état est mémorisé (`useSize` sait déjà le faire).

## 7. Ordre de travail

Chaque lot se termine par :
- `npm run typecheck` ;
- `npm test` ;
- `node apps/editor/build.ts` ;
- les captures du §9, comparées à la section de la planche correspondante.

**Lot 0 : fondations**
- Contenu :
  - les polices Geist ;
  - le découpage des feuilles (§3) ;
  - `tokens.css`, copié de la planche ;
  - les renommages (§2.3) ;
  - `THEMES` et `BAR` dans `settings.ts`.
- Terminé quand l'application s'affiche dans les cinq thèmes et qu'il ne reste aucune référence aux anciens noms.

**Lot 1 : composants**
- Contenu : tout le §4. En particulier :
  - `Seg` étendu, qui remplace les six variantes ;
  - `Select` en menu ;
  - le menu à détails, utilisable au clavier ;
  - l'icône `clap`.
- Terminé quand la planche et l'application montrent les mêmes composants et que la recherche de couleurs du §8 ne trouve rien dans `components.css`.

**Lot 2 : accueil**
- Contenu : le §5.1, avec ses menus et ses dialogues.
- Terminé quand les captures correspondent à la section « L'accueil » de la planche.

**Lot 3 : paramètres**
- Contenu : le §5.2, la page du coffre comprise.
- Terminé quand les captures correspondent à la section « Les paramètres ».

**Lot 4 : studio**
- Contenu : le §5.3 (le nettoyage IA et les panneaux en gouttière).
- Terminé quand il ne reste plus de `--ai`, de dégradé ni d'étincelle, et que les captures correspondent à la section « Le studio, corrigé ».

**Lot 5 : atelier**
- Contenu : le §5.4.
- Terminé quand les captures correspondent à la section « L'atelier » et que tout fonctionne comme avant :
  - le glisser et le rognage des clips ;
  - les images clés ;
  - le lasso ;
  - les courbes ;
  - le redimensionnement.

**Lot 6 : finitions**
- Contenu :
  - le §5.5 ;
  - le téléphone et le tactile ;
  - le thème papier ;
  - les visites guidées ;
  - `prefers-reduced-motion`.
- Terminé quand toute la matrice de captures du §9 est faite.

## 8. Règles techniques

**Couleurs**
- Aucune valeur hors de `theme/tokens.css`. Pour vérifier :
  - `rg -n "#[0-9a-fA-F]{3,8}\b|rgba?\(" apps/editor/src --glob "*.css" --glob "!**/theme/tokens.css"` ne doit plus rien trouver ;
  - lancer la même recherche dans les `.tsx`.
- Les couleurs de données restent permises dans les `.tsx` :
  - les jetons du document ;
  - les courbes ;
  - les aperçus de thème, lus dans `THEMES`.
- Pas de nouvelle teinte. Pas de dégradé, sauf l'aperçu « Système » coupé en deux. Pas de halo.

**Styles en ligne**
- Les composants contiennent plus d'une centaine de `style={{…}}`.
- Ceux qui sont cosmétiques (`fontSize`, `fontWeight`, `gap`, `color`…) deviennent des classes.
- Seuls restent les styles calculés : positions, tailles, couleurs de données.

**DRY**
- Un composant par motif (§4).
- Deux écrans qui montrent la même chose partagent le composant : le fil de conversation, la tête de lecture, la pastille flottante, la barre du haut.

**Visites guidées**
- Garder tous les attributs `data-tour` (la liste est dans `docs/tours.md`).
- Quand un onglet devient une option de `Seg`, son attribut passe sur l'option.

**Textes**
- Tout nouveau texte a sa clé dans `apps/editor/src/i18n/en.json` **et** `fr.json`.
- Le test `apps/editor/test/i18n.test.ts` vérifie :
  - que chaque clé existe dans les deux langues ;
  - qu'aucune clé n'est inutilisée ;
  - qu'aucun texte ne contient de tiret cadratin.

**Fichiers**
- Les sources de `apps/editor/src` sont en fins de ligne CRLF : les garder.

**Champs**
- Un long `<textarea>`, dans un panneau qui se redessine souvent, reste non contrôlé : `defaultValue`, et lecture au `blur`.
- Le modèle est `BriefField` dans `Direction.tsx` : en version contrôlée, ce champ perdait des caractères pendant la frappe.

**Performance**
- `backdrop-filter` seulement sur de petits éléments flottants.
- Garder `contain: layout paint` sur le transport, la timeline et le viewport.
- Pendant la lecture, rien ne s'anime en continu hors de la tête de lecture.

**Accessibilité**
- Le focus est visible partout (`--focus`).
- Les cibles font au moins 28 px, et 36 px en tactile.
- Ne pas descendre sous les contrastes de la planche.
- Menus et listes de choix sont utilisables au clavier.

## 9. Recette

**Serveur d'essai**
- Ne jamais toucher au `npm run dev` de l'utilisateur.
- Construire d'abord : `node apps/editor/build.ts`.
- Puis lancer : `npx wrangler dev -c apps/worker/wrangler.jsonc --port 8790 --var DEV_OPEN:1 --persist-to .wrangler/state-trial`.
- À la fin, l'arrêter et supprimer `.wrangler/state-trial`.

**Captures**
- Avec puppeteer, par la fonction `launch` de `packages/cli/src/browser.ts`.
- Bloquer les appels aux modèles pour ne rien dépenser : `/api/claude`, `/api/llm`, `/api/generate`, `:4317/turn`.

**Matrice** : chaque écran ci-dessous, dans les **cinq thèmes**, sur bureau (1440×900) et sur téléphone (390×844), comparé à la planche.
- Accueil :
  - la page ;
  - son menu ;
  - une carte et son menu ;
  - le dialogue « Projet vierge ».
- Paramètres : chaque section.
- Studio :
  - vide ;
  - au travail ;
  - avec une prise ;
  - une note épinglée ;
  - une scène ciblée ;
  - la direction.
- Atelier :
  - un calque choisi ;
  - les assets ;
  - les jetons ;
  - les courbes ;
  - l'export ;
  - le choix du modèle ;
  - un menu contextuel.

**Contrastes**
- Ceux de la planche.
- Jamais sous 4,5:1 pour du texte de 13 px.

## 10. Hors périmètre

- Le moteur, les exports, le format des documents.
- Le site (`apps/site`) : il suit déjà cette direction. Ses tokens pourront être rapprochés plus tard.
- Les fonctions : la refonte n'en ajoute ni n'en retire aucune, sauf les suggestions du §6 si elles sont validées.
