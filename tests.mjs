/** Tests des trois filtres. `npm test`. Aucun reseau, aucune dependance. */
import { normaliser, marqueHorlogere, etatAcceptable, motRedhibitoire, motifDeRefus, texteResume, estAccessoire, estLuxe, marqueInexistante, requeteModele, estPepite, merite, estLot, nombreDansLot, article, comparable, etatProche, jetonsModele } from "./scan.mjs";

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
verifier("80 € de marge sur cote marque", merite(100, 180, false, false), false);
verifier("220 € de marge sur cote marque", merite(100, 320, false, false), true);
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

console.log(`${ok} tests passés${echecs.length ? `, ${echecs.length} ÉCHECS` : ""}`);
if (echecs.length) {
  console.error("\n" + echecs.join("\n\n"));
  process.exit(1);
}
