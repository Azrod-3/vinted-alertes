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
 * Une annonce est signalee quand elle franchit quatre filtres :
 *   1. la marque est une maison d'horlogerie (liste blanche) ;
 *   2. l'etat declare est acceptable ;
 *   3. le prix est nettement sous la cote de la marque ;
 *   4. la description ne contient aucun mot redhibitoire.
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

/**
 * Comparaison tolerante : "TAG Heuer", "tag-heuer" et "Tag  Heuer" doivent se
 * reconnaitre. On enleve accents et ponctuation, on reduit les espaces.
 */
export const normaliser = (texte) =>
  String(texte || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const MARQUES = CONFIG.marquesMontres.map((m) => ` ${normaliser(m)} `);
const ETATS = new Set(CONFIG.etatsAcceptes.map(normaliser));
/** Pre-normalises et entoures d'espaces : evite que "hs" matche "shs". */
const MOTS = CONFIG.motsRedhibitoires.map((m) => ` ${normaliser(m)} `);

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

/**
 * Description de l'annonce.
 *
 * L'API /api/v2/items/<id> repond 404 et /details repond 403 (verifie) : la
 * description n'est lisible que sur la fiche publique. On recupere son HTML par
 * un fetch same-origin — sans rendu, ~500 ms — et on lit le bloc JSON-LD que
 * Vinted y depose, qui contient la description en clair.
 */
async function descriptionDe(page, url) {
  return page.evaluate(async (lien) => {
    try {
      const reponse = await fetch(lien, { headers: { accept: "text/html" } });
      if (!reponse.ok) return null;
      const html = await reponse.text();
      const bloc = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
      if (!bloc) return null;
      const donnees = JSON.parse(bloc[1]);
      return typeof donnees.description === "string" ? donnees.description : null;
    } catch (_) {
      return null;
    }
  }, url);
}

/** Une annonce est recevable si sa marque est horlogere et son etat correct. */
/**
 * Vinted laisse les vendeurs ecrire la marque librement : on trouve
 * "CASIO G-SHOCK", "Omega x Swatch" (la MoonSwatch) ou "Reloj Potens De Luxe".
 * L'egalite stricte les rejetait toutes. On cherche donc la marque comme suite
 * de mots complets — "Tell" ne matche pas "Telstar", mais "casio" matche
 * "CASIO G-SHOCK".
 */
export const marqueHorlogere = (marque) => {
  const texte = ` ${normaliser(marque)} `;
  return texte.trim() !== "" && MARQUES.some((m) => texte.includes(m));
};
export const etatAcceptable = (etat) => ETATS.has(normaliser(etat));

/**
 * Motif de refus d'une annonce avant tout calcul de cote, ou "" si elle merite
 * d'etre examinee. Les trois premiers filtres ne coutent rien ; la cote et la
 * description, elles, demandent une requete chacune.
 */
export function motifDeRefus(item, vues = new Set()) {
  if (vues.has(String(item.id))) return "deja";
  const prix = prixDe(item);
  if (!Number.isFinite(prix) || prix < CONFIG.prixMinimum) return "prix";
  // Liste blanche : seules les maisons d'horlogerie passent. Une montre de
  // marque de vetements n'a pas de cote qui veuille dire quelque chose.
  if (!marqueHorlogere(item.brand_title)) return "marque";
  if (!etatAcceptable(item.status)) return "etat";
  return "";
}

/** Premier mot redhibitoire trouve dans le texte, ou "" si tout va bien. */
export function motRedhibitoire(...textes) {
  const texte = ` ${normaliser(textes.join(" "))} `;
  for (let i = 0; i < MOTS.length; i += 1) {
    if (texte.includes(MOTS[i])) return CONFIG.motsRedhibitoires[i];
  }
  return "";
}

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
  if (centre < CONFIG.coteMinimum) {
    cache[marque] = { date: Date.now(), mediane: null, echantillon: prix.length, coteTropBasse: centre };
    return cache[marque];
  }

  cache[marque] = { date: Date.now(), mediane: centre, echantillon: prix.length };
  return cache[marque];
}

const rechercheUrl = (params) => `/api/v2/catalog/items?${new URLSearchParams(params)}`;

/** Envoi d'une alerte Discord, avec la photo, l'etat et un extrait de la description. */
async function alerter(annonce) {
  const ecart = Math.round((1 - annonce.prix / annonce.cote) * 100);
  if (ESSAI) {
    console.log(
      `  [essai] ${annonce.prix} € — ${ecart} % sous la cote (${annonce.cote} €) — ` +
        `${annonce.marque} — ${annonce.etat} — ${annonce.titre.slice(0, 45)}`
    );
    return;
  }

  const extrait = annonce.description
    ? annonce.description.replace(/\s+/g, " ").trim().slice(0, 300)
    : "_description illisible — à vérifier sur place_";

  const corps = {
    embeds: [
      {
        title: annonce.titre.slice(0, 250),
        url: annonce.lien,
        color: 0x2ecc71,
        description:
          `**${annonce.prix} €** — soit **${ecart} % sous la cote** de la marque ` +
          `(médiane ${annonce.cote} € sur ${annonce.echantillon} annonces).\n\n` +
          `> ${extrait}${annonce.description && annonce.description.length > 300 ? "…" : ""}`,
        fields: [
          { name: "Marque", value: annonce.marque || "inconnue", inline: true },
          { name: "État", value: annonce.etat || "non précisé", inline: true },
        ],
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
  const contexte = await navigateur.newContext({ userAgent: UA, locale: "fr-FR" });
  const page = await contexte.newPage();

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

  const ecarte = { deja: 0, prix: 0, marque: 0, etat: 0 };

  const candidates = recentes.items.filter((item) => {
    const refus = motifDeRefus(item, vues);
    if (refus) ecarte[refus] += 1;
    return !refus;
  });

  console.log(
    `${recentes.items.length} annonces récentes, ${candidates.length} à examiner ` +
      `(écartées : ${ecarte.deja} déjà vues, ${ecarte.marque} hors horlogerie, ` +
      `${ecarte.etat} mauvais état, ${ecarte.prix} trop bon marché).`
  );

  const alertes = [];
  for (const item of candidates) {
    if (alertes.length >= CONFIG.maxAlertesParPassage) break;

    const marque = item.brand_title.trim();
    const cote = await coteMarque(page, marque, cotes);
    vues.add(String(item.id));

    if (!cote.mediane) continue;

    const prix = prixDe(item);
    if (prix / cote.mediane > CONFIG.seuilBonneAffaire) continue;

    // La description ne se lit qu'ici : une requete par finaliste, pas par
    // annonce. A ce stade il n'en reste qu'une poignee par passage.
    const lien = item.url || `https://www.vinted.fr/items/${item.id}`;
    const description = await descriptionDe(page, lien);

    const probleme = motRedhibitoire(item.title, description || "");
    if (probleme) {
      console.log(`  écartée (« ${probleme} ») : ${item.title.slice(0, 45)} — ${prix} €`);
      continue;
    }

    alertes.push({
      id: item.id,
      titre: item.title || "Annonce Vinted",
      prix,
      marque,
      etat: item.status || "",
      description,
      cote: cote.mediane,
      echantillon: cote.echantillon,
      lien,
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

// Importe par les tests : on n'execute rien. Lance directement : on scanne.
if (process.argv[1] && process.argv[1].endsWith("scan.mjs")) await main();
