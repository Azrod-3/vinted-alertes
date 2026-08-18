/** Tests des trois filtres. `npm test`. Aucun reseau, aucune dependance. */
import { normaliser, marqueHorlogere, etatAcceptable, motRedhibitoire, motifDeRefus, texteResume } from "./scan.mjs";

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
verifier("trop bon marché", motifDeRefus(annonce({ price: { amount: "8.0" } })), "prix");
verifier("prix illisible", motifDeRefus(annonce({ price: null })), "prix");
verifier("marque hors horlogerie", motifDeRefus(annonce({ brand_title: "Guess" })), "marque");
verifier("marque vide", motifDeRefus(annonce({ brand_title: "" })), "marque");
verifier("état satisfaisant", motifDeRefus(annonce({ status: "Satisfaisant" })), "etat");
verifier("MoonSwatch acceptée", motifDeRefus(annonce({ brand_title: "Omega x Swatch" })), "");
verifier("CASIO G-SHOCK acceptée", motifDeRefus(annonce({ brand_title: "CASIO G-SHOCK" })), "");

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
