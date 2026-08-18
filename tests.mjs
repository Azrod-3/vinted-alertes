/** Tests des trois filtres. `npm test`. Aucun reseau, aucune dependance. */
import { normaliser, marqueHorlogere, etatAcceptable, motRedhibitoire, motifDeRefus, texteResume, estAccessoire, estLuxe } from "./scan.mjs";

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
for (const marque of ["Seiko", "TAG Heuer", "tag-heuer", "G-Shock", "Festina", "Vostok", "Mühle-Glashütte",
                      // Marques ecrites librement par les vendeurs : la marque
                      // doit se reconnaitre au milieu du libelle.
                      "CASIO G-SHOCK", "Omega x Swatch", "Reloj Potens De Luxe Automático 25 Joyas",
                      "Breil", "Candino", "Invicta", "Philip Watch"]) {
  verifier(`marque acceptée : ${marque}`, marqueHorlogere(marque), true);
}
// Marques de mode qui font faire leurs montres sous licence : refusees.
for (const marque of ["Guess", "Emporio Armani", "Michael Kors", "Diesel", "Hugo Boss", "Lacoste",
                      "Calvin Klein", "Tommy Hilfiger", "Zara", "Shein", "Vespa", "Jeep",
                      "Apple", "Samsung", "Huawei", "Fitbit", "SKMEI", "Curren", "", "Autre",
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
const annonce = (extra) => ({ id: 1, title: "Montre", brand_title: "Seiko",
  status: "Très bon état", price: { amount: "80.0" }, ...extra });

verifier("annonce valide", motifDeRefus(annonce({})), "");
verifier("déjà vue", motifDeRefus(annonce({}), new Set(["1"])), "deja");
verifier("trop bon marché", motifDeRefus(annonce({ price: { amount: "3.0" } })), "prix");
verifier("15 € accepté depuis le nouveau plancher", motifDeRefus(annonce({ price: { amount: "15.0" } })), "");
verifier("prix illisible", motifDeRefus(annonce({ price: null })), "prix");
verifier("marque hors horlogerie", motifDeRefus(annonce({ brand_title: "Guess" })), "marque");
verifier("marque vide", motifDeRefus(annonce({ brand_title: "" })), "marque");
verifier("état satisfaisant", motifDeRefus(annonce({ status: "Satisfaisant" })), "etat");
verifier("MoonSwatch acceptée", motifDeRefus(annonce({ brand_title: "Omega x Swatch" })), "");
verifier("CASIO G-SHOCK acceptée", motifDeRefus(annonce({ brand_title: "CASIO G-SHOCK" })), "");

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
  motifDeRefus({ id: 9, title: "Bracelet Seiko", brand_title: "Seiko",
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
                     "Depliant pubblicitario orologi"]) {
  verifier(`objet pour montre : « ${titre} »`, estAccessoire(titre), true);
}
// Piège : "tag" est dans "TAG Heuer". Ce mot seul ne doit jamais bloquer.
for (const titre of ["TAG Heuer Monaco", "Tag Heuer Formula 1", "Montre TAG Heuer"]) {
  verifier(`TAG Heuer intacte : « ${titre} »`, estAccessoire(titre), false);
}
verifier("Universal Genève est du luxe", estLuxe("Universal Genève"), true);

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
verifier("Seiko à 45 € intacte",
  motifDeRefus({ id: 7, title: "Montre Seiko automatique", brand_title: "Seiko",
                 status: "Bon état", price: { amount: "45" } }), "");
verifier("Seiko n'est pas du luxe", estLuxe("Seiko"), false);
verifier("Grand Seiko l'est", estLuxe("Grand Seiko"), true);
verifier("MoonSwatch n'est pas une Omega", estLuxe("Omega x Swatch"), false);

// --- Accessoires en allemand -------------------------------------------------
for (const titre of ["Uhrenbox Vintage Hamilton Bakelit", "Lederband Glashütte",
                     "Uhrenarmband Leder 20mm", "Ersatzteile Uhr"]) {
  verifier(`accessoire allemand : « ${titre} »`, estAccessoire(titre), true);
}

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
