# Identité commune du site et de l'application

La qualité d'un choix commun se juge sur son rendu dans les deux interfaces.
L'essai précédent (`stash@{0}`, « GPTIMAGE ») importait les tokens de l'app dans
le site et y généralisait les pilules. Cette version part d'essais sur les
vrais écrans, puis extrait une fondation indépendante. La palette retenue est
le turquoise et le bleu nuit de l'application initiale, selon la préférence
explicite de l'utilisateur ; elle s'applique au site comme à l'app.

## Fondation

[brand/theme.css](../../brand/theme.css) porte les palettes sombre et claire,
l'accent, les rayons et le mouvement. Les adaptateurs sont
[tokens.css](../../apps/editor/src/theme/tokens.css) pour l'app et
[theme.css](../../apps/site/src/styles/theme.css) pour le site et la documentation.
La [planche](board.html) importe les tokens réels au lieu d'en recopier les valeurs.

| Choix | Site | Application |
| --- | --- | --- |
| Geist et Geist Mono | Grands titres légers ; texte de lecture à 16px | Accueil à graisse 450 ; interface dense à 13px ; chiffres en mono |
| Fonds bleu nuit et gris froids | Navigation, sections éditoriales et footer | Studio par défaut, panneaux différenciés du fond et de la scène |
| Papier presque blanc | Thème clair, navigation claire, tarifs | Thème Paper, champs et panneaux distincts |
| Turquoise initial | Action principale, marque, progression | Export, création, sélection et focus ; jamais appliqué à l'image du film |
| Contrôles à 6px | Boutons et choix | Boutons, champs et puces ; les interrupteurs et poignées restent ronds |
| Menus 8px, panneaux 10px, dialogues 14px | Cartes et menus de navigation | Panneaux, popovers, dialogues et champ de direction |
| Même courbe de mouvement | Vague interactive et transitions de chapitres | Réponses courtes aux changements d'état |

Les densités et compositions dépendent du travail à accomplir. La navigation
du site suit désormais le thème et les surfaces de l'app, y compris en sombre.
Les thèmes alternatifs restent disponibles ; leurs
palettes particulières sont un choix personnel, avec la même grammaire de contrôle.

Liquid Glass conserve sa palette monochrome, ses transparences et ses reflets.
Il hérite des rayons communs des contrôles, menus, panneaux et dialogues, ainsi
que de la géométrie des lignes de paramètres et de menu. Les états de survol
et les préférences de transparence ou de contraste ne changent pas ces formes.
La gouttière de 8px sépare aussi la topbar du corps de l'Atelier et du Studio :
les panneaux latéraux gardent ainsi leur contour, même avec des surfaces de
verre très claires. `liquid-glass.css` conserve les règles propres au matériau
(flou, reflets, transparence et états accessibles), sans redéfinir la géométrie
commune.
Les barres supérieures de Liquid Glass restent sans fond ni filet propre,
y compris avec la transparence réduite : elles partagent le fond de page.
Le flou agit sur ce fond et les contrôles conservent leurs propres lentilles.
Le panneau d'export utilise un voile plus léger au-dessus de l'inspecteur clair,
avec le même flou et les mêmes reflets que les autres surfaces flottantes.
Ses deux actions ont une largeur égale et restent visibles pendant que les
options défilent ; la mise en file est secondaire, l'export est principal.
La transparence réduite et le contraste renforcé conservent un fond opaque.
La navbar du site est centrée et limitée à la largeur maximale du contenu,
avec ses marges latérales préservées sur les petits écrans.

Le turquoise lumineux du thème sombre conserve un texte bleu nuit. Sur papier,
l'action reprend le turquoise foncé et le texte blanc de l'app initiale.
Le hero photographique conserve les rôles sombres dans les deux thèmes. Les
couleurs des types de calques, images clés, expressions, erreurs et validations
gardent leurs rôles propres.

## Validation sur les interfaces

Les captures viennent des composants réels, avec les projets d'exemple du dépôt.
La prévisualisation de l'app utilise un serveur local de données de démonstration,
sans appeler l'assistant ni modifier de projet utilisateur. Les quatre images
Studio/Atelier du site sont recapturées à densité 2, avec les nouveaux thèmes.
Le parcours de la landing affiche désormais la capture claire quand le site
est en thème clair.

Les contrôles couvrent l'accueil, Studio, Atelier, les paramètres, le hero,
les tarifs, la documentation et le mobile. Ils comparent les couleurs et les
rayons calculés dans les deux produits et mesurent les contrastes du texte,
des aides, de l'action principale et du focus. Les captures et rapports locaux
sont dans `.cache/identity/`, avec une planche `review.html`.

Résultat : 179 tests passent, TypeScript et les deux compilations passent.
Les paires mesurées vérifient le contraste du texte, des aides et des actions
ainsi que les indicateurs de focus. Il s'agit d'échantillons ciblés, pas d'un
audit exhaustif de chaque état.
Les liens de documentation et les focus du hero et des navigations thématisées
ont aussi été contrôlés dans Chrome. La relecture indépendante ne relève plus
de défaut bloquant.

Le contrôle mécanique relève aussi deux règles préexistantes hors de cette
harmonisation : la transition de largeur d'une barre d'import et le filet de
2px d'un encadré éditorial. Leur comportement n'a pas été modifié.
