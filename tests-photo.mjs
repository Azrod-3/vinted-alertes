/**
 * Tests de la veille appareils photo : le meme moteur, lance avec
 * CONFIG_FICHIER=config-photo.json (voir `npm test`). Aucun reseau.
 */
if (process.env.CONFIG_FICHIER !== "config-photo.json") {
  console.error("À lancer avec CONFIG_FICHIER=config-photo.json (npm test le fait).");
  process.exit(1);
}
const { motifDeRefus, motRedhibitoire, requeteModele, marqueDe, estAccessoire, estImitation, texteResume, corpsAlerte, scoreAffaire, coteUtilisable } = await import("./scan.mjs");

let ok = 0;
const echecs = [];
const verifier = (nom, obtenu, attendu) => {
  if (String(obtenu) === String(attendu)) ok += 1;
  else echecs.push(`${nom}\n    attendu : ${attendu}\n    obtenu  : ${obtenu}`);
};
const annonce = (title, brand_title, prix = 150, status = "Très bon état") =>
  ({ id: Math.random(), title, brand_title, status, price: { amount: String(prix) } });

// --- Ce qui doit être examiné ------------------------------------------------
for (const [titre, marque, prix] of [
  ["Canon AE-1 Program 50mm", "Canon", 150],
  ["Boîtier Nikon D750", "Nikon", 600],
  ["Fujifilm X100V avec boîte", "Fujifilm", 900],
  ["Olympus Mju II", "", 120],
  ["Contax T2", "Autre", 400],
  ["Canon EOS 600D + objectif 18-55", "Canon", 250],
]) {
  verifier(`examiné : « ${titre} »`, motifDeRefus(annonce(titre, marque, prix)), "");
}

// --- Ce qui doit être écarté avant toute requête -----------------------------
for (const [titre, marque, prix, motif] of [
  ["Sangle Canon", "Canon", 15, "accessoire"],
  ["Batterie Sony NP-FW50", "Sony", 20, "accessoire"],
  ["Pellicule Kodak Portra 400", "Kodak", 15, "accessoire"],
  ["Chargeur pour Nikon", "Nikon", 12, "accessoire"],
  ["Housse appareil photo", "Autre", 12, "marque"],
  ["Appareil photo factice déco", "Canon", 30, "imitation"],
  ["Leica M6", "Leica", 90, "fausse"],
  ["Leica M6", "", 1500, "fausse"],
  ["Appareil Guess rose", "Guess", 30, "marque"],
  ["2 appareils photo Kodak", "Kodak", 30, "lot"],
]) {
  verifier(`écarté (${motif}) : « ${titre} »`, motifDeRefus(annonce(titre, marque, prix)), motif);
}
// Un « boîtier seul » est un appareil vendu sans objectif : parfaitement valable.
verifier("boîtier seul accepté", motRedhibitoire("Boîtier seul, fonctionne parfaitement"), "");
verifier("boîtier en tête de titre accepté", estAccessoire("Boîtier Canon EOS 5D"), false);
verifier("« with box » n'est pas un accessoire", estAccessoire("Sony A7 III with box"), false);
verifier("pas d'imitation sur un vrai titre", estImitation("Nikon FM2 chrome"), "");

// --- Description : défauts propres à la photo --------------------------------
for (const [texte, mot] of [
  ["Léger champignon dans l'objectif", "champignon"],
  ["Obturateur bloqué", "obturateur bloque"],
  ["Ne s'allume plus", "ne s allume plus"],
  ["Non testé, vendu en l'état", "vendu en l etat"],
  ["Jamais testé faute de pile", "jamais teste"],
  ["Lens error au démarrage", "lens error"],
  ["Un peu de buée sur la lentille", "buee"],
]) {
  verifier(`défaut photo : « ${texte} »`, motRedhibitoire(texte), mot);
}
for (const texte of ["Objectif sans champignon ni buée, fonctionne", "Aucune moisissure, très propre",
                     "Testé avec une pellicule, photos nettes"]) {
  verifier(`sain : « ${texte} »`, motRedhibitoire(texte), "");
}

// --- Requête de cote ---------------------------------------------------------
verifier("référence à tiret", requeteModele("Canon AE-1 Program 50mm", "Canon"), "Canon ae-1 program");
verifier("plage de zoom ignorée", requeteModele("Canon EOS 600D + objectif 18-55", "Canon"), "Canon 600d eos");
verifier("boîtier ignoré", requeteModele("Boîtier Nikon D750", "Nikon"), "Nikon d750");
verifier("marque lue dans le titre", marqueDe({ brand_title: "", title: "Olympus Mju II" }).marque, "Olympus");
verifier("nom ambigu non lu", marqueDe({ brand_title: "", title: "Horizon 202 panoramique" }).marque, "");

// --- Messages ----------------------------------------------------------------
const calme = texteResume({ passages: 3, nouvelles: 0, alertes: 0 }, 3600000);
verifier("résumé parle d'appareils", calme.includes("Aucun nouvel appareil photo"), true);
const s = scoreAffaire({ prix: 120, cote: 400, niveau: "modèle", echantillon: 8, etat: "Très bon état" });
const corps = corpsAlerte({ id: 1, titre: "Contax T2", prix: 120, cote: 400, echantillon: 8, niveau: "modèle",
                            marque: "Contax", etat: "Très bon état", description: "", lien: "https://www.vinted.fr/items/1",
                            photo: "", pepite: true, score: s });
verifier("pied de message photo", corps.embeds[0].footer.text.startsWith("Veille Vinted · Photo"), true);
verifier("signal pépite au bon nom", corps.embeds[0].fields.some((f) => f.value.startsWith("appareil de collection")), true);

// --- Cote : modèle exact uniquement ------------------------------------------
// « Canon 111 € » mélange compacts et reflex : jamais d'alerte sur cette base.
verifier("photo : cote de marque refusée", coteUtilisable({ mediane: 111, niveau: "marque" }), false);
verifier("photo : cote de lot refusée", coteUtilisable({ mediane: 300, niveau: "lot de 2" }), false);
verifier("photo : cote de modèle acceptée", coteUtilisable({ mediane: 195, niveau: "modèle" }), true);

console.log(`${ok} tests photo passés${echecs.length ? `, ${echecs.length} ÉCHECS` : ""}`);
if (echecs.length) {
  console.error("\n" + echecs.join("\n\n"));
  process.exit(1);
}
