/** Tests des filtres, de la cote, du score et de l'etat. `npm test`. Aucun reseau. */
import { normaliser, marqueHorlogere, etatAcceptable, motRedhibitoire, motifDeRefus, texteResume, estAccessoire, estLuxe, marqueInexistante, requeteModele, estPepite, merite, estLot, nombreDansLot, article, comparable, annonceDepuisProduit, rechercheUrl, etatProche, jetonsModele, mediane, nettoyer, dispersion, calculerCote, lisserCote, marqueCanonique, marqueDepuisTitre, marqueDe, estImitation, extraireReferences, titreContient, prixTotalDepuisLibelle, scoreAffaire, corpsAlerte, delaiBackoff, statutBloquant, recherchesDuPassage, dansFourchette, preuvesCote, coteUtilisable, texteComparables, statutSuivi, entreeSuivi, aVerifier, doitEnvoyerRecap, texteRecap } from "./scan.mjs";
import { elaguerCotes, elaguerVendeurs, lireVendeur, fusionnerEtats, elaguerSuivi } from "./etat.mjs";

let ok = 0;
const echecs = [];
const verifier = (nom, obtenu, attendu) => {
  if (String(obtenu) === String(attendu)) ok += 1;
  else echecs.push(`${nom}\n    attendu : ${attendu}\n    obtenu  : ${obtenu}`);
};

// --- Normalisation -----------------------------------------------------------
verifier("accents", normaliser("Très bon état"), "tres bon etat");
verifier("ponctuation", normaliser("TAG-Heuer"), "tag heuer");
verifier("espaces multiples", normaliser("Tag   Heuer "), "tag heuer");

// --- Marques : liste blanche horlogere ---------------------------------------
for (const marque of ["Citizen", "TAG Heuer", "tag-heuer", "Festina", "Vostok", "Mühle-Glashütte",
                      // Marques ecrites librement par les vendeurs : la marque
                      // doit se reconnaitre au milieu du libelle.
                      "Reloj Potens De Luxe Automático 25 Joyas",
                      "Breil", "Candino", "Invicta", "Philip Watch"]) {
  verifier(`marque acceptée : ${marque}`, marqueHorlogere(marque), true);
}
// Marques de mode qui font faire leurs montres sous licence : refusees.
for (const marque of ["Guess", "Emporio Armani", "Michael Kors", "Diesel", "Hugo Boss", "Lacoste",
                      "Calvin Klein", "Tommy Hilfiger", "Zara", "Shein", "Vespa", "Jeep",
                      "Apple", "Samsung", "Huawei", "Fitbit", "SKMEI", "Curren", "", "Autre",
                      // Retirées à la demande : trop de contrefaçons pour Swatch,
                      // trop de bas de gamme pour Casio. Leurs lignes suivent.
                      "Swatch", "Flik Flak", "Casio", "CASIO", "G-Shock", "CASIO G-SHOCK", "Edifice",
                      // Seiko retirée aussi : ses lignes homonymes partent avec.
                      "Seiko", "SEIKO", "Prospex", "Presage", "Astron",
                      // Pas des marques : libelles fourre-tout de Vinted.
                      "Quartz", "Orologio", "Vintage", "Inconnu", "montres", "Japan Style",
                      // Pieges du matching par mots : ne doivent PAS matcher.
                      "Telstarr", "Lipstick", "Ballon", "Wenger Sports Bag"]) {
  verifier(`marque refusée : ${marque || "(vide)"}`, marqueHorlogere(marque), false);
}

// --- Etat --------------------------------------------------------------------
for (const etat of ["Neuf avec étiquette", "Neuf sans étiquette", "Très bon état", "Bon état"]) {
  verifier(`état accepté : ${etat}`, etatAcceptable(etat), true);
}
for (const etat of ["Satisfaisant", "", "Mauvais état"]) {
  verifier(`état refusé : ${etat || "(vide)"}`, etatAcceptable(etat), false);
}

// --- Description : mots redhibitoires ----------------------------------------
const refusees = [
  ["montre vendue pour pièces détachées", "pour pieces"],
  ["Belle Seiko mais elle ne fonctionne plus", "ne fonctionne plus"],
  ["Montre HS, à réparer", "hs"],
  ["Réplique de très bonne qualité", "replique"],
  ["montre style Rolex", "style rolex"],
  ["Vendu tel quel", "vendu tel quel"],
  ["Bracelet seul, sans boîtier", "bracelet seul"],
  ["Lot de 3 montres", "lot de"],
  ["Watch not working, sold for parts", "not working"],
  ["Uhr defekt", "defekt"],
];
for (const [texte, mot] of refusees) {
  verifier(`refusée : « ${texte} »`, motRedhibitoire(texte), mot);
}

// Aucune de celles-la ne doit etre bloquee : ce sont des annonces saines.
const saines = [
  "Montre Seiko automatique, fonctionne parfaitement, révisée en 2024.",
  "Superbe Festina chronographe, portée quelques fois, boîte et papiers.",
  "Casio vintage des années 90, pile changée récemment, tourne nickel.",
  "Montre Tissot en très bon état, quelques micro-rayures d'usage sur le fond.",
  "Longines mécanique, remontage manuel, garde l'heure à la seconde près.",
  "Montre des années 40, parfait état, tourne à la perfection. Mouvement valjoux.",
  // Pieges de negation : le vendeur dit l'inverse du mot qu'on cherche.
  "Montre complète, il ne manque rien.",
  "Ce n'est pas un faux, montre authentique avec certificat.",
  "Copie du certificat d'authenticité fournie avec la montre.",
  "Aucune rayure, rien de cassé.",
  "Verre sans aucune fêlure ni éclat.",
  "Livrée dans sa boîte, rien ne manque.",
];
for (const texte of saines) {
  verifier(`saine : « ${texte.slice(0, 40)}… »`, motRedhibitoire(texte), "");
}

// Pieges de decoupage : "hs" ne doit pas matcher a l'interieur d'un mot.
verifier("« hs » dans un mot", motRedhibitoire("Montre Cachs collection"), "");
verifier("« casse » vs « cassette »", motRedhibitoire("livrée dans sa cassette d'origine"), "");
// Les vraies avaries, elles, doivent toujours passer a la trappe.
for (const [texte, mot] of [
  ["Montre cassée, vendue en l'état", "vendue en l etat"],
  ["Le verre est cassé", "est casse"],
  ["Il manque une aiguille", "il manque"],
  ["C'est une copie, je le précise", "c est une copie"],
  ["Fermoir cassé mais réparable", "fermoir casse"],
]) {
  verifier(`avarie détectée : « ${texte} »`, motRedhibitoire(texte), mot);
}

verifier("titre analysé aussi", motRedhibitoire("Montre pour pièces", ""), "pour pieces");

// --- Filtre complet sur une annonce ------------------------------------------
const annonce = (extra) => ({ id: 1, title: "Montre", brand_title: "Citizen",
  status: "Très bon état", price: { amount: "80.0" }, ...extra });

verifier("annonce valide", motifDeRefus(annonce({})), "");
verifier("déjà vue", motifDeRefus(annonce({}), new Set(["1"])), "deja");
verifier("trop bon marché", motifDeRefus(annonce({ price: { amount: "3.0" } })), "prix");
verifier("15 € accepté depuis le nouveau plancher", motifDeRefus(annonce({ price: { amount: "15.0" } })), "");
verifier("prix illisible", motifDeRefus(annonce({ price: null })), "prix");
verifier("marque hors horlogerie", motifDeRefus(annonce({ brand_title: "Guess" })), "marque");
verifier("Seiko écartée", motifDeRefus(annonce({ brand_title: "Seiko" })), "marque");
// Grand Seiko, King Seiko et Credor restent : c'est un tout autre marché.
for (const marque of ["Grand Seiko", "King Seiko", "Credor", "Seikosha", "Pulsar", "Lorus", "Alba"]) {
  verifier(`${marque} conservée`, marqueHorlogere(marque), true);
}
verifier("marque vide", motifDeRefus(annonce({ brand_title: "" })), "marque");
verifier("état satisfaisant", motifDeRefus(annonce({ status: "Satisfaisant" })), "etat");

verifier("CASIO G-SHOCK écartée", motifDeRefus(annonce({ brand_title: "CASIO G-SHOCK" })), "marque");
// La MoonSwatch survit au retrait de Swatch : elle passe par « Omega ».
verifier("MoonSwatch écartée elle aussi",
  motifDeRefus(annonce({ brand_title: "Omega x Swatch" })), "fausse");

// --- Accessoires : décidé sur le PREMIER mot du titre -----------------------
for (const titre of ["Bracelet de montre Seiko cuir", "Cinturino Casio in pelle",
                     "Correa para reloj", "Écrin 12 montres", "Lot de 3 piles",
                     "Boîte de rangement montres", "Maillons Seiko", "Verre minéral 32 mm",
                     // Pieces detachees annoncees en fin de titre.
                     "Zenith museum maglie", "Seiko eslabones acero", "Rolex maillon or"]) {
  verifier(`accessoire : « ${titre} »`, estAccessoire(titre), true);
}
// Le mot accessoire au MILIEU du titre ne doit rien changer : c'est une montre.
for (const titre of ["Montre Seiko bracelet cuir noir", "Casio vintage bracelet acier",
                     "Reloj Seiko Arabic Dial Azul", "Orologio Seiko cinturino pelle",
                     "G-Shock avec sa boîte d'origine"]) {
  verifier(`vraie montre : « ${titre} »`, estAccessoire(titre), false);
}
verifier("accessoire écarté par le filtre complet",
  motifDeRefus({ id: 9, title: "Bracelet Citizen", brand_title: "Citizen",
                 status: "Bon état", price: { amount: "12.0" } }), "accessoire");

// --- Italien -----------------------------------------------------------------
for (const [texte, mot] of [
  ["Hamilton bracciale manca un finale", "manca un"],
  ["Orologio non funzionante", "non funzionante"],
  ["Vetro rotto, da riparare", "da riparare"],
  ["Venduto per ricambi", "per ricambi"],
  ["Replica di ottima qualità", "replica"],
]) {
  verifier(`italien : « ${texte} »`, motRedhibitoire(texte), mot);
}
for (const texte of ["Orologio Seiko automatico, perfettamente funzionante",
                     "Bellissimo orologio, non manca nulla"]) {
  verifier(`italien sain : « ${texte.slice(0, 35)}… »`, motRedhibitoire(texte), "");
}

// --- Objets VENDUS POUR une montre, qui ne sont pas des montres --------------
// Quatre alertes réelles reçues en cinq minutes : « cartellino », c'est
// l'étiquette en carton qui accompagne la montre.
for (const titre of ["Cartellino originale per orologi Universal Geneve",
                     "Tag originale per orologi Universal Genève",
                     "Etichetta orologio Rolex", "Bracelet pour montre Seiko",
                     "Correa para reloj Casio", "Lederband für Uhren",
                     "Leather strap for watches", "Libretto Omega",
                     "Depliant pubblicitario orologi",
                     // Boites et ecrins dans les cinq langues.
                     "Scatola Orologio Certina Vintage - Full Set",
                     "Astuccio orologio Omega", "Estuche reloj Seiko",
                     "Uhrenkoffer Leder", "Watch case Seiko",
                     // Neerlandais : « horlogeband » est un bracelet. Une alerte
                     // reelle est partie faute de connaitre la langue.
                     "Seiko titanium horlogeband 20mm", "Horlogebandje leer 20mm",
                     "Schakelband Seiko", "Horlogedoos hout"]) {
  verifier(`objet pour montre : « ${titre} »`, estAccessoire(titre), true);
}
// Piège : "tag" est dans "TAG Heuer". Ce mot seul ne doit jamais bloquer.
for (const titre of ["TAG Heuer Monaco", "Tag Heuer Formula 1", "Montre TAG Heuer",
                     // « horloge » tout court veut dire montre en neerlandais.
                     "Seiko horloge automatisch", "Zenith horloge vintage"]) {
  verifier(`TAG Heuer intacte : « ${titre} »`, estAccessoire(titre), false);
}
// Retirees du plancher luxe : ce sont des maisons a pepites, et une Longines
// ou une Universal Geneve sous-cotee a 80 EUR est exactement ce qu'on cherche.
verifier("Universal Genève examinée dès 5 €", estLuxe("Universal Genève"), false);
verifier("Longines aussi", estLuxe("Longines"), false);
verifier("Movado aussi", estLuxe("Movado"), false);
verifier("Rolex garde son plancher", estLuxe("Rolex"), true);

// Collaborations inventées : trois alertes réelles sont parties pour une
// « Swatch x Audemars Piguet » à 100 €, annonces supprimées par Vinted dans la
// foulée. « Swatch » figurait seul parmi les exceptions au plancher, ce qui
// exemptait toute marque contenant ce mot.
for (const marque of ["Swatch x Audemars Piguet", "Audemars Piguet x Swatch",
                      "AP x Swatch", "Swatch x Rolex"]) {
  verifier(`collaboration inventée : ${marque}`, marqueInexistante(marque), true);
}
// Les collaborations Swatch partent avec la marque : leur libellé porte
// « Omega » ou « Blancpain », qui les faisait passer par la bande.
for (const marque of ["Omega x Swatch", "MoonSwatch", "Blancpain x Swatch"]) {
  verifier(`collaboration Swatch écartée : ${marque}`, marqueInexistante(marque), true);
}
for (const marque of ["Audemars Piguet", "Omega", "Blancpain", "Seiko"]) {
  verifier(`maison intacte : ${marque}`, marqueInexistante(marque), false);
}
verifier("fausse collab écartée quel que soit le prix",
  motifDeRefus({ id: 5, title: "Royal pop", brand_title: "Swatch x Audemars Piguet",
                 status: "Très bon état", price: { amount: "500" } }), "fausse");
verifier("MoonSwatch écartée",
  motifDeRefus({ id: 5, title: "MoonSwatch Mission to Venus", brand_title: "Omega x Swatch",
                 status: "Très bon état", price: { amount: "80" } }), "fausse");
verifier("Omega seule reste intacte",
  motifDeRefus({ id: 5, title: "Omega Seamaster", brand_title: "Omega",
                 status: "Très bon état", price: { amount: "900" } }), "");
// Maisons ajoutées après coup : Cartier manquait totalement à la liste.
for (const marque of ["Franck Muller", "Richard Mille", "Jaquet Droz", "F.P. Journe",
                      "Greubel Forsey", "Urwerk"]) {
  verifier(`${marque} a un plancher`, estLuxe(marque), true);
}
// Joailliers et maisons de mode : ce n'est pas leur metier, meme a ce prix.
for (const marque of ["Cartier", "Chopard", "Piaget", "Bvlgari", "Chanel", "Hermès",
                      "Van Cleef & Arpels"]) {
  verifier(`${marque} n'est pas un horloger`, marqueHorlogere(marque), false);
}
// Volontairement sans plancher : une vraie Baume & Mercier à 199 € cotée 550 €
// a été trouvée, un plancher l'aurait jetée sans l'examiner.
for (const marque of ["Baume & Mercier", "Corum", "Perrelet", "Carl F. Bucherer"]) {
  verifier(`${marque} sans plancher`, estLuxe(marque), false);
}
for (const marque of ["Richard Mille", "Corum", "Perrelet", "Bovet", "Angelus",
                      // Maisons ajoutées au dernier tour, dont les militaires et
                      // les vintage méconnues.
                      "Titoni", "CWC", "Precista", "Auricoste", "Dodane", "U-Boat",
                      "Nivada Grenchen", "Ollech & Wajs", "Leonidas", "Excelsior Park",
                      "Accutron", "Sternglas", "Mondaine", "Marathon"]) {
  verifier(`${marque} est reconnue`, marqueHorlogere(marque), true);
}

// --- Luxe à prix impossible : ce sont des faux, pas des affaires -------------
// Toutes ces alertes sont reellement parties une nuit avant ce filtre.
for (const [titre, marque, prix] of [
  ["Omega Eminyeeto Reeba", "Omega", 50],
  ["Eshaaha ya dijitali eya Omega", "Omega", 50],
  ["TUDOR", "Tudor", 145],
  ["Zenith argento", "Zenith", 110],
  ["Rolex Submariner", "Rolex", 200],
]) {
  verifier(`faux ${marque} à ${prix} €`,
    motifDeRefus({ id: 7, title: titre, brand_title: marque, status: "Bon état",
                   price: { amount: String(prix) } }), "fausse");
}
// Au-dessus du plancher, la maison de luxe repasse comme les autres.
verifier("vraie Omega à 900 €",
  motifDeRefus({ id: 7, title: "Omega Seamaster", brand_title: "Omega",
                 status: "Bon état", price: { amount: "900" } }), "");
// Le plancher luxe ne doit pas toucher les marques accessibles.
verifier("Citizen à 45 € intacte",
  motifDeRefus({ id: 7, title: "Montre Citizen automatique", brand_title: "Citizen",
                 status: "Bon état", price: { amount: "45" } }), "");
verifier("Citizen n'est pas du luxe", estLuxe("Citizen"), false);
verifier("Grand Seiko l'est", estLuxe("Grand Seiko"), true);


// --- Accessoires en allemand -------------------------------------------------
for (const titre of ["Uhrenbox Vintage Hamilton Bakelit", "Lederband Glashütte",
                     "Uhrenarmband Leder 20mm", "Ersatzteile Uhr"]) {
  verifier(`accessoire allemand : « ${titre} »`, estAccessoire(titre), true);
}

// --- Cote au niveau du modèle ------------------------------------------------
verifier("référence chiffrée prioritaire", requeteModele("Montre Seiko 5 automatique SNK809", "Seiko"), "Seiko snk809 automatique");
verifier("modèle nommé", requeteModele("Tissot pr100 Quartz dans un très bon état", "Tissot"), "Tissot pr100");
verifier("titre sans information", requeteModele("Orologio Seiko Vintage", "Seiko"), "");
verifier("mots de la marque exclus", requeteModele("montre g shock rose", "CASIO G-SHOCK"), "");
verifier("taille ignorée", requeteModele("Montre Seiko 40mm", "Seiko"), "");
verifier("modèle de trois lettres", requeteModele("Tissot PRX 35mm", "Tissot"), "Tissot prx");
verifier("référence collée", requeteModele("Seiko SKX007", "Seiko"), "Seiko skx007");

// --- Pépites : maisons de niche et signaux de valeur -------------------------
for (const [titre, marque] of [
  ["Seiko Solar Diver's 200M", "Seiko"],
  ["Chronographe Valjoux 7734", "Sans marque"],
  ["Montre Enicar automatique", "Enicar"],
  ["Eterna KonTiki vintage", "Eterna"],
  ["Orologio cronografo Landeron", "Sans marque"],
  ["Montre or 18k mécanique", "Sans marque"],
]) {
  verifier(`pépite : « ${titre} »`, estPepite(titre, "", marque), true);
}
// "Chronographe" est dans un titre sur deux : retire apres une fausse pepite.
for (const [titre, marque] of [["Montre Festina quartz", "Festina"], ["Casio F-91W", "Casio"],
                               ["CITIZEN Men's Chronograph Eco-Drive Watch", "Citizen"],
                               ["Montre chronographe homme", "Fossil"]]) {
  verifier(`pas une pépite : « ${titre} »`, estPepite(titre, "", marque), false);
}
verifier("signal lu dans la description", estPepite("Vieille montre", "mouvement Valjoux 72", "Inconnue"), true);

// --- Défauts dont le mot sert aussi à dire qu'ils sont absents --------------
// « Verre Plexiglas fissuré » est passé : le mot manquait, et l'ajouter
// brutalement aurait bloqué « aucune fissure », qui dit l'inverse.
for (const [texte, mot] of [
  ["Bon état. Verre Plexiglas fissuré", "fissure"],
  ["Vetro incrinato", "incrinato"],
  ["Boîtier rouillé, à nettoyer", "rouille"],
  ["Glass is cracked", "cracked"],
  ["Horloge werkt niet", "werkt niet"],
  ["Kapot horloge, voor onderdelen", "kapot"],
  ["Beetje roest op de kast", "roest"],
  // Un particulier vend UNE montre, pas une gamme avec tarif revendeur.
  ["100€ montre + bracelet offert Plusieurs coloris disponibles", "plusieurs coloris"],
  ["Lots disponibles pour les revendeurs", "pour les revendeurs"],
  ["Plusieurs coloris disponibles, sur commande", "plusieurs coloris"],
  ["Vente en gros, dropshipping", "vente en gros"],
]) {
  verifier(`défaut : « ${texte} »`, motRedhibitoire(texte), mot);
}
for (const texte of [
  "Montre en parfait état, aucune fissure",
  "Il n'y a aucune fissure sur le verre",
  "Sans fissure ni trace de rouille",
  "Aucune trace de rouille, très propre",
  "Senza incrinature",
  "Geen roest, mooi horloge",
  "Loopt nog. Wel al oud. Moet schoongemaakt worden.",
  // L'usure normale d'une vintage ne doit rien déclencher.
  "Montre Tissot très bon état, quelques micro-rayures d'usage sur le fond",
  "Petites rayures d'usage, rien de méchant",
]) {
  verifier(`nié ou bénin : « ${texte.slice(0, 38)}… »`, motRedhibitoire(texte), "");
}

// --- Lots : plusieurs montres comparées à la médiane d'une seule ------------
for (const titre of ["2 Orologi Swatch Nuovi Vintage", "2 Orologi in Blocco Swatch",
                     "Lot de 3 montres Seiko", "Konvolut Uhren", "Coppia orologi",
                     "Stock 12 orologi", "Job lot watches"]) {
  verifier(`lot : « ${titre} »`, estLot(titre), true);
}
// Un lot n'est accepté que si son nombre est annoncé : sans chiffre, on ignore
// ce qu'on achète.
for (const [titre, n] of [["2 Orologi Swatch Nuovi Vintage", 2], ["Lot de 3 montres Seiko", 3],
                          ["Lotto di 5 orologi", 5], ["Set di 4 orologi", 4],
                          ["Konvolut Uhren", 0], ["Stock 12 orologi", 0]]) {
  verifier(`lot de ${n || "?"} : « ${titre} »`, nombreDansLot(titre), n);
}
verifier("une montre seule n'est pas un lot", nombreDansLot("Seiko 5 sports"), 0);
// Un lot de 3 Seiko cotées 100 € vaut 3 x 100 x 0,6 = 180 €, pas 100 €.
verifier("lot de 3 à 90 € vaut le coup", merite(100, 180, false), true);
verifier("le même lot à 150 € non", merite(150, 180, false), false);

// Un chiffre dans le titre ne fait pas un lot.
for (const titre of ["Seiko 5 sports", "Montre 2 aiguilles", "Casio F-91W",
                     "Tissot Seastar cuarzo", "Montre Seiko automatique"]) {
  verifier(`pas un lot : « ${titre} »`, estLot(titre), false);
}

// --- Cote : n'entrent que les annonces sûrement identiques ------------------
// Mesuré sur une vraie annonce : la requête « Hugo Boss 1513755 chronograph »
// ramenait 96 résultats et une médiane de 100 €, alors que 2 seulement portaient
// vraiment cette référence.
const jetons = jetonsModele("Montre Seiko 5 automatique SNK809", "Seiko");
verifier("jetons du modèle", JSON.stringify(jetons), JSON.stringify(["snk809", "automatique"]));

const cand = (title, brand_title, status) => ({ title, brand_title, status });
verifier("même modèle, état voisin",
  comparable(cand("Seiko 5 SNK809 automatique", "Seiko", "Bon état"), "Seiko", jetons, "Bon état"), true);
verifier("référence absente",
  comparable(cand("Seiko 5 automatique", "Seiko", "Bon état"), "Seiko", jetons, "Bon état"), false);
verifier("autre marque",
  comparable(cand("Casio SNK809 automatique", "Casio", "Bon état"), "Seiko", jetons, "Bon état"), false);
verifier("état trop éloigné",
  comparable(cand("Seiko SNK809 automatique", "Seiko", "Neuf avec étiquette"), "Seiko", jetons, "Bon état"), false);
verifier("un lot ne cote rien",
  comparable(cand("Lot de 3 Seiko SNK809 automatique", "Seiko", "Bon état"), "Seiko", jetons, "Bon état"), false);
verifier("un bracelet non plus",
  comparable(cand("Bracelet Seiko SNK809 automatique", "Seiko", "Bon état"), "Seiko", jetons, "Bon état"), false);

verifier("bon et très bon état se comparent", etatProche("Bon état", "Très bon état"), true);
verifier("bon état et neuf sous étiquette non", etatProche("Bon état", "Neuf avec étiquette"), false);
verifier("état inconnu ne compare rien", etatProche("Bon état", "Pourri"), false);

// Une cote de marque mélange tous les modèles : on n'y alerte plus que sur les
// très grosses marges, parce que rater une grosse prise coûte bien plus cher
// qu'une alerte de trop.
verifier("80 € de marge sur cote modèle", merite(100, 180, false, true), true);
verifier("60 € de marge sur cote modèle", merite(100, 160, false, true), false);
verifier("80 € de marge sur cote marque", merite(100, 180, false, false), true);
verifier("60 € de marge sur cote marque, non", merite(100, 160, false, false), false);
verifier("220 € de marge sur cote marque", merite(100, 320, false, false), true);
// Cas réel : Tissot Pinky à 100 €, aucune autre en vente dans le même état,
// donc cote de marque à 185 € et 85 € de marge. Le seuil de 200 € la laissait
// passer sous le nez.
verifier("la Tissot Pinky passe", merite(100, 185, false, false), true);
verifier("70 € de marge sur cote marque, non", merite(100, 170, false, false), false);
// Le cas qui ne doit JAMAIS être raté : Baume & Mercier à 199 €, cote 550 €.
verifier("la grosse prise passe malgré une cote de marque", merite(199, 550, false, false), true);

verifier("article : marque", article("marque"), "de la marque");
verifier("article : modèle", article("modèle"), "du modèle");
verifier("article : lot", article("lot de 3"), "du lot de 3");

// --- Le verdict : le bénéfice à la revente ----------------------------------
verifier("marge de 70 € sur une petite montre", merite(30, 100, false), true);
verifier("marge de 70 € sur une montre chère", merite(130, 200, false), true);
verifier("marge de 50 € ne suffit plus", merite(150, 200, false), false);
// -70 % sur une montre à 40 € ne rapporte que 28 € : le pourcentage flatte, la
// marge dit la vérité.
verifier("gros pourcentage, marge ridicule", merite(12, 40, false), false);
// Garde-fou inverse : 40 € de marge sur 500 €, c'est 8 %, trop mince pour
// absorber une cote imprécise.
verifier("marge correcte, pourcentage trop mince", merite(460, 500, false), false);
verifier("marge tout juste sous le seuil", merite(101, 170, false), false);
verifier("marge tout juste au seuil", merite(100, 170, false), true);
// Sans cote exploitable, et seulement là, le petit prix suffit.
verifier("pépite sans cote sous 120 €", merite(80, null, true), true);
verifier("pépite sans cote au-dessus", merite(200, null, true), false);
verifier("sans cote et sans signal", merite(80, null, false), false);

// --- Vendeurs professionnels -------------------------------------------------
verifier("compte business écarté",
  motifDeRefus({ id: 3, title: "Montre Citizen", brand_title: "Citizen", status: "Bon état",
                 price: { amount: "40" }, user: { id: 1, business: true } }), "pro");
verifier("particulier gardé",
  motifDeRefus({ id: 3, title: "Montre Citizen", brand_title: "Citizen", status: "Bon état",
                 price: { amount: "40" }, user: { id: 1, business: false } }), "");

// --- Nouveau format de page Vinted (septembre 2026) --------------------------
// L'API /api/v2/catalog/items a disparu le 14 septembre : le bot a tourné deux
// jours et demi à vide. Les annonces se lisent désormais dans la page catalogue.
// Échantillon relevé tel quel sur le site.
const produit = {
  id: 10031358976,
  title: "Omega Seamaster Vintage Handaufzug Ref. 2759-12 SC / 2761",
  url: "/items/10031358976-omega-seamaster-vintage",
  price: { amount: "980.00", currencyCode: "EUR" },
  user: { id: 26992440, photo: null, isBusiness: false },
  photos: [{ url: "https://images1.vinted.net/t/x/f800/a.webp" }],
  itemBox: {
    firstLine: "Omega",
    secondLine: "30–38 mm · Très bon état",
    accessibilityLabel: "Omega Seamaster Vintage Handaufzug Ref. 2759-12 SC / 2761, Marque: Omega, État: Très bon état, Taille: 30–38 mm, 980.00 €, 1029.70 €",
  },
};
const lue = annonceDepuisProduit(produit);
verifier("nouveau format : id", lue.id, 10031358976);
verifier("nouveau format : marque", lue.brand_title, "Omega");
verifier("nouveau format : état", lue.status, "Très bon état");
verifier("nouveau format : prix", lue.price.amount, "980.00");
verifier("nouveau format : vendeur pro", lue.user.business, false);
verifier("nouveau format : lien absolu", lue.url, "https://www.vinted.fr/items/10031358976-omega-seamaster-vintage");
verifier("nouveau format : photo", lue.photo.url, "https://images1.vinted.net/t/x/f800/a.webp");
verifier("nouveau format : passe les filtres", motifDeRefus(lue), "");

// Un titre qui contient lui-même « Marque: » ne doit pas tromper la lecture.
const piege = annonceDepuisProduit({ ...produit, itemBox: { ...produit.itemBox,
  accessibilityLabel: "Montre, Marque: Rolex, cadeau, Marque: Tissot, État: Bon état, Taille: 40 mm, 50.00 €, 53.20 €" } });
verifier("titre piégé : la vraie marque", piege.brand_title, "Tissot");

// Sans marque renseignée, le champ reste vide au lieu de prendre la taille.
const sansMarque = annonceDepuisProduit({ ...produit, itemBox: { firstLine: "30–38 mm",
  secondLine: "30–38 mm · Bon état",
  accessibilityLabel: "Vieille montre, État: Bon état, Taille: 30–38 mm, 15.00 €, 16.40 €" } });
verifier("sans marque : champ vide", sansMarque.brand_title, "");
verifier("sans marque : état lu quand même", sansMarque.status, "Bon état");

verifier("vendeur pro reconnu", annonceDepuisProduit({ ...produit, user: { id: 1, isBusiness: true } }).user.business, true);
verifier("objet vide ignoré", annonceDepuisProduit({}), null);

verifier("adresse catalogue", rechercheUrl({ catalog_ids: "97", page: "2", order: "newest_first" }),
  "/catalog?catalog%5B%5D=97&page=2&order=newest_first");
verifier("adresse recherche", rechercheUrl({ search_text: "tissot pr100", catalog_ids: "97" }),
  "/catalog?search_text=tissot+pr100&catalog%5B%5D=97");

// --- Résumé « rien à signaler » ----------------------------------------------
const bilan = { passages: 28, nouvelles: 143, marque: 71, prix: 38, etat: 2,
                sansCote: 9, chere: 21, description: 2, alertes: 0 };
const resume = texteResume(bilan, 3600000);
verifier("durée", resume.includes("60 min"), true);
verifier("passages", resume.includes("28 passages"), true);
verifier("nouvelles", resume.includes("143 nouvelles"), true);
verifier("motif dominant en tête", resume.indexOf("71 hors horlogerie") < resume.indexOf("38 sous le prix"), true);
verifier("motif à zéro masqué", /(?:^|[^0-9])0 (?:hors|sous|état|marque|au prix|description)/.test(resume), false);

const calme = texteResume({ ...bilan, nouvelles: 0, marque: 0, prix: 0, etat: 0,
                            sansCote: 0, chere: 0, description: 0 }, 3600000);
verifier("nuit calme", calme.includes("Aucune nouvelle montre"), true);
verifier("pas de « Pourquoi » vide", calme.includes("Pourquoi"), false);

// =============================================================================
// Novembre 2026 : cote robuste, filtres dès le titre, score, Discord, fiabilité
// =============================================================================

// --- Médiane et cote robuste -------------------------------------------------
verifier("médiane impaire", mediane([3, 1, 2]), 2);
// L'ancienne version renvoyait 3 : la valeur haute, qui gonflait la cote.
verifier("médiane paire = moyenne des centrales", mediane([1, 2, 3, 4]), 2.5);
verifier("médiane vide", mediane([]), undefined);
// Une seule annonce à 300 € parmi des ~110 € ne doit pas bouger la cote.
verifier("aberration retirée par le MAD", JSON.stringify(nettoyer([100, 105, 110, 115, 120, 300])), JSON.stringify([100, 105, 110, 115, 120]));
verifier("sous cinq annonces, pas de MAD", nettoyer([100, 110, 300]).length, 3);
verifier("garde-fou ×4 conservé", nettoyer([100, 110, 120, 900]).includes(900), false);
verifier("dispersion nulle", dispersion([100, 100, 100, 100]), 0);
verifier("dispersion inconnue sous 4 annonces", dispersion([100, 200]), null);
verifier("dispersion forte", dispersion([50, 100, 200, 400]) > 0.5, true);
const coteTest = calculerCote([100, 105, 110, 115, 120, 300, NaN, 0], 3);
verifier("cote : médiane robuste", coteTest.mediane, 110);
verifier("cote : échantillon nettoyé", coteTest.echantillon, 5);
verifier("cote : échantillon trop maigre", calculerCote([100, 200], 3).mediane, null);
verifier("lissage avec l'ancienne cote", lisserCote({ mediane: 100 }, { mediane: 200 }, 0.3).mediane, 170);
verifier("pas d'ancienne cote, pas de lissage", lisserCote(null, { mediane: 200 }, 0.3).mediane, 200);
verifier("nouvelle cote nulle reste nulle", lisserCote({ mediane: 100 }, { mediane: null }, 0.3).mediane, null);

// --- Marque canonique : un seul groupe par maison ----------------------------
verifier("TISSOT = tissot", marqueCanonique("TISSOT"), "tissot");
verifier("Tissot 1853 = tissot", marqueCanonique("Tissot 1853"), "tissot");
verifier("Grand Seiko reste Grand Seiko", marqueCanonique("Grand Seiko"), "grand seiko");
verifier("Orient Star n'est pas Orient", marqueCanonique("Orient Star"), "orient star");
verifier("comparable malgré la casse de la marque",
  comparable(cand("TISSOT PRX quartz", "TISSOT", "Bon état"), "Tissot", ["prx"], "Bon état"), true);
verifier("une imitation ne cote rien",
  comparable(cand("Tissot PRX homage", "Tissot", "Bon état"), "Tissot", ["prx"], "Bon état"), false);

// --- Marque lue dans le titre quand le champ est vide ------------------------
verifier("Longines lue dans le titre", marqueDepuisTitre("Montre Longines automatique vintage"), "Longines");
verifier("Orient est ambigu", marqueDepuisTitre("Montre Orient bamboo"), "");
verifier("titre sans marque", marqueDepuisTitre("Montre homme acier"), "");
verifier("champ vide : marque du titre",
  JSON.stringify(marqueDe({ brand_title: "", title: "Hamilton Khaki Field mécanique" })),
  JSON.stringify({ marque: "Hamilton", deduite: true }));
verifier("champ « Autre » : marque du titre", marqueDe({ brand_title: "Autre", title: "Hamilton Khaki" }).marque, "Hamilton");
verifier("marque de mode : le titre ne la rachète pas", marqueDe({ brand_title: "Guess", title: "façon Hamilton" }).marque, "");
verifier("champ horloger prioritaire", JSON.stringify(marqueDe({ brand_title: "Tissot", title: "Hamilton" })),
  JSON.stringify({ marque: "Tissot", deduite: false }));
verifier("recherche toutesMarques garde la marque",
  marqueDe({ brand_title: "Seiko", title: "Seiko SKX007", recherche: { toutesMarques: true } }).marque, "Seiko");
verifier("annonce sans marque examinée",
  motifDeRefus({ id: 20, title: "Hamilton Khaki Field", brand_title: "", status: "Bon état", price: { amount: "120" } }), "");
verifier("Rolex sans marque renseignée : refusée",
  motifDeRefus({ id: 21, title: "Rolex Datejust", brand_title: "", status: "Bon état", price: { amount: "3000" } }), "fausse");

// --- Imitations repérées dès le titre ----------------------------------------
for (const titre of ["Montre style Rolex Submariner", "Homage Nautilus bleu", "Montre type Daytona noire",
                     "Réplique Royal Oak", "Montre inspirée de la Speedmaster", "Clone Submariner date",
                     "Orologio stile tipo Submariner"]) {
  verifier(`imitation : « ${titre} »`, estImitation(titre) !== "", true);
}
for (const titre of ["Montre style aviateur", "Tissot PRX 40mm", "Montre type militaire",
                     "Omega Seamaster 300", "Hamilton Khaki Field", "Montre en faux cuir"]) {
  verifier(`pas une imitation : « ${titre} »`, estImitation(titre), "");
}
verifier("imitation écartée avant toute requête",
  motifDeRefus({ id: 22, title: "Citizen hommage Submariner", brand_title: "Citizen", status: "Bon état",
                 price: { amount: "60" } }), "imitation");

// --- Boîtes : seules, ce sont des accessoires ; avec la montre, non ---------
for (const titre of ["Omega Seamaster with box", "Tissot PRX full set box papiers",
                     "Hamilton Khaki avec écrin d'origine et papiers"]) {
  verifier(`montre avec boîte : « ${titre} »`, estAccessoire(titre), titre.includes("écrin"));
}
for (const titre of ["Watch case Seiko", "Rolex boîte seule", "Hamilton boite vide",
                     "Tudor box and papers only", "Omega solo scatola", "Longines sans montre"]) {
  verifier(`sans montre : « ${titre} »`, estAccessoire(titre), true);
}

// --- Références horlogères ---------------------------------------------------
verifier("F-91W gardée entière", JSON.stringify(extraireReferences("Casio F-91W vintage").map((r) => r.compact)), JSON.stringify(["f91w"]));
verifier("calibre, taille, année, carats, rubis triés",
  JSON.stringify(extraireReferences("Seiko 7S26-0020 40mm 1995 18k 21j 200m").map((r) => r.compact)), JSON.stringify(["7s260020"]));
verifier("référence Tissot à points", extraireReferences("Tissot T120.407.17.041.00")[0].brut, "t120.407.17.041.00");
verifier("calibre seul", extraireReferences("Seiko 6139 chrono")[0].compact, "6139");
verifier("requête avec référence à tiret", requeteModele("Montre Casio F-91W", "Casio"), "Casio f-91w");
verifier("jeton compact", JSON.stringify(jetonsModele("Montre Casio F-91W", "Casio")), JSON.stringify(["f91w"]));
verifier("F 91W reconnue", titreContient("Casio F 91W retro", "f91w"), true);
verifier("F91W reconnue", titreContient("Casio F91W", "f91w"), true);
verifier("pr100 ne matche pas pr1000", titreContient("Tissot PR1000", "pr100"), false);
verifier("pr 100 matche pr100", titreContient("Tissot pr 100 quartz", "pr100"), true);
verifier("mot entier seulement", titreContient("Tissot prxx", "prx"), false);
verifier("comparable via la référence",
  comparable(cand("CASIO F 91W rétro", "Casio", "Bon état"), "Casio", ["f91w"], "Bon état"), true);

// --- Prix total (protection acheteurs) ---------------------------------------
verifier("total lu dans le libellé", prixTotalDepuisLibelle(produit.itemBox.accessibilityLabel), 1029.7);
verifier("total au format français", prixTotalDepuisLibelle("x, 1 029,70 €, 1 081,89 €"), 1081.89);
verifier("un seul prix : pas de total", prixTotalDepuisLibelle("x, 50.00 €"), null);
verifier("total dans l'annonce convertie", annonceDepuisProduit(produit).prix_total, 1029.7);

// --- Score d'affaire ---------------------------------------------------------
// La Baume & Mercier à 199 € cotée 550 € : le cas qu'on ne doit jamais rater.
const baume = scoreAffaire({ prix: 199, prixTotal: 209.65, cote: 550, niveau: "marque", echantillon: 20,
                              etat: "Bon état", vendeurNb: 1, rang: 3 });
verifier("grosse prise : urgente", baume.urgence, "urgente");
verifier("bénéfice net frais déduits", baume.margeNette, Math.round(550 - 209.65 - 6));
verifier("décote affichée sur le prix", baume.decote, 64);
const moyenne = scoreAffaire({ prix: 100, prixTotal: 105.7, cote: 175, niveau: "marque", echantillon: 10,
                                etat: "Bon état", vendeurNb: 4, rang: 300 });
verifier("petite marge sur cote de marque : normale", moyenne.urgence, "normale");
verifier("le score est la somme des composantes",
  moyenne.score, Object.values(moyenne.details).reduce((a, b) => a + b, 0));
const modele = scoreAffaire({ prix: 100, cote: 175, niveau: "modèle", echantillon: 10, etat: "Bon état", vendeurNb: 1, rang: 3 });
verifier("cote de modèle plus fiable que de marque", modele.details.fiabilite > moyenne.details.fiabilite, true);
const disperse = scoreAffaire({ prix: 100, cote: 175, niveau: "modèle", echantillon: 10, dispersion: 1.2, etat: "Bon état" });
verifier("prix comparables dispersés : fiabilité en baisse", disperse.details.fiabilite < modele.details.fiabilite, true);
verifier("score borné à 100",
  scoreAffaire({ prix: 10, cote: 5000, niveau: "modèle", echantillon: 50, etat: "Neuf avec étiquette", pepite: true, rang: 0 }).score <= 100, true);
const sansCoteScore = scoreAffaire({ prix: 80, cote: null, etat: "Bon état", pepite: true });
verifier("sans cote : ni marge ni décote", sansCoteScore.margeNette, null);
verifier("sans cote : jamais urgente", sansCoteScore.urgence, "normale");

// --- Alerte Discord ----------------------------------------------------------
const alerteBase = { id: 1, titre: "Baume & Mercier Classima", prix: 199, prixTotal: 209.65, cote: 550,
                     echantillon: 20, niveau: "marque", marque: "Baume & Mercier", etat: "Bon état",
                     description: "Très belle montre", lien: "https://www.vinted.fr/items/1", photo: "https://x/y.webp",
                     vendeurNb: 1, rang: 3 };
const urgente = corpsAlerte({ ...alerteBase, score: baume });
verifier("mention sur très grosse affaire", String(urgente.content).startsWith("@here"), true);
verifier("mention autorisée", urgente.allowed_mentions.parse.includes("everyone"), true);
verifier("grande photo", urgente.embeds[0].image.url, "https://x/y.webp");
verifier("lien direct", urgente.embeds[0].url, "https://www.vinted.fr/items/1");
verifier("score affiché", urgente.embeds[0].fields.some((f) => f.name === "Score" && f.value.includes(`${baume.score}/100`)), true);
verifier("décote affichée", urgente.embeds[0].description.includes("−64 %"), true);
verifier("cote affichée", urgente.embeds[0].fields.some((f) => f.name === "Cote" && f.value.startsWith("550")), true);
const calmeAlerte = corpsAlerte({ ...alerteBase, prix: 100, prixTotal: 105.7, cote: 175, score: moyenne });
verifier("pas de mention sur une alerte ordinaire", "content" in calmeAlerte, false);
verifier("aucune mention possible depuis la description", calmeAlerte.allowed_mentions.parse.length, 0);
const deduiteAlerte = corpsAlerte({ ...alerteBase, marqueDeduite: true, score: moyenne });
verifier("marque déduite signalée", deduiteAlerte.embeds[0].fields.some((f) => f.value.includes("lue dans le titre")), true);
const cibleAlerte = corpsAlerte({ ...alerteBase, cote: null, cible: "Tissot PRX", alerteSousPrix: 150, score: sansCoteScore });
verifier("alerte de recherche ciblée", cibleAlerte.embeds[0].description.includes("prix cible de 150 €"), true);

// --- Fiabilité : backoff et blocages ----------------------------------------
verifier("pas d'échec : intervalle normal", delaiBackoff(0, 40, 600), 40);
verifier("un échec : double", delaiBackoff(1, 40, 600), 80);
verifier("trois échecs", delaiBackoff(3, 40, 600), 320);
verifier("plafonné", delaiBackoff(8, 40, 600), 600);
verifier("jamais sous l'intervalle", delaiBackoff(2, 40, 10), 40);
verifier("429 bloquant", statutBloquant(429), true);
verifier("403 bloquant", statutBloquant(403), true);
verifier("challenge bloquant", statutBloquant("challenge"), true);
verifier("404 non bloquant", statutBloquant(404), false);

// --- Recherches ciblées ------------------------------------------------------
const recherches = [{ nom: "a" }, { nom: "b", actif: false }, { nom: "c" }];
verifier("rotation : tour 0", recherchesDuPassage(recherches, 0, 1).map((r) => r.nom).join(), "a");
verifier("rotation : tour 1", recherchesDuPassage(recherches, 1, 1).map((r) => r.nom).join(), "c");
verifier("rotation : tour 2", recherchesDuPassage(recherches, 2, 1).map((r) => r.nom).join(), "a");
verifier("désactivée ignorée", recherchesDuPassage(recherches, 0, 5).map((r) => r.nom).join(), "a,c");
verifier("aucune recherche", recherchesDuPassage([], 0, 1).length, 0);
verifier("dans la fourchette", dansFourchette({ price: { amount: "120" } }, { prixMin: 50, prixMax: 200 }), true);
verifier("trop cher", dansFourchette({ price: { amount: "250" } }, { prixMin: 50, prixMax: 200 }), false);
verifier("adresse avec fourchette",
  rechercheUrl({ search_text: "tissot prx", catalog_ids: "97", order: "newest_first", price_from: 50, price_to: 300 }),
  "/catalog?search_text=tissot+prx&catalog%5B%5D=97&order=newest_first&price_from=50&price_to=300&currency=EUR");

// --- Résumé : nouveaux motifs ------------------------------------------------
const resume2 = texteResume({ ...bilan, imitation: 4, blocages: 2 }, 3600000);
verifier("imitations dans le résumé", resume2.includes("4 imitation annoncée"), true);
verifier("blocages signalés", resume2.includes("freiné le bot 2 fois"), true);
verifier("pas de blocage, pas de ligne", resume.includes("freiné"), false);

// --- État persistant : élagage et fusion -------------------------------------
const T = 1_800_000_000_000;
const H = 3600 * 1000;
verifier("cote récente gardée", Object.keys(elaguerCotes({ a: { date: T - H }, b: { date: T - 72 * H } }, T, 48)).join(), "a");
verifier("ancien format de vendeur lu", JSON.stringify(lireVendeur(7, T)), JSON.stringify({ n: 7, vu: T }));
const vend = elaguerVendeurs({ ancien: 9, unique: { n: 1, vu: T }, oublie: { n: 8, vu: T - 40 * 24 * H }, actif: { n: 3, vu: T - H } }, T, 30);
verifier("vendeurs : oubli après la fenêtre", Object.keys(vend).sort().join(), "actif,ancien");
verifier("ancien format sous le seuil revendeur : oublié",
  Object.keys(elaguerVendeurs({ petit: 4, gros: 40 }, T, 30, 5)).join(), "gros");
const fusion = fusionnerEtats(
  { vues: ["1", "2"], cotes: { x: { date: T - 2 * H, mediane: 100 }, y: { date: T - H, mediane: 50 } },
    vendeurs: { v: { n: 5, vu: T - H } }, panne: 123, panneDebut: 100 },
  { vues: ["2", "3"], cotes: { x: { date: T - H, mediane: 120 }, y: { date: T - 3 * H, mediane: 40 } },
    vendeurs: { v: 3, w: { n: 2, vu: T } }, panne: null, panneDebut: null, bilan: { passages: 1 } },
  T
);
verifier("fusion : union des vues", fusion.vues.join(), "1,2,3");
verifier("fusion : la cote la plus récente gagne", fusion.cotes.x.mediane, 120);
verifier("fusion : même côté dépôt", fusion.cotes.y.mediane, 50);
verifier("fusion : plus grand compte vendeur", fusion.vendeurs.v.n, 5);
verifier("fusion : vendeur ajouté", fusion.vendeurs.w.n, 2);
verifier("fusion : la panne suit notre version", fusion.panne, null);
verifier("fusion : notre bilan", fusion.bilan.passages, 1);
verifier("fusion : plafond des vues",
  fusionnerEtats({ vues: Array.from({ length: 4000 }, (_, i) => `d${i}`) }, { vues: ["n1"] }, T).vues.slice(-1)[0], "n1");

// --- Preuves de la cote : fourchette et annonces comparables ----------------
const semblables = [100, 105, 110, 115, 120, 300].map((prix, i) => ({ id: 500 + i, price: { amount: String(prix) } }));
const preuves = preuvesCote(semblables, 110);
verifier("fourchette sans l'aberration", JSON.stringify(preuves.fourchette), JSON.stringify([100, 120]));
verifier("exemples les plus proches de la médiane", preuves.exemples.map((e) => e.prix).join(), "110,105,115,100");
verifier("pas de preuve sans cote", JSON.stringify(preuvesCote(semblables, null)), "{}");
verifier("montres : cote de marque autorisée", coteUtilisable({ mediane: 200, niveau: "marque" }), true);
verifier("cote de modèle toujours utilisable", coteUtilisable({ mediane: 200, niveau: "modèle" }), true);
verifier("pas de médiane, pas de cote", coteUtilisable({ mediane: null, niveau: "modèle" }), false);
const preuveTexte = texteComparables({ id: 501, fourchette: [100, 120], exemples: preuves.exemples });
verifier("fourchette affichée", preuveTexte.startsWith("Fourchette 100–120 €"), true);
verifier("liens vers les comparables", preuveTexte.includes("[110 €](https://www.vinted.fr/items/502)"), true);
verifier("l'annonce signalée n'est pas sa propre preuve", preuveTexte.includes("items/501"), false);
verifier("trois exemples au plus", (preuveTexte.match(/\]\(/g) || []).length, 3);
const avecPreuves = corpsAlerte({ ...alerteBase, niveau: "modèle", fourchette: [100, 120], exemples: preuves.exemples, score: baume });
verifier("champ « Vérifier la cote »", avecPreuves.embeds[0].fields.some((f) => f.name === "Vérifier la cote"), true);
verifier("prix demandés annoncés comme tels", avecPreuves.embeds[0].description.includes("prix demandés, pas prix vendus"), true);
verifier("sans preuve, pas de champ vide", corpsAlerte({ ...alerteBase, score: baume }).embeds[0].fields.some((f) => f.name === "Vérifier la cote"), false);

// --- Suivi des alertes : que sont-elles devenues ? -------------------------
verifier("fiche supprimée = disparue", statutSuivi({ statut: "supprimee" }), "retiree");
verifier("SoldOut = vendue", statutSuivi({ statut: "ok", disponibilite: "https://schema.org/SoldOut" }), "vendue");
verifier("OutOfStock = vendue", statutSuivi({ statut: "ok", disponibilite: "http://schema.org/OutOfStock" }), "vendue");
verifier("InStock = en vente", statutSuivi({ statut: "ok", disponibilite: "https://schema.org/InStock" }), "en vente");
verifier("sans indication = inconnu, jamais deviné", statutSuivi({ statut: "ok", disponibilite: null }), "inconnu");
verifier("Vinted freine = on retentera", statutSuivi({ statut: "indisponible" }), null);
const MAINTENANT = Date.UTC(2026, 10, 2, 20, 30); // 21 h 30 à Paris
const e1 = entreeSuivi({ id: 7, titre: "Canon AE-1", prix: 60, cote: 195, score: { score: 80 }, lien: "https://www.vinted.fr/items/7" }, MAINTENANT - 90 * 60000);
verifier("entrée de suivi : score retenu", e1.score, 80);
verifier("entrée de suivi : en attente", e1.statut, null);
const e2 = { ...e1, id: 8, date: MAINTENANT - 20 * 60000 };
const e3 = { ...e1, id: 9, statut: "vendue" };
verifier("à vérifier : assez vieille et non vérifiée", aVerifier([e1, e2, e3], MAINTENANT, 60, 2).map((e) => e.id).join(), "7");
verifier("à vérifier : plafond par passage",
  aVerifier([e1, { ...e1, id: 10 }, { ...e1, id: 11 }], MAINTENANT, 60, 2).length, 2);
verifier("récap : à 21 h 30 à Paris, pas encore envoyé", doitEnvoyerRecap(null, MAINTENANT, 21), true);
verifier("récap : déjà envoyé aujourd'hui", doitEnvoyerRecap("2026-11-02", MAINTENANT, 21), false);
verifier("récap : trop tôt", doitEnvoyerRecap(null, Date.UTC(2026, 10, 2, 15, 0), 21), false);
verifier("récap : envoyé hier, on renvoie", doitEnvoyerRecap("2026-11-01", MAINTENANT, 21), true);
const journee = [
  { ...e1, id: 1, statut: "vendue", score: 85 }, { ...e1, id: 2, statut: "retiree", score: 75 },
  { ...e1, id: 3, statut: "en vente", score: 50 }, { ...e1, id: 4, statut: "en vente", score: 40 },
  { ...e1, id: 5, statut: null, score: 60 }, { ...e1, id: 6, date: MAINTENANT - 30 * 3600000, statut: "vendue" },
];
const recap = texteRecap(journee, MAINTENANT, 60);
verifier("récap : seulement les 24 dernières heures", recap.includes("**5 alerte(s)**"), true);
verifier("récap : vendues", recap.includes("Vendues (selon la fiche) : **1**"), true);
verifier("récap : disparues", recap.includes("Disparues (vendues ou supprimées) : **1**"), true);
verifier("récap : part partie vite", recap.includes("**50 %** des alertes vérifiées"), true);
verifier("récap : score des parties contre restées", recap.includes("80/100 pour celles parties, 45/100 pour celles restées"), true);
verifier("récap : non vérifiées signalées", recap.includes("Pas encore vérifiées : 1"), true);
verifier("récap : meilleure alerte en lien", recap.includes("[Canon AE-1](https://www.vinted.fr/items/7)"), true);
verifier("récap vide", texteRecap([], MAINTENANT), "Aucune alerte envoyée ces dernières 24 h.");
verifier("suivi : 7 jours au plus", elaguerSuivi([e1, { ...e1, id: 99, date: MAINTENANT - 8 * 24 * 3600000 }], MAINTENANT).length, 1);
const fusionSuivi = fusionnerEtats({ suivi: [{ ...e1, statut: "vendue", verifieA: MAINTENANT }], dernierRecap: "2026-11-01" },
                                   { suivi: [e1, e2], dernierRecap: "2026-11-02" }, MAINTENANT);
verifier("fusion : une entrée vérifiée n'est pas écrasée", fusionSuivi.suivi.find((e) => e.id === 7).statut, "vendue");
verifier("fusion : nouvelle entrée ajoutée", fusionSuivi.suivi.length, 2);
verifier("fusion : dernier récap le plus récent", fusionSuivi.dernierRecap, "2026-11-02");

console.log(`${ok} tests passés${echecs.length ? `, ${echecs.length} ÉCHECS` : ""}`);
if (echecs.length) {
  console.error("\n" + echecs.join("\n\n"));
  process.exit(1);
}
