/**
 * Fusion de l'etat local et de celui du depot.
 *
 * Deux jobs qui reecrivent le meme JSON entier donnent un conflit git que
 * `rebase` ne sait pas resoudre : l'etape echoue, l'etat n'est jamais enregistre
 * et le job suivant realerte tout. Observe en vrai — une meme annonce envoyee
 * sept fois.
 *
 * On ne demande donc plus a git de fusionner : on repart de la version du depot
 * et on y verse la notre. Les regles (union des vues, cote la plus recente,
 * elagage) vivent dans etat.mjs, partage avec le scan et teste.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fusionnerEtats } from "./etat.mjs";

const [local, cible] = process.argv.slice(2);

const lire = async (chemin) => {
  try {
    return JSON.parse(await readFile(chemin, "utf8"));
  } catch (_) {
    return { vues: [], cotes: {}, bilan: null };
  }
};

// La config n'est lue que pour les durees de conservation ; illisible, on garde
// les valeurs par defaut plutot que de faire echouer l'enregistrement.
let options = {};
try {
  const config = JSON.parse(
    await readFile(new URL(`./${process.env.CONFIG_FICHIER || "config.json"}`, import.meta.url), "utf8")
  );
  options = {
    coteHeures: config.coteConserverHeures,
    vendeurJours: config.vendeurFenetreJours,
    seuilAncien: config.vendeurMaxMontres,
  };
} catch (_) {}

const fusion = fusionnerEtats(await lire(cible), await lire(local), Date.now(), options);
await writeFile(cible, JSON.stringify(fusion, null, 1));
console.log(`état fusionné : ${fusion.vues.length} annonces mémorisées, ${Object.keys(fusion.cotes).length} cotes`);
