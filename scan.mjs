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
const ACCESSOIRES = new Set(CONFIG.motsAccessoire.map(normaliser));
const ACCESSOIRES_PARTOUT = CONFIG.motsAccessoireTitre.map((m) => ` ${normaliser(m)} `);
const LUXE = CONFIG.marquesLuxe.map((m) => ` ${normaliser(m)} `);
const PEPITE_MARQUES = CONFIG.marquesPepite.map((m) => ` ${normaliser(m)} `);
const PEPITE_SIGNAUX = CONFIG.signauxPepite.map((m) => ` ${normaliser(m)} `);
const MOTS_VIDES = new Set(CONFIG.motsVides.map(normaliser));
const MOTS_LOT = CONFIG.motsLot.map((m) => ` ${normaliser(m)} `);
/** "2 Orologi Swatch", "3 montres" : un lot, compare a tort a une montre seule. */
const LOT_CHIFFRE = /(^|\s)([2-9]|\d{2})\s+(orologi|montres|relojes|uhren|watches|orologio)/;
const PAS_LUXE = CONFIG.marquesLuxeExceptions.map((m) => ` ${normaliser(m)} `);

/** Compteurs du tunnel, remis a zero a chaque resume envoye. */
const nouveauBilan = () => ({
  depuis: Date.now(),
  passages: 0,
  nouvelles: 0,
  marque: 0,
  etat: 0,
  prix: 0,
  accessoire: 0,
  lot: 0,
  fausse: 0,
  pro: 0,
  vendeurSpecialise: 0,
  sansCote: 0,
  chere: 0,
  description: 0,
  alertes: 0,
});

/** Etat persistant : annonces deja signalees, cotes en cache, bilan en cours. */
async function lireEtat() {
  try {
    return JSON.parse(await readFile(ETAT, "utf8"));
  } catch (_) {
    return { vues: [], cotes: {}, bilan: nouveauBilan() };
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
  if (estAccessoire(item.title)) return "accessoire";
  if (estLot(item.title)) return "lot";
  if (estLuxe(item.brand_title) && prix < CONFIG.prixMinimumLuxe) return "fausse";
  // Un professionnel vend au prix du marche, jamais en dessous : 9 % des
  // annonces, autant de calculs de cote economises.
  if (CONFIG.exclureVendeursPros && item.user && item.user.business) return "pro";
  return "";
}

/**
 * Une annonce d'accessoire l'annonce des le premier mot du titre : "Bracelet de
 * montre Seiko", "Cinturino Casio", "Ecrin 12 montres". On ne regarde que ce
 * premier mot — chercher "bracelet" n'importe ou recalerait "Montre Seiko
 * bracelet cuir", qui est une vraie montre.
 *
 * Ce filtre ne servait a rien tant que le prix plancher etait a 20 EUR ; il
 * devient indispensable en dessous, ou la categorie se remplit d'accessoires.
 */
export const estAccessoire = (titre) => {
  const propre = normaliser(titre);
  if (ACCESSOIRES.has(propre.split(" ")[0])) return true;
  // Quelques mots ne designent que des pieces detachees ou qu'ils soient :
  // "Zenith museum maglie" a 10 EUR, ce sont des maillons, pas une montre.
  return ACCESSOIRES_PARTOUT.some((m) => ` ${propre} `.includes(m));
};

/**
 * Une Omega a 50 EUR n'est pas une bonne affaire, c'est une contrefacon — ou un
 * bracelet vendu sous le nom de la marque. Sur ces maisons, en dessous d'un
 * certain prix il n'y a rien d'authentique, et le calcul de cote ne fait
 * qu'amplifier l'illusion : plus la marque est chere, plus la fausse parait etre
 * une affaire. Observe en vrai : Omega 50 EUR, Tudor 145 EUR, Zenith 110 EUR.
 */
export const estLuxe = (marque) => {
  const texte = ` ${normaliser(marque)} `;
  // La MoonSwatch porte "Omega" dans son libelle : c'est une Swatch a ~270 EUR,
  // pas une Omega. L'exception passe avant.
  if (PAS_LUXE.some((m) => texte.includes(m))) return false;
  return LUXE.some((m) => texte.includes(m));
};

/**
 * Requete de cote au niveau du MODELE.
 *
 * La cote de marque est la plus grosse fuite de pepites : toutes les Seiko
 * partagent la meme mediane, donc une Seiko 5 qui en vaut 180 affichee a 70
 * passe pour surevaluee. On reconstruit donc une requete a partir du titre —
 * marque plus les deux mots qui portent vraiment l'information — et on mesure
 * la cote sur ces annonces-la.
 *
 * Les references chiffrees sont prioritaires : "SNK809" identifie un modele
 * mieux que n'importe quel adjectif.
 */
export function requeteModele(titre, marque) {
  const mots = normaliser(titre)
    .split(" ")
    // Les diametres et les annees ne designent pas un modele : "40mm", "1970".
    .filter((m) => m.length >= 2 && !MOTS_VIDES.has(m) && !/^\d{1,2}$/.test(m) && !/^\d{1,3}(mm|cm)$/.test(m));

  const marqueMots = new Set(normaliser(marque).split(" "));
  const restants = mots.filter((m) => !marqueMots.has(m));

  // Une reference (des chiffres colles a des lettres, ou 3+ chiffres) vaut plus
  // que tout le reste : "6139", "SNK809", "PR516".
  const references = restants.filter((m) => /\d/.test(m) && !/^\d{1,2}(mm|cm)?$/.test(m));
  // Trois lettres suffisent : PRX, GMT, SKX sont des modeles entiers.
  const autres = restants.filter((m) => !references.includes(m) && m.length >= 3);

  const choisis = [...references, ...autres].slice(0, 2);
  if (!choisis.length) return "";
  return `${String(marque || "").trim()} ${choisis.join(" ")}`.trim();
}

/**
 * Une montre de niche : maison que le grand public ne connait pas mais dont les
 * modeles se negocient cher, ou signal de valeur dans le texte (un mouvement
 * Valjoux, un Kon-Tiki, un cadran gilt). Le vendeur qui ecrit "Valjoux" sans
 * savoir ce que c'est vend souvent tres en dessous.
 */
export function estPepite(titre, description, marque) {
  const texte = ` ${normaliser([titre, description].join(" "))} `;
  if (PEPITE_SIGNAUX.some((m) => texte.includes(m))) return true;
  const nom = ` ${normaliser(marque)} `;
  return PEPITE_MARQUES.some((m) => nom.includes(m));
}

/**
 * Un lot de plusieurs montres compare a la mediane d'une seule paraitra toujours
 * une affaire : "2 Orologi Swatch" a 60 EUR contre une cote de 130 EUR.
 */
export function estLot(titre) {
  const propre = normaliser(titre);
  if (LOT_CHIFFRE.test(propre)) return true;
  return MOTS_LOT.some((m) => ` ${propre} `.includes(m));
}

/**
 * Le verdict, isole pour etre testable : cette annonce merite-t-elle une alerte ?
 *
 * La regle du petit prix ne s'applique QUE sans cote exploitable. Sans cette
 * condition, une Citizen a 110 EUR cotee 164 EUR passait pour une pepite au seul
 * motif qu'elle valait moins de 120 EUR — signalee a -33 % alors que le seuil
 * pepite est a -50 %.
 */
export function merite(prix, cote, pepite) {
  if (cote) {
    // Ce qui compte, c'est le benefice a la revente, pas le pourcentage : -70 %
    // sur une montre a 40 EUR ne rapporte que 28 EUR et ne vaut pas le
    // deplacement, la ou -35 % sur une montre a 200 EUR en rapporte 70.
    if (cote - prix < CONFIG.margeMinimum) return false;
    // Garde-fou : une marge de 40 EUR sur une montre a 500 EUR n'est que 8 %,
    // trop mince pour absorber une cote imprecise.
    const seuil = pepite ? CONFIG.seuilPepite : CONFIG.seuilBonneAffaire;
    return prix / cote <= seuil;
  }
  return pepite && prix <= CONFIG.pepitePrixMax;
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
/**
 * Cote d'un modele precis. Repli silencieux sur la marque quand l'echantillon
 * est trop maigre : mieux vaut une cote large qu'une cote fausse tiree de deux
 * annonces.
 */
async function coteModele(page, requete, cache) {
  const cle = `modele:${requete}`;
  const memo = cache[cle];
  if (memo && Date.now() - memo.date < 24 * 3600 * 1000) return memo;

  const reponse = await api(
    page,
    rechercheUrl({ search_text: requete, catalog_ids: String(CONFIG.categorieVinted), per_page: "40" })
  );
  const prix = nettoyer(
    ((reponse && reponse.items) || []).map(prixDe).filter((p) => Number.isFinite(p) && p > 0)
  );

  cache[cle] =
    prix.length >= CONFIG.coteMinAnnoncesModele
      ? { date: Date.now(), mediane: mediane(prix), echantillon: prix.length, niveau: "modèle" }
      : { date: Date.now(), mediane: null, echantillon: prix.length, niveau: "modèle" };
  return cache[cle];
}

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
  const ecart = annonce.cote ? Math.round((1 - annonce.prix / annonce.cote) * 100) : 0;
  if (ESSAI) {
    console.log(
      `  [essai]${annonce.pepite ? " 💎" : "  "} ${String(annonce.prix).padStart(4)} € — ` +
        (annonce.cote
          ? `+${String(Math.round(annonce.cote - annonce.prix)).padStart(3)} € de marge (cote ${annonce.niveau} ${annonce.cote} €, −${ecart} %)`
          : "sans cote") +
        ` — ${annonce.marque} — ${annonce.titre.slice(0, 45)}`
    );
    return;
  }

  const extrait = annonce.description
    ? annonce.description.replace(/\s+/g, " ").trim().slice(0, 300)
    : "_description illisible — à vérifier sur place_";

  const corps = {
    embeds: [
      {
        title: `${annonce.pepite ? "💎 " : ""}${annonce.titre.slice(0, 240)}`,
        url: annonce.lien,
        color: annonce.pepite ? 0x9b59b6 : 0x2ecc71,
        description:
          (annonce.cote
            ? `**${annonce.prix} €** — cote du ${annonce.niveau} : **${annonce.cote} €** ` +
              `(médiane sur ${annonce.echantillon} annonces).\n` +
              `**Bénéfice à la revente : ~${Math.round(annonce.cote - annonce.prix)} €** (−${ecart} %).\n\n`
            : `**${annonce.prix} €** — pièce de collection, aucune cote fiable à ce jour.\n\n`) +
          `> ${extrait}${annonce.description && annonce.description.length > 300 ? "…" : ""}`,
        fields: [
          { name: "Marque", value: annonce.marque || "inconnue", inline: true },
          { name: "État", value: annonce.etat || "non précisé", inline: true },
          ...(annonce.pepite ? [{ name: "Signal", value: "montre de collection", inline: true }] : []),
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

/** Le texte du resume : le tunnel en une phrase, motifs du plus gros au plus petit. */
export function texteResume(bilan, ecoule) {
  const duree = Math.round(ecoule / 60000);
  const motifs = [
    [bilan.marque, "hors horlogerie"],
    [bilan.prix, "sous le prix plancher"],
    [bilan.etat, "état insuffisant"],
    [bilan.accessoire, "accessoire, pas une montre"],
    [bilan.lot, "lot de plusieurs montres"],
    [bilan.fausse, "luxe à prix impossible"],
    [bilan.pro, "vendeur professionnel"],
    [bilan.vendeurSpecialise, "revendeur de montres"],
    [bilan.sansCote, "marque sans cote fiable"],
    [bilan.chere, "au prix du marché"],
    [bilan.description, "description rédhibitoire"],
  ]
    .filter(([n]) => n > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([n, mot]) => `${n} ${mot}`);

  return (
    `Aucune bonne affaire depuis **${duree} min** ` +
    `(${bilan.passages} passages, ${bilan.nouvelles} nouvelles annonces).\n\n` +
    (bilan.nouvelles === 0
      ? "Aucune nouvelle montre n'a été publiée sur cette période."
      : `**Pourquoi :** ${motifs.join(" · ")}.`)
  );
}

/**
 * Resume periodique : un message quand il ne s'est rien passe, qui dit en
 * quelques mots POURQUOI. Sans lui, le silence est ambigu — rien d'interessant
 * et "Vinted nous bloque" se ressemblent exactement.
 *
 * Envoye au plus une fois par `resumeSiRienMinutes`, et jamais quand des
 * alertes sont deja parties : elles prouvent d'elles-memes que ca tourne.
 */
async function resumer(bilan) {
  const ecoule = Date.now() - bilan.depuis;
  if (ecoule < CONFIG.resumeSiRienMinutes * 60000) return false;
  if (bilan.alertes > 0 || ESSAI) return true; // on repart a zero, sans message

  const corps = {
    embeds: [
      {
        title: "Rien à signaler",
        color: 0x95a5a6,
        description: texteResume(bilan, ecoule),
        footer: { text: "Veille Vinted" },
        timestamp: new Date().toISOString(),
      },
    ],
  };
  const duree = Math.round(ecoule / 60000);

  try {
    const reponse = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corps),
    });
    if (!reponse.ok) throw new Error(`Discord a répondu ${reponse.status}`);
    console.log(`résumé envoyé : rien depuis ${duree} min`);
  } catch (erreur) {
    console.error(`résumé non envoyé (${erreur.message})`);
    return false; // on garde le bilan, il repartira au prochain job
  }
  return true;
}

/** Un passage : on relit les nouveautes et on alerte sur ce qui merite. */
async function unPassage(page, vues, cotes, bilan, vendeurs) {
  // Une seule recherche ne voit qu'un sixieme du marche : mesure faite, "montre"
  // rapporte 96 annonces la ou les huit recherches en rapportent 570 distinctes.
  // "montre ancienne" a elle seule apporte 90 annonces invisibles autrement.
  const trouvees = new Map();
  for (const mot of CONFIG.recherches) {
    const r = await api(
      page,
      rechercheUrl({
        search_text: mot,
        catalog_ids: String(CONFIG.categorieVinted),
        per_page: String(CONFIG.nouvellesAnnonces),
        order: "newest_first",
      })
    );
    for (const item of (r && r.items) || []) trouvees.set(item.id, item);
  }

  if (!trouvees.size) {
    console.error("Vinted n'a pas répondu (challenge non franchi).");
    return false;
  }

  bilan.passages += 1;

  const candidates = [];
  for (const item of trouvees.values()) {
    const refus = motifDeRefus(item, vues);
    if (refus === "deja") continue;
    // Memorisee des maintenant, quel que soit le sort : sans cela une annonce
    // recalee sur la marque serait recomptee a chaque passage, et le resume
    // annoncerait trois fois le nombre reel de nouveautes.
    vues.add(String(item.id));
    bilan.nouvelles += 1;

    // Combien de montres DIFFERENTES ce vendeur a-t-il publiees ? L'API ignore
    // le filtre user_id (verifie : elle renvoie les memes 96 articles pour tout
    // le monde), mais on peut compter soi-meme, sans une seule requete de plus.
    // Chaque annonce n'est comptee qu'une fois, puisqu'on ne passe ici que pour
    // les nouvelles.
    const vendeur = item.user && item.user.id ? String(item.user.id) : "";
    if (vendeur) vendeurs[vendeur] = (vendeurs[vendeur] || 0) + 1;

    if (refus) bilan[refus] += 1;
    else if (vendeur && vendeurs[vendeur] > CONFIG.vendeurMaxMontres) bilan.vendeurSpecialise += 1;
    else candidates.push(item);
  }

  const alertes = [];
  for (const item of candidates) {
    if (alertes.length >= CONFIG.maxAlertesParPassage) break;

    const marque = item.brand_title.trim();
    const prix = prixDe(item);

    // Cote du modele d'abord : c'est elle qui revele les pepites. La cote de
    // marque ne sert que de repli quand l'echantillon est trop maigre.
    // La cote de marque est en cache et ne coute rien ; celle du modele demande
    // une requete par modele distinct. On ne la calcule donc que si l'annonce
    // n'est pas manifestement hors de prix — sans quoi chaque passage
    // interrogerait Vinted trois cents fois.
    let cote = await coteMarque(page, marque, cotes);
    const vautLeDetour = !cote.mediane || prix / cote.mediane <= CONFIG.ratioAvantCoteModele;

    if (vautLeDetour) {
      const requete = requeteModele(item.title, marque);
      const precise = requete ? await coteModele(page, requete, cotes) : null;
      if (precise && precise.mediane) cote = precise;
    }

    // Une montre de niche merite qu'on lise sa description avant de la juger :
    // le signal de valeur y est souvent, pas dans le titre.
    const pepiteTitre = estPepite(item.title, "", marque);

    if (!cote.mediane && !pepiteTitre) {
      bilan.sansCote += 1;
      continue;
    }

    if (!merite(prix, cote.mediane, pepiteTitre)) {
      bilan.chere += 1;
      continue;
    }

    // La description ne se lit qu'ici : une requete par finaliste, pas par
    // annonce. A ce stade il n'en reste qu'une poignee.
    const lien = item.url || `https://www.vinted.fr/items/${item.id}`;
    const description = await descriptionDe(page, lien);

    const probleme = motRedhibitoire(item.title, description || "");
    if (probleme) {
      bilan.description += 1;
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
      niveau: cote.niveau || "marque",
      pepite: estPepite(item.title, description || "", marque),
      lien,
      photo: (item.photo && (item.photo.url || item.photo.thumbnail_url)) || "",
    });
  }

  for (const alerte of alertes) {
    try {
      await alerter(alerte);
      bilan.alertes += 1;
      if (!ESSAI) console.log(`alerte envoyée : ${alerte.titre.slice(0, 40)} — ${alerte.prix} €`);
    } catch (erreur) {
      // Un envoi rate ne doit pas faire perdre le reste du passage : on retire
      // l'annonce des "vues" pour la retenter au prochain tour.
      vues.delete(String(alerte.id));
      console.error(`envoi impossible (${erreur.message}) — sera retentée.`);
    }
  }
  return true;
}

/**
 * Un job GitHub coute 40 s de mise en route (installation de Chrome) pour 8 s de
 * scan. Lancer le workflow plus souvent revient donc a payer surtout de
 * l'attente. On boucle plutot DANS le job, en gardant le meme navigateur et la
 * meme session Vinted : le delai entre deux relevés tombe a l'intervalle choisi
 * au lieu de la periode du cron.
 */
async function main() {
  if (!WEBHOOK && !ESSAI) {
    console.error("DISCORD_WEBHOOK absent : ajoute-le dans les secrets du dépôt.");
    process.exit(1);
  }

  const etat = await lireEtat();
  const vues = new Set(etat.vues || []);
  const cotes = etat.cotes || {};
  const bilan = { ...nouveauBilan(), ...(etat.bilan || {}) };
  const vendeurs = etat.vendeurs || {};

  const navigateur = await chromium.launch({ channel: "chrome", headless: true });
  const contexte = await navigateur.newContext({ userAgent: UA, locale: "fr-FR" });
  const page = await contexte.newPage();

  // Charger le site d'abord : c'est ce qui resout le challenge et pose les
  // cookies. Fait une seule fois pour toute la boucle.
  await page.goto("https://www.vinted.fr/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);

  const fin = Date.now() + CONFIG.bouclerSecondes * 1000;
  const avant = { ...bilan };
  let passages = 0;

  while (true) {
    passages += 1;
    const ok = await unPassage(page, vues, cotes, bilan, vendeurs);
    if (!ok && passages === 1) break; // challenge non franchi : inutile d'insister
    if (Date.now() + CONFIG.intervalleSecondes * 1000 >= fin) break;
    await page.waitForTimeout(CONFIG.intervalleSecondes * 1000);
  }

  console.log(
    `${passages} passages en ${Math.round((CONFIG.bouclerSecondes * 1000 - (fin - Date.now())) / 1000)} s : ` +
      `${bilan.nouvelles - avant.nouvelles} nouvelles annonces, ` +
      `${bilan.alertes - avant.alertes} alerte(s).`
  );

  await navigateur.close();

  const remis = await resumer(bilan);

  if (!ESSAI) {
    await writeFile(
      ETAT,
      JSON.stringify(
        {
          vues: [...vues].slice(-4000),
          cotes,
          vendeurs: Object.fromEntries(Object.entries(vendeurs).filter(([, n]) => n > 1)),
          bilan: remis ? nouveauBilan() : bilan,
        },
        null,
        1
      )
    );
  }
}

if (process.argv[1] && process.argv[1].endsWith("scan.mjs")) await main();
