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
3. **Prix sous la cote.** La cote de la marque est la médiane des montres
   comparables en vente, valeurs aberrantes écartées. Le bas de gamme tombe tout
   seul grâce au **seuil de cote minimum** (60 €) : une marque dont les montres
   valent 15 € n'a pas de bonne affaire à offrir.
4. **Description propre.** Lue sur la fiche publique, elle est refusée si elle
   contient un mot rédhibitoire : « pour pièces », « ne fonctionne plus », « HS »,
   « réplique », « style Rolex », « il manque »… Les mots ambigus ont été retirés
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

93 tests, sans réseau : normalisation, liste blanche des marques, états, mots
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

Ensuite, ça tourne tout seul toutes les 15 minutes.

## Réglages (`config.json`)

| Clé | Rôle |
|---|---|
| `recherche` | mot-clé de base (`montre`) |
| `categorieVinted` | `97` = Montres |
| `seuilBonneAffaire` | rapport prix/cote maximum. `0.45` = le prix vaut au plus 45 % de la cote, soit **−55 %** |
| `coteMinimum` | ignore les marques dont la cote est sous ce prix (bas de gamme) |
| `prixMinimum` | ignore les annonces en dessous (souvent des accessoires) |
| `coteMinAnnonces` | nombre d'annonces requis pour oser une cote |
| `maxAlertesParPassage` | évite d'inonder Discord |
| `marquesMontres` | liste blanche des maisons horlogères |
| `etatsAcceptes` | états Vinted autorisés |
| `motsRedhibitoires` | mots qui disqualifient une annonce |

## Limites, sans détour

- **La cote porte sur la marque, pas sur le modèle exact.** Une montre haut de
  gamme d'une marque bon marché passera pour une bonne affaire, et inversement.
  Pour trancher, ouvre l'annonce et utilise l'extension.
- **La cote vient de prix demandés, pas de prix payés.** Sur les marques que les
  vendeurs surévaluent, la médiane est gonflée et les bonnes affaires fantômes.
- **Les photos ne sont jamais regardées.** Contrefaçon, casse visible, pièce
  manquante non mentionnée : invisibles pour le script.
- **Seules les 60 dernières annonces sont vues** à chaque passage. Aux heures de
  pointe, ce qui se publie au-delà passe à la trappe.
- **Une annonce examinée ne l'est jamais deux fois** : une baisse de prix
  ultérieure ne déclenchera rien.
- Vinted peut durcir sa protection : le jour où le challenge n'est plus franchi,
  le script le signale dans les logs et réessaie au passage suivant.
- GitHub désactive les workflows planifiés d'un dépôt resté **60 jours sans
  activité**. Un commit suffit à les relancer.
- Les horaires de `cron` ne sont pas garantis à la minute près chez GitHub.
