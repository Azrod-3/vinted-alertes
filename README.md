# Veille Vinted → Discord

Surveille les nouvelles montres mises en vente sur Vinted et envoie une alerte
Discord quand une annonce est **nettement sous la cote de son modèle** (ou, à
défaut, de sa marque). Chaque alerte porte un **score d'affaire sur 100** et un
niveau d'urgence ; seules les très grosses affaires font sonner Discord.

L'audit qui a mené à la version de novembre 2026 est dans
[`docs/audit.md`](docs/audit.md).

Tourne sur GitHub Actions : **aucun ordinateur à laisser allumé**, et c'est gratuit.

## Septembre 2026 : l'API a disparu

Le 14 septembre, Vinted a retiré `/api/v2/catalog/items` — réponse 404, y
compris depuis un poste ordinaire : ce n'était pas un blocage anti-robot. Le bot
a tourné **deux jours et demi à vide**, chaque job se terminant en « success » et
Discord restant muet.

Les résultats sont désormais servis dans la page `/catalog` elle-même, au sein du
flux de rendu Next.js (`self.__next_f.push`). Le scan récupère ce HTML par un
`fetch` same-origin, isole chaque objet `{"id":…,"productItem":{…}}` et le
convertit vers la forme de l'ancienne API, que le reste du code attend. La marque
et l'état n'ont plus de champ propre : ils se lisent dans le libellé
d'accessibilité de la vignette.

Pour que le silence ne puisse plus jamais vouloir dire « en panne », le bot
**prévient sur Discord** quand il ne voit plus aucune annonce (rappel toutes les
`rappelPanneHeures`), et quand il les revoit.

## Pourquoi un navigateur et pas une simple requête

Vinted protège son API par un « Client Challenge » qui exige l'exécution de
JavaScript. Une requête HTTP directe reçoit une page de blocage, même avec les
cookies de la page d'accueil — vérifié. Le script lance donc un vrai Chrome,
charge le site, puis interroge l'API **depuis la page** : même origine, cookies
inclus. Testé : 20 annonces récupérées avec titres, prix et marques.

## Ce qui déclenche une alerte

Une annonce doit franchir **quatre filtres**, du moins cher au plus cher en
requêtes :

1. **Marque horlogère.** Liste blanche de ~300 maisons dont les montres sont le
   métier. Les marques de mode qui font faire leurs montres sous licence (Guess,
   Armani, Michael Kors, Diesel…) sont écartées : leur cote de revente ne veut
   rien dire. La marque est cherchée comme suite de mots complets dans le libellé,
   parce que les vendeurs écrivent « CASIO G-SHOCK » ou « Omega x Swatch ».

   **Champ marque vide ou générique** (« Autre », « Vintage », « Sans marque ») :
   la maison est cherchée **dans le titre** (`marqueDepuisTitre`). C'est le
   profil type du vendeur qui ignore ce qu'il vend. Les noms qui sont aussi des
   mots courants (Orient, Lotus, Jaguar, Ball… liste `marquesTitreAmbigues`) ne
   comptent pas, et une maison de luxe lue dans le titre est refusée
   (`marqueTitreLuxe: false`) : une Rolex sans marque renseignée est presque
   toujours une copie. L'alerte précise « marque lue dans le titre ».
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
   se trompe largement, elle exige une marge plus grande
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
4. **Pas un accessoire, pas une imitation.** Sous 5 €, la catégorie Montres se
   remplit de bracelets, d'écrins et de piles. Le premier mot du titre les trahit
   presque toujours (« Bracelet de montre Seiko », « Cinturino Casio »), et
   quelques mots — maillon, maglie, eslabones, « boîte seule », « box only »,
   « sans montre » — suffisent où qu'ils soient : « Zenith museum maglie » à 10 €
   passait pour une Zenith à −96 %.

   « box », « case », « scatola »… au milieu du titre ne disqualifient plus une
   montre quand le titre dit qu'elle est **avec** sa boîte (« Omega Seamaster
   with box », « Tissot PRX full set box papiers ») : ces vraies montres étaient
   jetées comme accessoires.

   Les **imitations** sont repérées dès le titre, avant toute requête :
   « homage », « réplique », « clone », « inspired »… (`motsImitation`), ou un
   préfixe suivi d'une maison de luxe ou d'un modèle iconique — « style Rolex »,
   « type Daytona », « homage Nautilus » (`prefixesImitation`,
   `modelesIconiques`). Seul « style rolex » était couvert, et seulement après
   le calcul de cote et la lecture de la description.
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

## La cote, plus robuste

- **Vraie médiane.** Sur un nombre pair d'annonces, l'ancienne version prenait
  la valeur haute des deux centrales : avec 4 à 8 annonces, cas courant au
  niveau du modèle, la cote était gonflée — et la décote avec elle.
- **Aberrations retirées.** Dès cinq annonces, celles qui s'écartent de plus de
  `coteSeuilMAD` fois l'écart absolu médian (MAD) sont ignorées : une annonce à
  300 € parmi des 110 € ne bouge plus la cote.
- **Références horlogères lues avant normalisation** : « F-91W », « 7S26-0020 »,
  « T120.407 », « SNK809 », « 6139 ». « F91W », « F-91W » et « F 91W » sont
  reconnues comme la même montre ; « PR100 » ne matche pas « PR1000 ». Tailles,
  étanchéités, années, carats et rubis ne sont pas des références.
- **Marque canonique.** « TISSOT », « Tissot » et « Tissot 1853 » partagent la
  même cote de marque et se comparent entre elles.
- **Lissage.** Une cote rafraîchie garde `coteLissage` (30 %) de l'ancienne :
  un relevé de 40 annonces est un instantané bruité.
- **Dispersion mesurée** (écart interquartile / médiane) : quand les prix
  comparables partent dans tous les sens, le score baisse.
- **Une requête bloquée ne met rien en cache.** Avant, un 429 enregistrait « pas
  de cote » pour 24 h et le modèle restait invisible toute la journée.

## Score d'affaire et urgence

Chaque alerte reçoit un score sur 100 :

| Composante | Points | Plein quand |
|---|---|---|
| Décote | 35 | coût total ≤ 40 % de la cote |
| Bénéfice net | 25 | ≥ 300 € |
| Fiabilité de la cote | 15 | cote de modèle, ≥ 12 annonces, prix serrés |
| État | 10 | neuf avec étiquette |
| Vendeur | 5 | particulier qui ne vend qu'une montre |
| Fraîcheur | 5 | en tête des nouveautés |
| Pépite | 5 | maison de niche ou signal de valeur |

Le **coût** est le prix total payé par l'acheteur — protection acheteurs
comprise, lue dans le libellé de la vignette (980,00 € → 1 029,70 €) — plus un
forfait de port `fraisPortEstimes`. Le catalogue ne donne pas les frais de port,
ni la note, le nombre d'avis ou l'ancienneté du vendeur : ils ne sont **pas**
simulés. Le forfait est à régler selon ce que tu paies d'habitude.

| Score | Urgence | Discord |
|---|---|---|
| ≥ `scoreMention` (75) | 🔥 très grosse affaire | rouge + mention `mentionDiscord` (`@here`) |
| ≥ `scoreFort` (55) | ⚡ bonne affaire | orange, sans mention |
| en dessous | à regarder | vert (violet pour une pépite) |

Le score **classe** les alertes (les meilleures partent en premier) ; il ne les
filtre pas, sauf si tu relèves `scoreMinimum` (0 par défaut). Le filtre reste la
marge (`margeMinimum`).

L'alerte affiche : grande photo, prix (et total frais inclus), cote et son
niveau, % de décote, bénéfice net estimé, score, état, marque, nombre de montres
du vendeur, lien direct. Pour mentionner un rôle plutôt que tout le salon, mets
`"mentionDiscord": "<@&ID_DU_ROLE>"` ; `""` désactive toute mention.

## Recherches ciblées

En plus de la catégorie complète, `recherches` permet de surveiller des modèles
précis :

```json
"recherchesParPassage": 1,
"recherches": [
  { "nom": "Tissot PRX", "actif": true, "texte": "tissot prx",
    "prixMin": 50, "prixMax": 300, "alerteSousPrix": 150, "toutesMarques": false }
]
```

- **Une seule recherche par passage**, en rotation (`recherchesParPassage`) :
  chaque recherche coûte une requête, et on ne martèle pas Vinted.
- `prixMin` / `prixMax` : fourchette. Elle est passée à Vinted
  (`price_from` / `price_to`) **et** refiltrée par le bot, parce que ces
  paramètres n'ont pas pu être revérifiés depuis le changement de septembre.
- `alerteSousPrix` : sous ce prix, alerte même sans cote fiable (« sniper »).
  Les filtres anti-faux positifs (accessoire, imitation, description) restent
  appliqués.
- `toutesMarques: true` : accepte une marque hors liste blanche (utile pour une
  maison retirée exprès, comme Seiko ou Casio, sur un modèle précis).
- L'exemple livré dans `config.json` est désactivé (`"actif": false`).

## Quand Vinted freine

- Chaque requête remonte son **statut HTTP**. Un 403, un 429 ou une page de
  challenge **arrête le passage** au lieu d'enchaîner les requêtes de cote.
- Les requêtes sont espacées d'au moins `pauseEntreRequetesMs` et plafonnées à
  `maxRequetesParPassage` par passage.
- Après un passage raté, l'intervalle **double** (jamais en dessous de
  `intervalleSecondes`, jamais au-dessus de `backoffMaxSecondes`). Après
  `echecsAvantRelance` échecs, le bot revisite l'accueil pour repartir d'une
  session propre ; après `echecsAvantAbandon`, il signale la panne sur Discord
  et rend la main — le job suivant repart avec un navigateur neuf. Aucune autre
  manœuvre de contournement.
- Les annonces qu'on n'a pas pu juger (fiche en 429, plafond d'alertes ou de
  requêtes atteint) passent dans une **file d'attente** examinée en tête au
  passage suivant (`essaisDescription` essais au plus). Avant, une vraie affaire
  tombée pendant un 429 était jetée comme « introuvable », pour toujours.
- Les envois Discord sont relancés sur 429 (délai `retry_after` respecté) et sur
  erreur 5xx ou réseau.
- Le résumé « Rien à signaler » mentionne les blocages subis.

## Où se lit quoi

La recherche de catalogue donne titre, prix, marque, photo et **état**. Elle ne
donne pas la description : `/api/v2/items/<id>` répond 404 et `/details` répond
403. La description se lit dans le bloc JSON-LD de la fiche publique, récupérée
par un `fetch` same-origin sans rendu (~500 ms). C'est fait **uniquement pour les
finalistes**, soit une poignée par passage.

## Tests

    npm test

462 tests, sans réseau : normalisation, liste blanche des marques, états, mots
rédhibitoires et pièges de négation, cote robuste, références, imitations,
score, message Discord, backoff, recherches, élagage et fusion de l'état.

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
| `rappelPanneHeures` | délai minimum entre deux messages « le bot ne voit plus aucune annonce » |
| `enregistrerToutesLesSecondes` | fréquence de sauvegarde de l'état pendant le job |
| `intervalleSecondes` | délai entre deux relevés (`40` = une montre est vue dans la minute) |
| `resumeSiRienMinutes` | fréquence du message « Rien à signaler » |
| `marquesMontres` | liste blanche des maisons horlogères |
| `etatsAcceptes` | états Vinted autorisés |
| `motsRedhibitoires` | mots qui disqualifient une annonce |

Ajoutés en novembre 2026 (tous facultatifs, valeur par défaut entre parenthèses) :

| Clé | Rôle |
|---|---|
| `marqueDepuisTitre` (`true`) | cherche la maison dans le titre quand le champ marque est vide ou générique |
| `marquesGeneriques` | libellés de marque qui ne disent rien (« Autre », « Vintage »…) |
| `marquesTitreAmbigues` | maisons dont le nom est aussi un mot courant, jamais lues dans le titre |
| `marqueTitreLuxe` (`false`) | accepter une maison de luxe lue seulement dans le titre |
| `motsImitation` | mots qui trahissent une imitation où qu'ils soient dans le titre |
| `prefixesImitation` / `modelesIconiques` | « style », « type »… suivis d'une maison de luxe ou d'un modèle iconique |
| `motsEmballage` / `indicesMontreAvecEmballage` | « box », « case »… accessoire, sauf si le titre dit « avec », « with », « full set »… |
| `coteSeuilMAD` (`3`) | au-delà de ce nombre de MAD, un prix est une aberration |
| `coteLissage` (`0.3`) | part de l'ancienne cote gardée au rafraîchissement |
| `coteConserverHeures` (`48`) | au-delà, une cote est effacée de l'état |
| `vendeurFenetreJours` (`30`) | un vendeur non revu depuis est oublié |
| `fraisPortEstimes` (`6`) | forfait de port ajouté au coût (le catalogue ne le donne pas) |
| `scoreMinimum` (`0`) | score sous lequel une alerte n'est pas envoyée |
| `scoreFort` / `scoreMention` (`55` / `75`) | seuils d'urgence |
| `mentionDiscord` (`"@here"`) | mention posée sur les très grosses affaires ; `""` pour aucune |
| `maxRequetesParPassage` (`40`) | plafond de requêtes Vinted par passage |
| `pauseEntreRequetesMs` (`600`) | écart minimal entre deux requêtes Vinted |
| `fileAttenteMax` (`150`) | taille maximale de la file des annonces reportées |
| `essaisDescription` (`3`) | essais avant d'abandonner une annonce illisible |
| `echecsAvantRelance` / `echecsAvantAbandon` (`2` / `4`) | quand revisiter l'accueil, quand rendre la main |
| `backoffMaxSecondes` (`600`) | attente maximale entre deux passages ratés |
| `recherches` / `recherchesParPassage` (`[]` / `1`) | recherches ciblées, voir plus haut |

## L'état n'est pas fusionné par git

Deux jobs qui réécrivent le même JSON entier donnent un conflit que `git rebase`
ne sait pas résoudre : l'étape échouait, l'état n'était jamais enregistré, et le
job suivant réalertait tout. Observé en vrai — une même annonce envoyée sept fois.

`fusionner-etat.mjs` repart donc de la version du dépôt et y verse la nôtre :
l'union des annonces vues est la bonne opération, il n'y a rien à arbitrer. La
poussée est retentée trois fois si le dépôt bouge entre-temps.

Les règles de fusion vivent dans `etat.mjs`, partagé avec le scan et testé. Il
**élague** aussi l'état : au 2 novembre 2026, `etat.json` pesait 6,8 Mo — 43 118
cotes dont 42 228 périmées, 63 434 vendeurs comptés depuis toujours — et il est
commité toutes les quinze minutes. Les cotes de plus de `coteConserverHeures`
et les vendeurs non revus depuis `vendeurFenetreJours` sont effacés : 1,2 Mo
sur le même état. Les vendeurs sont désormais notés `{ n, vu }` ; l'ancien
format (un simple nombre) est encore lu.

## Limites, sans détour

- **La cote retombe sur la marque quand le modèle est trop rare** (moins de
  `coteMinAnnoncesModele` annonces identiques). Elle mélange alors tous les
  modèles : c'est pourquoi elle exige une marge plus grande et pèse moins dans
  le score.
- **La cote vient de prix demandés, pas de prix payés.** Sur les marques que les
  vendeurs surévaluent, la médiane est gonflée et les bonnes affaires fantômes.
- **Les photos ne sont jamais regardées.** Contrefaçon, casse visible, pièce
  manquante non mentionnée : invisibles pour le script.
- **La marque lue dans le titre** ne vaut que pour la liste blanche, hors noms
  ambigus et hors maisons de luxe. Une annonce sans marque ni maison
  reconnaissable dans le titre reste écartée.
- **Le vendeur n'est jugé que sur ce que le catalogue donne** : compte pro ou
  non, et nombre de montres publiées (compté par le bot). Note, avis et
  ancienneté du compte demanderaient une requête par annonce, non vérifiée.
- **La file d'attente vit en mémoire** : ce qui y reste à la fin d'un job de
  cinq heures n'est pas réexaminé par le suivant (le journal le dit).
- **Une annonce examinée ne l'est jamais deux fois** : une baisse de prix
  ultérieure ne déclenchera rien.
- Vinted peut durcir sa protection : le jour où le challenge n'est plus franchi,
  le script ralentit, réessaie, puis signale la panne sur Discord.
- GitHub désactive les workflows planifiés d'un dépôt resté **60 jours sans
  activité**. Un commit suffit à les relancer.
- Les horaires de `cron` ne sont pas garantis à la minute près chez GitHub, et
  c'est maintenant la principale source de latence.
- **Une même annonce peut encore, rarement, être signalée deux fois.** L'état
  est enregistré toutes les quinze minutes et la `concurrency` du workflow
  empêche deux jobs simultanés, mais une alerte partie entre deux
  enregistrements est oubliée si le job meurt avant le suivant.
