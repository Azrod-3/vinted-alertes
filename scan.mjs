/**
 * Veille Vinted -> Discord.
 *
 * Tourne sur GitHub Actions, donc sans machine allumee chez soi.
 *
 * Vinted protege son API par un "Client Challenge" qui exige l'execution de
 * JavaScript : une simple requete HTTP recoit une page de blocage, meme avec les
 * cookies de la page d'accueil (verifie). On passe donc par un vrai navigateur,
 * et on interroge l'API DEPUIS la page : meme origine, cookies inclus.
 *
 * Une annonce est signalee quand son prix est nettement sous la cote de sa
 * marque, cote calculee sur les annonces comparables du moment.
 */
import { chromium } from "playwright-core";
import { readFile, writeFile } from "node:fs/promises";

const CONFIG = JSON.parse(await readFile(new URL("./config.json", import.meta.url), "utf8"));
const WEBHOOK = process.env.DISCORD_WEBHOOK;
/** ESSAI=1 : on affiche les trouvailles sans rien envoyer ni rien enregistrer. */
const ESSAI = process.env.ESSAI === "1";
const ETAT = new URL("./etat.json", import.meta.url);

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

/** Etat persistant : annonces deja signalees, et cotes en cache. */
async function lireEtat() {
  try {
    return JSON.parse(await readFile(ETAT, "utf8"));
  } catch (_) {
    return { vues: [], cotes: {} };
  }
}

const prixDe = (item) =>
  item && item.price && typeof item.price === "object" ? Number(item.price.amount) : Number(item.price);

const mediane = (valeurs) => {
  const tries = [...valeurs].sort((a, b) => a - b);
  return tries[Math.floor(tries.length / 2)];
};

/** Ecarte les valeurs qui ne gravitent pas autour de la mediane (accessoires, lots). */
function nettoyer(prix) {
  if (!prix.length) return prix;
  const centre = mediane(prix);
  return prix.filter((p) => p >= centre / 4 && p <= centre * 4);
}

/** Appel de l'API Vinted depuis la page : c'est ce qui contourne le challenge. */
async function api(page, chemin) {
  return page.evaluate(async (url) => {
    const reponse = await fetch(url, { headers: { accept: "application/json" } });
    const texte = await reponse.text();
    try {
      return JSON.parse(texte);
    } catch (_) {
      return null;
    }
  }, `https://www.vinted.fr${chemin}`);
}

const rechercheUrl = (params) => `/api/v2/catalog/items?${new URLSearchParams(params)}`;

/**
 * Cote d'une marque : mediane des montres comparables en vente. Mise en cache
 * 24 h pour ne pas refaire le calcul a chaque passage.
 */
async function coteMarque(page, marque, cache) {
  const memo = cache[marque];
  if (memo && Date.now() - memo.date < 24 * 3600 * 1000) return memo;

  const reponse = await api(
    page,
    rechercheUrl({
      search_text: marque,
      catalog_ids: String(CONFIG.categorieVinted),
      per_page: "40",
    })
  );

  const prix = nettoyer(
    ((reponse && reponse.items) || []).map(prixDe).filter((p) => Number.isFinite(p) && p > 0)
  );

  if (prix.length < CONFIG.coteMinAnnonces) {
    cache[marque] = { date: Date.now(), mediane: null, echantillon: prix.length };
    return cache[marque];
  }

  const centre = mediane(prix);

  // Une marque dont les montres valent quelques euros n'a pas de "bonne
  // affaire" a offrir : -60 % sur une cote de 15 EUR ne vaut pas une alerte.
  // Ce seuil ecarte tout le bas de gamme sans avoir a le nommer.
  if (centre < CONFIG.coteMinimum) {
    cache[marque] = { date: Date.now(), mediane: null, echantillon: prix.length, coteTropBasse: centre };
    return cache[marque];
  }

  cache[marque] = { date: Date.now(), mediane: centre, echantillon: prix.length };
  return cache[marque];
}

/** Envoi d'une alerte Discord, avec la photo et le lien de l'annonce. */
async function alerter(annonce) {
  const ecart = Math.round((1 - annonce.prix / annonce.cote) * 100);
  if (ESSAI) {
    console.log(`  [essai] ${annonce.prix} € — ${ecart} % sous la cote (${annonce.cote} €) — ${annonce.marque} — ${annonce.titre.slice(0, 45)}`);
    return;
  }
  const corps = {
    embeds: [
      {
        title: annonce.titre.slice(0, 250),
        url: annonce.lien,
        color: 0x2ecc71,
        description:
          `**${annonce.prix} €** — soit **${ecart} % sous la cote** de la marque ` +
          `(médiane ${annonce.cote} € sur ${annonce.echantillon} annonces).`,
        fields: [{ name: "Marque", value: annonce.marque || "inconnue", inline: true }],
        thumbnail: annonce.photo ? { url: annonce.photo } : undefined,
        footer: { text: "Veille Vinted" },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const reponse = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corps),
  });
  if (!reponse.ok) throw new Error(`Discord a répondu ${reponse.status}`);
}

async function main() {
  if (!WEBHOOK && !ESSAI) {
    console.error("DISCORD_WEBHOOK absent : ajoute-le dans les secrets du dépôt.");
    process.exit(1);
  }

  const etat = await lireEtat();
  const vues = new Set(etat.vues || []);
  const cotes = etat.cotes || {};

  const navigateur = await chromium.launch({ channel: "chrome", headless: true });
  const page = await navigateur.newPage({ userAgent: UA, locale: "fr-FR" });

  // Charger le site d'abord : c'est ce qui resout le challenge et pose les cookies.
  await page.goto("https://www.vinted.fr/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);

  const recentes = await api(
    page,
    rechercheUrl({
      search_text: CONFIG.recherche,
      catalog_ids: String(CONFIG.categorieVinted),
      per_page: String(CONFIG.nouvellesAnnonces),
      order: "newest_first",
    })
  );

  if (!recentes || !recentes.items) {
    console.error("Vinted n'a pas répondu (challenge non franchi). Nouvelle tentative au prochain passage.");
    await navigateur.close();
    process.exit(0);
  }

  const candidates = recentes.items.filter((item) => {
    const prix = prixDe(item);
    const marque = (item.brand_title || "").trim();
    return (
      Number.isFinite(prix) &&
      prix >= CONFIG.prixMinimum &&
      marque &&
      !CONFIG.marquesIgnorees.includes(marque) &&
      !vues.has(String(item.id))
    );
  });

  console.log(`${recentes.items.length} annonces récentes, ${candidates.length} à examiner.`);

  const alertes = [];
  for (const item of candidates) {
    if (alertes.length >= CONFIG.maxAlertesParPassage) break;

    const marque = item.brand_title.trim();
    const cote = await coteMarque(page, marque, cotes);
    vues.add(String(item.id));

    if (!cote.mediane) continue;

    const prix = prixDe(item);
    if (prix / cote.mediane > CONFIG.seuilBonneAffaire) continue;

    alertes.push({
      id: item.id,
      titre: item.title || "Annonce Vinted",
      prix,
      marque,
      cote: cote.mediane,
      echantillon: cote.echantillon,
      lien: item.url || `https://www.vinted.fr/items/${item.id}`,
      photo: (item.photo && (item.photo.url || item.photo.thumbnail_url)) || "",
    });
  }

  for (const alerte of alertes) {
    try {
      await alerter(alerte);
      if (!ESSAI) console.log(`alerte envoyée : ${alerte.titre.slice(0, 40)} — ${alerte.prix} €`);
    } catch (erreur) {
      // Un envoi rate ne doit pas faire perdre le reste du passage : on retire
      // l'annonce des "vues" pour la retenter au prochain tour.
      vues.delete(String(alerte.id));
      console.error(`envoi impossible (${erreur.message}) — sera retentée.`);
    }
  }
  if (!alertes.length) console.log("aucune bonne affaire ce passage.");

  await navigateur.close();

  // On ne garde que les 2000 dernieres annonces vues : suffisant pour ne pas
  // realerter, et le fichier reste petit.
  if (!ESSAI) {
    await writeFile(ETAT, JSON.stringify({ vues: [...vues].slice(-2000), cotes }, null, 1));
  }
}

await main();
