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

Pour chaque nouvelle annonce, la cote de sa marque est calculée sur les montres
comparables en vente (médiane, valeurs aberrantes écartées). L'annonce est
signalée si son prix est **sous 45 % de cette cote**.

Le bas de gamme est écarté de deux façons : une liste de marques connues, et
surtout un **seuil de cote minimum** (60 €). Une marque dont les montres valent
15 € en moyenne n'a pas de bonne affaire à offrir — inutile de la nommer, elle
est écartée d'office.

Les cotes sont mises en cache 24 h, et les annonces déjà signalées sont
mémorisées pour ne jamais alerter deux fois.

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
| `seuilBonneAffaire` | `0.45` = alerte sous 45 % de la cote |
| `coteMinimum` | ignore les marques dont la cote est sous ce prix (bas de gamme) |
| `prixMinimum` | ignore les annonces en dessous (souvent des accessoires) |
| `coteMinAnnonces` | nombre d'annonces requis pour oser une cote |
| `maxAlertesParPassage` | évite d'inonder Discord |
| `marquesIgnorees` | marques fourre-tout, sans cote exploitable |

## Limites, sans détour

- **La cote porte sur la marque, pas sur le modèle exact.** Une montre haut de
  gamme d'une marque bon marché passera pour une bonne affaire, et inversement.
  Pour trancher, ouvre l'annonce et utilise l'extension.
- Vinted peut durcir sa protection : le jour où le challenge n'est plus franchi,
  le script le signale dans les logs et réessaie au passage suivant.
- GitHub désactive les workflows planifiés d'un dépôt resté **60 jours sans
  activité**. Un commit suffit à les relancer.
- Les horaires de `cron` ne sont pas garantis à la minute près chez GitHub.
