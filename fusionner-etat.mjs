/**
 * Fusion de l'etat local et de celui du depot.
 *
 * Deux jobs qui reecrivent le meme JSON entier donnent un conflit git que
 * `rebase` ne sait pas resoudre : l'etape echoue, l'etat n'est jamais enregistre
 * et le job suivant realerte tout. Observe en vrai — une meme annonce envoyee
 * sept fois.
 *
 * On ne demande donc plus a git de fusionner : on repart de la version du depot
 * et on y verse la notre. L'union des annonces vues est la bonne operation, il
 * n'y a rien a arbitrer.
 */
import { readFile, writeFile } from "node:fs/promises";

const PLAFOND = 4000;
const [local, cible] = process.argv.slice(2);

const lire = async (chemin) => {
  try {
    return JSON.parse(await readFile(chemin, "utf8"));
  } catch (_) {
    return { vues: [], cotes: {}, bilan: null };
  }
};

const nous = await lire(local);
const depot = await lire(cible);

// Les nôtres en dernier : ce sont les plus recentes, et le plafond coupe par le debut.
const vues = [...new Set([...(depot.vues || []), ...(nous.vues || [])])].slice(-PLAFOND);
const cotes = { ...(depot.cotes || {}), ...(nous.cotes || {}) };

// Comptage des montres par vendeur : on garde le plus grand des deux, jamais la
// somme — deux jobs qui ont vu la meme annonce la compteraient deux fois.
const vendeurs = { ...(depot.vendeurs || {}) };
for (const [id, n] of Object.entries(nous.vendeurs || {})) {
  vendeurs[id] = Math.max(vendeurs[id] || 0, n);
}

await writeFile(cible, JSON.stringify({ vues, cotes, vendeurs, bilan: nous.bilan || depot.bilan }, null, 1));
console.log(`état fusionné : ${vues.length} annonces mémorisées, ${Object.keys(cotes).length} cotes`);
