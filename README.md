# Veille Vinted → Discord

Surveille les nouvelles montres mises en vente sur Vinted et envoie une alerte
Discord quand une annonce est **nettement sous la cote de sa marque**.

Tourne sur GitHub Actions : **aucun ordinateur à laisser allumé**, et c'est gratuit.

## Pourquoi un navigateur et pas une simple requête

Vinted protège son API par un « Client Challenge » qui exige l'exécution de
JavaScript. Une requête HTTP directe reçoit une page de blocage, même avec les
cookies de la page d'accueil — vérifié. Le script lance donc un vrai Chrome,
charge le site, puis interroge l'API **depuis la page** : même origine, cookies
inclus. Testé : 20 annonces récupérées avec titres, prix et marques.

## Ce qui déclenche une alerte

Une annonce doit franchir **quatre filtres**, du moins cher au plus cher en
requêtes :

1. **Marque horlogère.** Liste blanche de ~200 maisons dont les montres sont le
   métier. Les marques de mode qui font faire leurs montres sous licence (Guess,
   Armani, Michael Kors, Diesel…) sont écartées : leur cote de revente ne veut
   rien dire. La marque est cherchée comme suite de mots complets dans le libellé,
   parce que les vendeurs écrivent « CASIO G-SHOCK » ou « Omega x Swatch ».
2. **État déclaré.** Neuf avec/sans étiquette, très bon état, bon état. En
   pratique ce filtre mord rarement : sur 96 annonces relevées, aucune n'était en
   « Satisfaisant ».
3. **Bénéfice à la revente — en euros, pas en pourcentage.** Le pourcentage
   flatte les petits prix : −70 % sur une montre à 40 € ne rapporte que 28 € et ne
   vaut pas le déplacement, là où −35 % sur une montre à 200 € en rapporte 70. Le
   critère est donc `cote − prix ≥ margeMinimum`, avec un garde-fou en pourcentage
   dans l'autre sens : 40 € de marge sur une montre à 500 €, c'est 8 %, trop mince
   pour absorber une cote imprécise.

   **N'entrent dans le calcul que les annonces dont on est sûr.** Une recherche
   texte Vinted ramène tout ce qui ressemble vaguement : mesuré sur une vraie
   annonce, « Hugo Boss 1513755 chronograph » renvoyait 96 résultats et une
   médiane de 100 €, alors que **deux seulement** portaient cette référence. On
   exige donc la même marque, tous les mots du modèle présents dans le titre, un
   état voisin sur l'échelle Vinted, et ni lot ni accessoire. Trois annonces
   strictement identiques valent mieux que quatre-vingt-seize approximatives.

   Une candidate sur deux obtient ainsi une cote au niveau du modèle ; l'autre
   moitié retombe sur la marque. Comme cette cote-là mélange tous les modèles et
   se trompe largement, elle ne déclenche plus que sur de **très** grosses marges
   (`margeMinimumMarque`) : c'est de là que venaient les alertes médiocres, mais
   c'est aussi de là qu'est sortie une Baume & Mercier à 199 € cotée 550 €.
   Rater celle-là coûte infiniment plus cher qu'une alerte de trop ; une marge de
   40 € mal estimée, elle, ne rapporte rien.

   La cote de marque était
   la plus grosse fuite de pépites : toutes les Seiko partageaient la même médiane
   (~95 €), donc une *Seiko Solar Diver's 200M* à 115 € paraissait **au-dessus du
   marché** alors que son modèle se négocie 250 €. La requête de cote est donc
   reconstruite depuis le titre — marque plus les deux mots porteurs, les
   références chiffrées d'abord (« Ref: 7N01-6701 » vaut mieux que tout adjectif).
   Repli silencieux sur la marque quand l'échantillon est trop maigre.

   Comme cette cote coûte une requête par modèle distinct, elle n'est calculée que
   si l'annonce n'est pas manifestement hors de prix — sans quoi un passage
   interrogeait Vinted trois cents fois et durait 198 s au lieu de 30 s.
4. **Pas un accessoire.** Sous 5 €, la catégorie Montres se remplit de bracelets,
   d'écrins et de piles. Le premier mot du titre les trahit presque toujours
   (« Bracelet de montre Seiko », « Cinturino Casio »), et quelques mots — maillon,
   maglie, eslabones — suffisent où qu'ils soient : « Zenith museum maglie » à 10 €
   passait pour une Zenith à −96 %.
5. **Prix plausible pour la maison.** Une Omega à 50 €, une Tudor à 145 €, une
   Zenith à 110 € : ce ne sont pas des affaires, ce sont des contrefaçons. Sur 23
   maisons de luxe, un plancher de 250 € s'applique — sans lui, plus la marque est
   chère, plus la fausse passe pour une bonne affaire. La MoonSwatch fait
   exception : son libellé porte « Omega » mais c'est une Swatch.
6. **Description propre.** Lue sur la fiche publique, elle est refusée si elle
   contient un mot rédhibitoire : « pour pièces », « ne fonctionne plus », « HS »,
   « réplique », « style Rolex », « il manque »… en français, espagnol, italien,
   anglais, allemand et néerlandais.

   Certains défauts se disent avec le même mot que leur absence : « verre
   plexiglas fissuré » disqualifie, « aucune fissure » non. Ceux-là ne comptent
   que si aucune négation ne les précède. L'usure normale d'une vintage — les
   micro-rayures d'usage — ne déclenche rien : la retenir aurait écarté la moitié
   des montres anciennes. Les mots ambigus ont été retirés
   exprès — « il ne manque rien » ou « ce n'est pas un faux » sont des phrases
   saines, et une annonce bloquée à tort disparaît sans bruit.

Les cotes sont mises en cache 24 h, et les annonces déjà signalées sont
mémorisées pour ne jamais alerter deux fois.

## Où se lit quoi

La recherche de catalogue donne titre, prix, marque, photo et **état**. Elle ne
donne pas la description : `/api/v2/items/<id>` répond 404 et `/details` répond
403. La description se lit dans le bloc JSON-LD de la fiche publique, récupérée
par un `fetch` same-origin sans rendu (~500 ms). C'est fait **uniquement pour les
finalistes**, soit une poignée par passage.

## Tests

    npm test

309 tests, sans réseau : normalisation, liste blanche des marques, états, mots
rédhibitoires et pièges de négation.

## Installation

1. Crée un dépôt **public** sur GitHub (les Actions y sont gratuites sans limite)
   et pousse ces fichiers dedans.
2. Dans Discord : **Paramètres du salon → Intégrations → Créer un webhook**,
   copie son URL.
3. Sur GitHub : **Settings → Secrets and variables → Actions → New repository
   secret**, nom `DISCORD_WEBHOOK`, valeur l'URL copiée.
4. Onglet **Actions** → autorise les workflows → lance « Veille Vinted » à la
   main une première fois pour vérifier.

Ensuite, ça tourne tout seul.

## Fréquence : pourquoi une boucle interne

Mesuré sur un vrai job : **40 s de mise en route** (surtout l'installation de
Chrome) pour **8 s de scan**. Lancer le workflow plus souvent revient donc à
payer surtout de l'attente, et GitHub refuse de toute façon un cron plus court
que 5 minutes.

Le job boucle donc **à l'intérieur** : il garde le même navigateur et la même
session Vinted, et relève les nouveautés toutes les `intervalleSecondes`
pendant `bouclerSecondes`. On paie la mise en route une fois pour cinq ou six
relevés. Le délai entre deux relevés tombe à **40 s** au lieu de 15 min.

Reste le décalage de GitHub lui-même, et c'est le facteur limitant. La parade
est de **ne plus lui demander grand-chose** : chaque job couvre **cinq heures**,
donc cinq feux verts par jour suffisent au lieu de cent quarante-quatre. Même
avec ses retards, la couverture devient continue — et moins de relèves veut dire
moins de doublons, puisqu'ils naissaient aux changements d'équipe.

Un job de cinq heures qui n'enregistrerait qu'à la fin reperdrait tout à la
moindre interruption : le scan appelle donc `enregistrer-etat.sh` toutes les
quinze minutes. Ce script fait un `git reset --hard` et **refuse de tourner hors
d'un runner** — sur une machine de développement il effacerait le travail en
cours, ce qui est arrivé une fois.

## Les montres de niche

Une maison que le grand public ne connaît pas — Enicar, Nivada, Gallet, Eterna,
Favre-Leuba — ou un signal de valeur dans le texte (un mouvement Valjoux, un
Kon-Tiki, un cadran gilt, « 21 rubis », « or 18k ») trahit une montre qui vaut
bien plus que son air. Le vendeur qui écrit « Valjoux » sans savoir ce que c'est
vend souvent très en dessous.

Ces annonces obtiennent un seuil assoupli (`seuilPepite`, −20 % suffit) et sont
signalées d'un 💎. En dessous de `pepitePrixMax`, elles passent même sans cote
exploitable : c'est exactement le cas où personne ne sait ce que c'est.

## Pourquoi aucun mot-clé

Chercher « montre », « orologio », « reloj », « uhr », « watch » paraissait
couvrir large. En réalité tout titre ne contenant aucun de ces mots restait
invisible : mesuré, **59 des 285 annonces les plus récentes** — une sur cinq.
Dont une Baume & Mercier à 199 € pour une cote de 550 €, intitulée simplement
« Baume e mercier automatico ».

La catégorie `97` dit déjà que ce sont des montres. On la lit donc directement,
page par page, sans mot-clé : couverture complète et trois requêtes de moins.

## Les lots

Un lot de trois montres comparé à la médiane d'**une seule** paraîtra toujours
une affaire : « 2 Orologi Swatch » à 60 € ressortait à −54 %. Un lot est donc
valorisé à son nombre de pièces, chacune comptée à `facteurLot` de la cote de sa
marque — un lot contient presque toujours du déchet, et mieux vaut rater un lot
que faire acheter un carton de pièces détachées.

Sans nombre annoncé, le lot est écarté : « Konvolut Uhren » ne dit pas ce qu'on
achète. Au-delà de `lotMaxMontres`, c'est un déstockage de revendeur.

## Les vendeurs

Le plancher de prix ne vise que les maisons où rien d'authentique n'existe en
dessous : Richard Mille, Franck Muller, Patek, Rolex, F.P. Journe… Baume & Mercier,
Longines et Movado en sont volontairement exclues — une vraie Baume & Mercier à
199 € pour une cote de 550 € a été trouvée, et un plancher l'aurait jetée sans
l'examiner.

Les comptes professionnels sont écartés d'office — le champ `business` est déjà
dans les données, 9 % des annonces, aucune requête de plus.

Pour les revendeurs non déclarés, l'API ne sert à rien : le filtre `user_id` de
la recherche est **purement ignoré** (vérifié — elle renvoie les mêmes 96
articles pour tout le monde) et `total_entries` vaut 960 quel que soit le
vendeur. On compte donc soi-même, au fil des passages, combien de montres
différentes chaque vendeur publie. Au-delà de `vendeurMaxMontres`, c'est un
revendeur : il connaît ses prix.

## Le message « Rien à signaler »

Sans lui, le silence est ambigu : « rien d'intéressant » et « Vinted nous
bloque » se ressemblent exactement. Toutes les `resumeSiRienMinutes`, s'il n'y a
eu **aucune** alerte, un message récapitule le tunnel :

> Aucune bonne affaire depuis **60 min** (28 passages, 143 nouvelles annonces).
> **Pourquoi :** 71 hors horlogerie · 38 sous le prix plancher · 21 au prix du
> marché · 9 marque sans cote fiable · 2 description rédhibitoire.

Dès qu'une alerte part, le compteur repart à zéro sans message : les alertes
prouvent d'elles-mêmes que ça tourne.

Ce résumé est évalué **à chaque tour de boucle**, pas à la fin du job : depuis
que les jobs durent cinq heures, le tester à la fin ne l'aurait plus fait partir
qu'une fois toutes les cinq heures.

## Réglages (`config.json`)

| Clé | Rôle |
|---|---|
| `pagesCatalogue` | pages de la catégorie lues à chaque passage (96 annonces chacune) |
| `categorieVinted` | `97` = Montres |
| `margeMinimum` | bénéfice minimum à la revente, en euros |
| `margeMinimumMarque` | bénéfice exigé quand la cote n'est que celle de la marque. Volontairement très haut : cette cote-là ne sert plus qu'aux grosses prises |
| `coteMinAnnoncesModele` | annonces strictement identiques requises pour oser une cote |
| `seuilBonneAffaire` | garde-fou en pourcentage : `0.70` = au moins −30 % |
| `coteMinimum` | ignore les marques dont la cote est sous ce prix (bas de gamme) |
| `prixMinimum` | ignore les annonces en dessous (`5` €) |
| `motsAccessoire` | premiers mots de titre qui trahissent un accessoire |
| `motsAccessoireTitre` | mots qui ne désignent qu'une pièce détachée, où qu'ils soient |
| `marquesLuxe` / `prixMinimumLuxe` | maisons où un prix trop bas trahit un faux |
| `marquesPepite` / `signauxPepite` | maisons de niche et signaux de valeur |
| `seuilPepite` / `pepitePrixMax` | seuil assoupli pour les montres de collection |
| `vendeurMaxMontres` | au-delà, le vendeur est un revendeur |
| `accepterLots` / `facteurLot` | lots de montres, et décote appliquée à chaque pièce |
| `ratioAvantCoteModele` | au-delà, on ne paie pas la requête de cote précise |
| `coteMinAnnonces` | nombre d'annonces requis pour oser une cote |
| `maxAlertesParPassage` | évite d'inonder Discord |
| `bouclerSecondes` | durée d'un job. Long = moins de feux verts à demander à GitHub |
| `enregistrerToutesLesSecondes` | fréquence de sauvegarde de l'état pendant le job |
| `intervalleSecondes` | délai entre deux relevés (`40` = une montre est vue dans la minute) |
| `resumeSiRienMinutes` | fréquence du message « Rien à signaler » |
| `marquesMontres` | liste blanche des maisons horlogères |
| `etatsAcceptes` | états Vinted autorisés |
| `motsRedhibitoires` | mots qui disqualifient une annonce |

## L'état n'est pas fusionné par git

Deux jobs qui réécrivent le même JSON entier donnent un conflit que `git rebase`
ne sait pas résoudre : l'étape échouait, l'état n'était jamais enregistré, et le
job suivant réalertait tout. Observé en vrai — une même annonce envoyée sept fois.

`fusionner-etat.mjs` repart donc de la version du dépôt et y verse la nôtre :
l'union des annonces vues est la bonne opération, il n'y a rien à arbitrer. La
poussée est retentée trois fois si le dépôt bouge entre-temps.

## Limites, sans détour

- **La cote porte sur la marque, pas sur le modèle exact.** Une montre haut de
  gamme d'une marque bon marché passera pour une bonne affaire, et inversement.
  Pour trancher, ouvre l'annonce et utilise l'extension.
- **La cote vient de prix demandés, pas de prix payés.** Sur les marques que les
  vendeurs surévaluent, la médiane est gonflée et les bonnes affaires fantômes.
- **Les photos ne sont jamais regardées.** Contrefaçon, casse visible, pièce
  manquante non mentionnée : invisibles pour le script.
- **Le champ marque doit être rempli.** Les annonces sans marque sont écartées —
  or c'est un quart d'entre elles, et le profil type du vendeur qui ignore ce
  qu'il vend. Lire la marque dans le titre reste à faire.
- **Une annonce examinée ne l'est jamais deux fois** : une baisse de prix
  ultérieure ne déclenchera rien.
- Vinted peut durcir sa protection : le jour où le challenge n'est plus franchi,
  le script le signale dans les logs et réessaie au passage suivant.
- GitHub désactive les workflows planifiés d'un dépôt resté **60 jours sans
  activité**. Un commit suffit à les relancer.
- Les horaires de `cron` ne sont pas garantis à la minute près chez GitHub, et
  c'est maintenant la principale source de latence.
- **Une même annonce peut être signalée deux fois.** L'état n'est enregistré
  qu'à la fin d'un job, et deux jobs se chevauchent parfois de quelques dizaines
  de secondes au moment de la relève — observé : l'un démarre à 21:44:32 quand le
  précédent ne se termine qu'à 21:45:16. Le job qui démarre récupère alors un
  état périmé. Raccourcir la boucle réduit la fenêtre sans la supprimer.
