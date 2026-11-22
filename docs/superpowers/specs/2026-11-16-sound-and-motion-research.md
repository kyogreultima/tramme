# Son et motion design : Openverse, Real SFX, earshot, Cavalry

16 novembre 2026. Ce qu'on peut tirer de quatre outils pour Tramme, comparé à ce que le code fait déjà.

## Synthèse

Tramme couvre déjà le cœur de ce que font ces outils :

- **Pour le son :** une bibliothèque mesurée, des repères lus sur l'image, l'alignement sur le moment où le son frappe, un mix mesuré comme le ferait un ingénieur du son, et Openverse.
- **Pour l'animation :** des distributions sur grille, sur des points ou sur des lignes de données, un champ de temps, des modificateurs, la réaction au son, des expressions et Lottie.

Aucun de ces outils n'est donc à intégrer tel quel. Ce qu'ils apportent :

- **Un modèle :** CLAP, repris d'earshot, pour chercher et juger les sons par leur sens.
- **Des mesures :** la densité et le rythme des effets, comparés à des films de référence.
- **Des réglages précis :** un décalage par type de son, l'accord sur la tonalité de la musique, un contrôle mono.
- **Côté Cavalry :** une vérification de nos manques (les déformeurs) et une preuve d'import, plutôt que des fonctions nouvelles.

Ordre conseillé :

1. CLAP pour la recherche et le jugement des sons.
2. Le décalage par type de son et le contrôle mono, qui coûtent peu.
3. La comparaison du rythme sonore à des références.
4. L'accord sur la tonalité de la musique.
5. Le reste, au besoin.

## Ce que Tramme a déjà

| Domaine | En place | Où |
|---|---|---|
| Bibliothèque de sons | 421 sons CC0 (Kenney), mesurés ; recherche par mots et synonymes | `sounds/catalog.json`, `searchSounds` |
| Sons trouvés à la demande | Openverse, Freesound en CC0 ; défauts jugés ; sons gardés avec leur crédit | `apps/editor/src/sound.ts` (`sound-find`) |
| Synchronisation | repères lus sur l'image (`soundCues`), alignement sur le moment où le son frappe | `@tramme/core` |
| Mix | loudness du master, true peak, masquage par bande, ducking, bus, compresseur, égaliseur | `apps/editor/src/mixing.ts` |
| Génération | ElevenLabs pour les effets, la musique et les voix ; OpenAI et Gemini pour les voix | outil `generate-sound` |
| Crédits | licence de chaque son, image et clip | outil `credits` |
| Clonage d'éléments | distributions : grille, cercle, tracé, liste, points d'un calque, lignes de données | `packages/core/src/components.ts` |
| Comportements | wiggle, loop, spring, stagger, noise, smooth, react (au son), near (au pointeur), timeField | `packages/core/src/modifiers.ts` |
| Expressions, Lottie | expressions ; import et export Lottie | `packages/core/src/expr.ts`, `packages/interop` |

Ce qui manque, d'après la recherche dans le code :

- un contrôle de compatibilité mono ;
- un moyen de bannir un son ;
- des mesures de densité et de rythme des effets ;
- une recherche par le sens (des embeddings audio) ;
- l'accord sur la tonalité de la musique, case encore ouverte de l'étape 7 de `docs/sound-roadmap.md`.

## Openverse

**Ce que c'est.** Un moteur de recherche gratuit de médias sous licence libre, porté par WordPress. Il compte 5,2 M de fichiers audio : 3,99 M de Wikimedia Commons, 645 k de Jamendo (de la musique) et 592 k de Freesound. Il couvre aussi les images.

**Accès.**
- Sans clé : 20 requêtes par minute et 200 par jour, chiffres relevés fin octobre 2026.
- Avec une application enregistrée (OAuth, client credentials) : des limites un peu plus hautes, consultables sur `/v1/rate_limit/`.
- Les conditions d'utilisation interdisent le scraping.
- Les résultats sont limités à 20 pages par recherche.

**Chez nous.** `apps/editor/src/openverse.ts` appelle l'API sans clé. On s'en sert pour les sons (Freesound, CC0 seulement) et pour les images (CC0, PDM, CC BY).

**Pistes.**
- **Les limites :** 200 requêtes par jour, c'est peu pour un service hébergé. Deux options : enregistrer une application dont la clé reste sur le Worker, comme pour les autres fournisseurs, ou laisser chaque navigateur porter son propre quota, ce qui est le cas aujourd'hui.
- **Plus de sons :** accepter les sons CC BY en plus des CC0, puisque `credits` gère déjà les mentions d'auteur.
- **Des musiques de fond** prises sur Jamendo, une source gratuite à côté d'ElevenLabs. Il faudra filtrer les licences : beaucoup sont NC, interdites en usage commercial, ce qui exclut l'usage commercial de Tramme.

## Real SFX (Clipwing)

**Ce que c'est.** Une skill Claude Code gratuite, en Python 3.9+ et FFmpeg. Le code est sous licence MIT. Elle est livrée avec 78 sons d'interface annoncés CC0. Clipwing vend par ailleurs un service de montage.

**Méthode.**
- **Les repères :** elle regarde le film (`look.py`, `find_moments.py`), ou lit une liste de repères (`from_cues.py`), une timeline HyperFrames ou un enregistrement d'écran zone par zone (`ui_events.py`).
- **Le choix des sons :** ils viennent de la bibliothèque de l'utilisateur, triée en deux niveaux. La bibliothèque principale sert d'abord ; la secondaire ne sert que si la principale a moins de 3 sons qui conviennent. Le choix repose sur le caractère mesuré du son, des mots, des spectrogrammes et, en option, les étiquettes YAMNet.
- **Les goûts :** `taste.py ban ID` retire un son, et les préférences sont gardées dans `taste.json`.
- **La pose :** chaque son est placé sur son début audible. La grille de tempo est vérifiée contre les grosses caisses (`beats.py`), et les sons à hauteur définie sont accordés aux notes de la musique (`tonal.py`).
- **Les contrôles :**
  - le niveau de chaque événement (`levels.py`) ;
  - le mono : le canal le plus fort est écouté pour repérer un son dont les canaux s'annulent sur un haut-parleur de téléphone (`mix.py`) ;
  - le masquage, en option ;
  - une critique qui compare le film à 9 vidéos d'effets finies : gestes par tranche de 10 s, silences entre effets, écart de niveau, graves, bruit de fond, silences numériques.
- **Les ajouts :** du son sur les petits mouvements restés muets (`texture.py`) et un fond sonore continu (`bed.py`).
- **La sortie :** `*_sfx.mp4`, `*_sfx_track.wav`, un rapport des repères, et des pages A/B à l'aveugle consultables sur le téléphone.

**Idées à reprendre.**
1. Le contrôle mono dans `check` et `mixing.ts`.
2. Bannir un son, et s'en souvenir pour l'utilisateur.
3. Les bibliothèques par niveau : celle de l'utilisateur d'abord, Kenney ensuite, Openverse en dernier.
4. L'accord sur la tonalité, qui ferme la case de l'étape 7.
5. Les mesures de rythme sonore de la critique (voir la piste 4 du tableau).
6. L'écoute A/B à l'aveugle, pour les décisions de goût.

**À écarter.** Les 78 sons d'interface : ils sont annoncés CC0, mais leur source d'origine n'est pas indiquée.

## earshot (Leon Lin)

**Ce que c'est.** Un outil sous licence MIT, environ 4,9 k étoiles. Il tourne sur processeur, en ligne de commande, en Python ou comme serveur MCP. Il lui faut Python 3.10+ et FFmpeg. Ses modèles pèsent environ 1,1 Go et se téléchargent une fois :
- CLAP (`laion/larger_clap_general`, Apache-2.0), qui relie un texte à un son ;
- AST (`MIT/ast-finetuned-audioset`, BSD-3), qui étiquette les sons.

**Fonctions.**
- **Écouter :**
  - `describe`, `match`, `rank` et `find` décrivent un son, le comparent à une description, classent des fichiers ou trouvent les bons passages d'un long enregistrement ;
  - `compare` et `ab` rapprochent un son de références ou en comparent deux ;
  - `realness` dit si un son est un vrai enregistrement ou de la synthèse ;
  - `timeline` et `sheet` font une transcription de l'écoute, avec une image annotée ;
  - `measure` donne les mesures brutes : LUFS, true peak, LRA, enveloppe, spectre, tempo, tonalité.
- **Critiquer :** `critique` compare une vidéo de lancement à un profil tiré de 7 films professionnels. `profile` construit son propre profil à partir de films qu'on admire.
- **Fabriquer :**
  - `forge` fait des sons par modélisation physique (résonateurs, excitations, bruit filtré, pièce et micro simulés) et les fait évoluer avec un juge qui les note ;
  - `fit` analyse un enregistrement pour en tirer une recette, qui permet des variations ;
  - `kit` construit le jeu de sons d'un film, avec les points mesurés de début, de sommet et de fin.
- **La banque :** 252 sons rendus en code, dont 15 tirés d'enregistrements CC0.
- **Le calage :** un décalage par type de son par rapport à la coupe. Une tape arrive 60 ms avant, un clic 11 ms avant, et le sommet d'un whoosh 37 ms après. La musique baisse avant un impact au lieu de baisser sous chaque effet.
- **Ce qu'il annonce lui-même :**
  - le verdict « strong » est juste dans 98 % des cas ;
  - le détecteur de son réel atteint une AUC de 0,92 ;
  - au test à l'aveugle de `forge`, son auteur n'a reconnu le son fabriqué que 8 fois sur 15, près du hasard. Le test est petit.

**Idées à reprendre.**
1. **CLAP pour chercher et juger les sons.** On calcule une fois l'empreinte des 421 sons du catalogue au moment du build ; on classe les sons d'Openverse selon leur ressemblance avec la demande ; on vérifie qu'un son trouvé correspond à ce qu'on a cherché. Il existe une version ONNX de CLAP pour le navigateur (transformers.js) : pas besoin de Python. Le prix : un modèle de texte d'environ 100 Mo, ou un appel au Worker.
2. **Un décalage par type de son** dans `place()`. La tolérance de `check` (1 image pour un son fort, 2 pour les autres) doit en tenir compte.
3. **Un profil tiré de films de référence** choisis par l'utilisateur, ce qui rejoint l'étude sur le goût en cours. On compare à des fourchettes, pas à un gabarit.
4. **Le détecteur de son réel**, pour juger nos sons faits en code (`synth`, `sound-presets.ts`).

**À écarter pour l'instant.** La banque de 252 sons faits en code. Notre principe dit que les impacts, clics et whooshes sont de vrais enregistrements. Le test à l'aveugle est trop petit pour le remettre en cause, et le README ne donne pas de licence propre aux sons rendus. Il faudrait d'abord une écoute à l'aveugle de notre côté.

## Cavalry (Scene Group)

**Non revérifié.** La page cavalry.studio/en/ n'a pas pu être lue aujourd'hui : les appels réseau étaient bloqués par une vérification côté serveur. Cette section repose sur ce que je savais du logiciel avant et sur notre code. Les versions et les prix sont à confirmer sur le site.

**Ce que c'est.** Un logiciel d'animation 2D procédurale pour le motion design, édité par Scene Group à Londres, sorti en 2020, sur macOS et Windows. Il existe une version gratuite et un abonnement Pro. Son moteur de rendu est Skia.

**Concepts.**
- **Duplicator :** il clone des éléments sur une distribution (grille, cercle, tracé, aléatoire, points d'une forme).
- **Behaviours :** Noise, Oscillator, Stagger, Falloff, Apply Distance, et un comportement qui suit le son.
- **Deformers :** ils agissent sur les points d'un tracé.
- **Connexions :** n'importe quel attribut peut piloter un autre, comme un graphe de nœuds.
- **Données :** des tableurs, du CSV ou Google Sheets pilotent les clones.
- **JavaScript :** des expressions, une API de script et des calques en JS.
- **Shaders :** en SkSL.
- **Exports :** séquences d'images, vidéo, SVG, Lottie.
- **Le Web Player :** il joue une scène dans le navigateur.
- **L'import After Effects :** à confirmer.

**Comparaison avec Tramme.**

| Cavalry | Tramme |
|---|---|
| Duplicator et distributions | distributions (`components.ts`, étape 2 de la feuille de route des composants) |
| Noise, Stagger, Oscillator | `noise`, `stagger`, `wiggle`, `loop` en aller-retour, expressions |
| Falloff, Apply Distance | `timeField` en mode distance, `near` |
| Comportement qui suit le son | `react` : temps, mesures, impacts, bandes de fréquence |
| Tableur ou CSV pilotant les clones | distribution sur les lignes d'un fichier de données (`row`) |
| Expressions et scripts JS | `expr.ts` ; extensions en sandbox |
| Export Lottie | import et export Lottie (`packages/interop`) |
| Deformers sur tracés | **à vérifier :** rien d'équivalent trouvé dans les modificateurs |
| Logiciel de bureau, pas fait pour l'IA | éditeur web et bureau pensé pour l'IA : l'assistant crée et vérifie |

**Idées à reprendre.**
1. **Les déformeurs sur tracés** (courbure, torsion, bruit sur les points), si on confirme qu'ils nous manquent. Un modificateur de plus, pas un nouveau mécanisme.
2. **Le vocabulaire de Cavalry pour l'assistant et la recherche** : « oscillator », « falloff », « duplicator » renvoient vers nos équivalents (`vocabulary.ts`). Les motion designers qui viennent de Cavalry s'y retrouvent.
3. **Une preuve d'import** : une animation Cavalry exportée en Lottie, importée dans Tramme, puis comparée côte à côte. Ça teste la fidélité de notre import Lottie sur un fichier réel, à mettre dans le dossier des preuves du site.
4. **Le positionnement** : Cavalry est la référence du motion procédural ; la différence de Tramme, c'est l'assistant qui crée et qui vérifie. Une comparaison factuelle est possible sur le site, sans reprendre leur marque ni leur charte.

## Tableau des pistes

| # | Piste | Source | Gain | Coût | Risque |
|---|---|---|---|---|---|
| 1 | CLAP pour chercher et juger les sons | earshot | élevé : meilleur choix de sons, jugement des sons trouvés | moyen : modèle d'environ 100 Mo ou appel au Worker, empreintes au build | poids du modèle sur mobile |
| 2 | Décalage par type de son | earshot | moyen : impacts mieux ressentis | faible | ajuster la tolérance de `check` |
| 3 | Contrôle mono | Real SFX | moyen : sons muets sur téléphone évités | faible | aucun |
| 4 | Rythme sonore comparé à des références | earshot, Real SFX | élevé pour le goût | moyen | dériver vers un gabarit si les fourchettes sont trop serrées |
| 5 | Accord sur la tonalité de la musique | Real SFX | moyen | moyen : il faut détecter la tonalité | erreur de tonalité |
| 6 | Bannir un son | Real SFX | moyen pour l'utilisateur | faible | aucun |
| 7 | Bibliothèques par niveau | Real SFX | faible à moyen | faible | aucun |
| 8 | Openverse en CC BY, clé côté Worker | Openverse | moyen : plus de choix | faible | crédits obligatoires |
| 9 | Musiques de fond Jamendo | Openverse | moyen : musique gratuite | moyen : tri des licences | licences NC |
| 10 | Déformeurs sur tracés | Cavalry | moyen | moyen | à confirmer d'abord |
| 11 | Preuve d'import Lottie depuis Cavalry | Cavalry | moyen : preuve, public de Cavalry | faible | fidélité de l'import |
| 12 | Vocabulaire de Cavalry pour l'assistant | Cavalry | faible | très faible | aucun |

## Licences et vigilance

- **Openverse :** chaque fichier garde sa licence. CC0 et PDM sont libres. CC BY demande un crédit. Les licences NC et ND sont à exclure : Tramme est un produit commercial sous licence FSL.
- **Real SFX :** le code est sous MIT. La source des 78 sons d'interface n'est pas indiquée, donc on ne les livre pas.
- **earshot :** le code est sous MIT. Les modèles ont leur propre licence : CLAP en Apache-2.0, AST en BSD-3, toutes deux compatibles avec un usage commercial, avec mention dans `THIRD_PARTY_NOTICES.md`. La banque de sons n'a pas de licence propre ; 15 sons viennent d'enregistrements CC0 crédités dans `docs/CREDITS_FIT.md`.
- **Cavalry :** logiciel propriétaire. On s'inspire des concepts (communs au motion design) sans reprendre la marque, l'interface ni la documentation.

## Sources

- Openverse, Real SFX et earshot réunis : https://vivian.hobbyland-group.com/en/article/free-sound-effects-claude-video-openverse-real-sfx-earshot
- earshot : https://github.com/Leonxlnx/earshot · https://leonxlnx.github.io/earshot-site/ · https://github.com/Dodai0419/earshot-sfx-lite
- Real SFX : https://github.com/Clipwing/skills/tree/main/skills/real-sfx · https://clipwing.pro/skills/real-sfx
- Openverse, limites de l'API : https://make.wordpress.org/openverse/2022/08/11/openverse-api-results-constrained-to-20-pages/ · https://apis.io/apis/openverse/openverse-auth-api/
- Cavalry : https://cavalry.studio/en/ (non lu aujourd'hui)
