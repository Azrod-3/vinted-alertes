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
3. **Prix sous la cote — du modèle, pas de la marque.** La cote de marque était
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
   anglais et allemand. Les mots ambigus ont été retirés
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

175 tests, sans réseau : normalisation, liste blanche des marques, états, mots
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

Reste le décalage de GitHub lui-même : le démarrage d'un job planifié n'est pas
garanti à la minute près, surtout aux heures chargées. C'est désormais le
facteur limitant, pas le script.

## Les montres de niche

Une maison que le grand public ne connaît pas — Enicar, Nivada, Gallet, Eterna,
Favre-Leuba — ou un signal de valeur dans le texte (un mouvement Valjoux, un
Kon-Tiki, un cadran gilt, « 21 rubis », « or 18k ») trahit une montre qui vaut
bien plus que son air. Le vendeur qui écrit « Valjoux » sans savoir ce que c'est
vend souvent très en dessous.

Ces annonces obtiennent un seuil assoupli (`seuilPepite`, −20 % suffit) et sont
signalées d'un 💎. En dessous de `pepitePrixMax`, elles passent même sans cote
exploitable : c'est exactement le cas où personne ne sait ce que c'est.

## Les vendeurs

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

## Réglages (`config.json`)

| Clé | Rôle |
|---|---|
| `recherches` | les huit recherches lancées à chaque passage |
| `categorieVinted` | `97` = Montres |
| `seuilBonneAffaire` | rapport prix/cote maximum. `0.30` = le prix vaut au plus 30 % de la cote, soit une remise de **−70 %** |
| `coteMinimum` | ignore les marques dont la cote est sous ce prix (bas de gamme) |
| `prixMinimum` | ignore les annonces en dessous (`5` €) |
| `motsAccessoire` | premiers mots de titre qui trahissent un accessoire |
| `motsAccessoireTitre` | mots qui ne désignent qu'une pièce détachée, où qu'ils soient |
| `marquesLuxe` / `prixMinimumLuxe` | maisons où un prix trop bas trahit un faux |
| `marquesPepite` / `signauxPepite` | maisons de niche et signaux de valeur |
| `seuilPepite` / `pepitePrixMax` | seuil assoupli pour les montres de collection |
| `vendeurMaxMontres` | au-delà, le vendeur est un revendeur |
| `ratioAvantCoteModele` | au-delà, on ne paie pas la requête de cote précise |
| `coteMinAnnonces` | nombre d'annonces requis pour oser une cote |
| `maxAlertesParPassage` | évite d'inonder Discord |
| `bouclerSecondes` | durée de la boucle interne d'un job |
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
