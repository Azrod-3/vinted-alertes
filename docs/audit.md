# Audit du bot de veille — 2 novembre 2026

Lecture de `scan.mjs`, `config.json`, `fusionner-etat.mjs`, `enregistrer-etat.sh`,
`tests.mjs`, `.github/workflows/veille.yml`, `README.md` et du contenu réel de
`etat.json` au commit `8d4f6b9`. Les 339 tests passaient au départ.

Limite de cet audit : Vinted est **inaccessible depuis le conteneur** où il a été
fait (le proxy refuse le tunnel vers `www.vinted.fr`). Rien n'a donc été vérifié
en direct ; tout ce qui suit se lit dans le code, la config, l'état et
l'échantillon d'annonce relevé dans les tests.

## Bugs (classés par impact)

| # | Impact | Constat | Où |
|---|---|---|---|
| 1 | **Fort** | **Bonnes affaires perdues quand Vinted ralentit.** `descriptionDe` renvoie `null` aussi bien pour une annonce supprimée (404) que pour un blocage (403/429) ou une erreur réseau. Dans les trois cas l'annonce est écartée comme « introuvable » et, déjà marquée vue, n'est **jamais** réexaminée. Une vraie affaire tombée pendant un 429 disparaît sans bruit. | `descriptionDe`, `unPassage` |
| 2 | **Fort** | **Candidates abandonnées au-delà de `maxAlertesParPassage`.** La boucle s'arrête à 5 alertes, mais les candidates suivantes sont déjà dans `vues` : elles ne seront jamais examinées. C'est précisément quand il y a beaucoup d'affaires qu'on en perd. | `unPassage` |
| 3 | **Fort** | **`etat.json` grossit sans fin : 6,8 Mo.** 43 118 cotes dont 42 228 périmées (plus de 24 h, donc jamais relues) = 4,4 Mo ; 63 434 vendeurs = 0,9 Mo. Rien n'est jamais effacé, et le fichier est commité toutes les 15 min (lent, alourdit le dépôt, risque de dépasser les limites GitHub à terme). | `main`, `fusionner-etat.mjs` |
| 4 | Moyen | **Vendeurs comptés depuis toujours.** Le compteur ne décroît jamais : un particulier qui vend six montres en trois mois est classé « revendeur » à vie, et ses vraies affaires sont écartées. | `unPassage`, état |
| 5 | Moyen | **Médiane biaisée vers le haut.** Sur un nombre pair d'annonces, `mediane` prend la valeur haute au lieu de la moyenne des deux centrales. Avec 3 à 8 annonces (cas courant au niveau modèle), l'écart est réel et gonfle la cote, donc la décote affichée : faux positifs. | `mediane` |
| 6 | Moyen | **Aucune gestion des blocages.** Un 403/429 est traité comme une page vide : pas de ralentissement, pas de rafraîchissement des cookies, et le passage continue d'enchaîner les requêtes de cote. Une panne en milieu de job n'est jamais signalée (seul le premier passage l'est). Une exception (page plantée, `page.goto` en timeout) fait tomber tout le job. | `api`, `catalogue`, `main` |
| 7 | Moyen | **Envois Discord sans relance.** Un 429 Discord (limite de débit) fait échouer l'alerte ; le signalement de panne ne vérifie même pas le code de retour. | `alerter`, `signalerPanne` |
| 7 bis | Moyen | **Un blocage mis en cache pour 24 h.** Quand la requête de cote échoue (403/429), le résultat vide est enregistré comme « pas de cote » et le modèle reste invisible jusqu'au lendemain. | `coteModele`, `coteMarque` |
| 8 | Faible | **Cache de cote par libellé brut.** `cotes["TISSOT"]` et `cotes["Tissot"]` sont deux entrées, et une « Tissot 1853 » n'est jamais comparée à une « Tissot » (égalité stricte des marques). Échantillons plus maigres que nécessaire. | `coteMarque`, `comparable` |
| 9 | Faible | Rafales de requêtes : toutes les requêtes de cote d'un passage partent sans pause, sans plafond. | `unPassage` |
| 10 | Faible | README périmé : « la cote porte sur la marque » et « l'état n'est enregistré qu'à la fin d'un job » ne sont plus vrais. | `README.md` |

## Faiblesses de détection

- **Annonces sans marque écartées** : le README l'estime à un quart des annonces,
  et c'est le profil type du vendeur qui ignore ce qu'il vend. La marque n'est
  jamais cherchée dans le titre.
- **Imitations repérées tard** : « hommage », « style Rolex » ne sont cherchés
  qu'après le calcul de cote et la lecture de la description, donc après deux
  requêtes. Et seul « style **rolex** » est couvert : « style Submariner »,
  « type Daytona », « homage Nautilus » passent.
- **Annonces sans montre** : « boîte seule », « box only », « solo scatola »
  ne sont reconnues que si le mot boîte est en tête de titre.
- **Frais ignorés** : la marge est calculée sur le prix affiché, alors que
  l'acheteur paie la protection acheteurs (le libellé d'accessibilité donne le
  total : 980,00 € → 1 029,70 €) et le port.
- **Aucune hiérarchie des alertes** : une marge de 70 € sur cote de marque et une
  marge de 600 € sur cote de modèle très fiable arrivent avec la même allure.

## Ce que les données ne permettent pas (et qu'on ne simule pas)

La page catalogue ne donne, pour le vendeur, que `id`, `photo` et `isBusiness`
(échantillon des tests). **Ni le nombre d'avis, ni la note, ni l'ancienneté du
compte, ni les frais de port** n'y figurent. Les obtenir demanderait une requête
de plus par annonce, que je n'ai pas pu vérifier faute d'accès à Vinted. Le score
s'appuie donc sur ce qu'on sait réellement : le nombre de montres publiées par le
vendeur (compté par le bot) et un forfait de port réglable.

## Idées, classées par impact / coût

1. **Corriger 1, 2, 3** (fort, faible coût). → fait. Sur l'état réel : 6,8 Mo → 1,2 Mo.
2. **Gestion des blocages** : statut HTTP remonté, backoff exponentiel, nouvelle
   visite de l'accueil pour rafraîchir les cookies, abandon propre du job après
   trop d'échecs (le suivant repart avec un navigateur neuf), panne signalée même
   en milieu de job. Jamais en dessous de `intervalleSecondes`. → fait.
3. **Cote plus juste** : vraie médiane, écarts aberrants retirés par MAD, marque
   canonique (regroupement « TISSOT » / « Tissot 1853 »), lissage avec la cote
   précédente au rafraîchissement, détection des références horlogères
   (SNK809, 7S26-0020, T120.407, F-91W). → fait.
4. **Filtres anti-faux positifs dès le titre** (imitations, annonces sans montre),
   avant toute requête. → fait.
5. **Marque lue dans le titre** quand le champ est vide (avec liste de mots
   ambigus : Orient, Lotus, Jaguar, Ball…). Plus de vraies affaires. → fait.
6. **Score d'affaire 0-100** + urgence + mention Discord réservée aux très
   grosses. → fait.
7. **Recherches ciblées** configurables, une seule par passage en rotation pour
   ne pas multiplier la charge. → fait.
8. Non fait, à évaluer plus tard : lire la note et le nombre d'avis du vendeur
   sur la fiche (une requête par finaliste, à vérifier en direct) ; suivre les
   baisses de prix d'annonces déjà vues ; regarder les photos.
