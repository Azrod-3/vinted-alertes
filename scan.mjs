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
 *   1. la marque est une maison d'horlogerie (liste blanche, ou lue dans le
 *      titre quand le vendeur ne l'a pas renseignee) ;
 *   2. l'etat declare est acceptable, et le titre ne trahit ni accessoire, ni
 *      lot, ni imitation ;
 *   3. le prix est nettement sous la cote du modele (ou de la marque) ;
 *   4. la description ne contient aucun mot redhibitoire.
 * Chaque alerte recoit ensuite un score d'affaire sur 100 qui fixe son urgence.
 */
import { chromium } from "playwright-core";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { elaguerCotes, elaguerVendeurs, lireVendeur, PLAFOND_VUES } from "./etat.mjs";

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
const AMBIGUS = CONFIG.motsAmbigus.map((m) => ` ${normaliser(m)} `);
const NEGATIONS = CONFIG.negations.map(normaliser);
/** Assez large pour couvrir "il n'y a aucune", assez court pour ne pas deriver. */
const FENETRE_NEGATION = 16;
const ACCESSOIRES = new Set(CONFIG.motsAccessoire.map(normaliser));
/** Du pire au meilleur : deux etats voisins restent comparables, pas trois. */
const ECHELLE_ETAT = ["satisfaisant", "bon etat", "tres bon etat", "neuf sans etiquette", "neuf avec etiquette"];
const ACCESSOIRES_PARTOUT = CONFIG.motsAccessoireTitre.map((m) => ` ${normaliser(m)} `);
const LUXE = CONFIG.marquesLuxe.map((m) => ` ${normaliser(m)} `);
const PEPITE_MARQUES = CONFIG.marquesPepite.map((m) => ` ${normaliser(m)} `);
const PEPITE_SIGNAUX = CONFIG.signauxPepite.map((m) => ` ${normaliser(m)} `);
const MOTS_VIDES = new Set(CONFIG.motsVides.map(normaliser));
const MOTS_LOT = CONFIG.motsLot.map((m) => ` ${normaliser(m)} `);
/** "2 Orologi Swatch", "3 montres" : un lot, a ne jamais comparer a une seule. */
const LOT_CHIFFRE = /(^|\s)([2-9]|\d{2})\s+(orologi|montres|relojes|uhren|watches|orologio)/;
/** "lot de 3", "lotto di 5", "set di 4" : le nombre suit le mot. */
const LOT_COMPTE = /(?:lot|lotto|lote|set|konvolut|stock|blocco|paquet)\s+(?:de\s+|di\s+|of\s+|von\s+)?(\d{1,2})(?!\d)/;
const PAS_LUXE = CONFIG.marquesLuxeExceptions.map((m) => ` ${normaliser(m)} `);
const INEXISTANTES = CONFIG.marquesInexistantes.map((m) => ` ${normaliser(m)} `);
/** Les reglages ajoutes en novembre 2026 ont tous une valeur par defaut. */
const liste = (cle) => (CONFIG[cle] || []).map(normaliser).filter(Boolean);
/** Les plus longues d'abord : "grand seiko" doit gagner sur un eventuel "seiko". */
const MARQUES_CANON = [...new Set(CONFIG.marquesMontres.map(normaliser))].sort((a, b) => b.length - a.length);
const GENERIQUES = new Set(liste("marquesGeneriques"));
const AMBIGUES = new Set(liste("marquesTitreAmbigues"));
const IMITATIONS = liste("motsImitation").map((m) => ` ${m} `);
const EMBALLAGES = liste("motsEmballage").map((m) => ` ${m} `);
const AVEC_MONTRE = liste("indicesMontreAvecEmballage").map((m) => ` ${m} `);
const echapper = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** "style rolex", "type daytona", "homage de nautilus" : le prefixe suivi d'une cible. */
const IMITATION_CIBLEE = (() => {
  const prefixes = liste("prefixesImitation").map(echapper);
  const cibles = [...liste("marquesLuxe"), ...liste("modelesIconiques")].map(echapper);
  if (!prefixes.length || !cibles.length) return null;
  return new RegExp(` (?:${prefixes.join("|")})(?: (?:a|de|d|du|des|by|to|di|von))? (?:${cibles.join("|")}) `);
})();

/**
 * Enregistrement de l'etat en cours de route.
 *
 * Un job dure cinq heures : n'enregistrer qu'a la fin ferait tout reperdre a la
 * moindre interruption, et laisserait le job voisin realerter ce qu'on vient
 * d'envoyer. La manoeuvre git est confiee au script dedie, partage avec l'etape
 * finale du workflow, qui refuse de tourner hors d'un runner.
 */
function enregistrerEnRoute() {
  return new Promise((resolve) => {
    execFile("./enregistrer-etat.sh", { timeout: 60000 }, (erreur, sortie) => {
      if (erreur) console.error(`enregistrement impossible : ${erreur.message}`);
      else if (String(sortie).trim()) console.log(String(sortie).trim());
      resolve();
    });
  });
}

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
  imitation: 0,
  pro: 0,
  vendeurSpecialise: 0,
  sansCote: 0,
  chere: 0,
  description: 0,
  scoreFaible: 0,
  blocages: 0,
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

export const prixDe = (item) =>
  item && item.price && typeof item.price === "object" ? Number(item.price.amount) : Number(item.price);

/** Ligne de journal horodatee : dans un job de cinq heures, l'heure compte. */
const heure = () => new Date().toISOString().slice(11, 19);
const journal = (...m) => console.log(heure(), ...m);
const erreurJournal = (...m) => console.error(heure(), ...m);
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Vraie mediane. L'ancienne version prenait la valeur HAUTE des deux centrales
 * sur un nombre pair d'annonces : avec 4 a 8 annonces, cas courant au niveau du
 * modele, la cote etait gonflee, et la decote affichee avec elle.
 */
export const mediane = (valeurs) => {
  const tries = [...valeurs].sort((a, b) => a - b);
  if (!tries.length) return undefined;
  const m = Math.floor(tries.length / 2);
  return tries.length % 2 ? tries[m] : (tries[m - 1] + tries[m]) / 2;
};

/**
 * Ecarte les valeurs qui ne gravitent pas autour de la mediane (accessoires,
 * lots), puis, des cinq annonces, les aberrations par l'ecart absolu median
 * (MAD) : une seule annonce a 900 EUR parmi des 150 EUR ne doit pas bouger la
 * cote. Le facteur 1,4826 rend le MAD comparable a un ecart-type.
 */
export function nettoyer(prix) {
  if (!prix.length) return prix;
  const centre = mediane(prix);
  const larges = prix.filter((p) => p >= centre / 4 && p <= centre * 4);
  if (larges.length < 5) return larges;
  const c = mediane(larges);
  const mad = mediane(larges.map((p) => Math.abs(p - c)));
  if (!mad) return larges;
  const k = CONFIG.coteSeuilMAD ?? 3;
  return larges.filter((p) => Math.abs(p - c) <= k * 1.4826 * mad);
}

/**
 * Dispersion relative : ecart interquartile rapporte a la mediane. 0,2 = les
 * prix se tiennent, 1 = ils partent dans tous les sens et la cote ne vaut pas
 * grand-chose. Null sous quatre annonces : on ne sait pas.
 */
export function dispersion(prix) {
  if (prix.length < 4) return null;
  const t = [...prix].sort((a, b) => a - b);
  const quantile = (f) => t[Math.round(f * (t.length - 1))];
  const centre = mediane(t);
  return centre ? Math.round(((quantile(0.75) - quantile(0.25)) / centre) * 100) / 100 : null;
}

/**
 * Cote rafraichie : on garde une part de l'ancienne. Un releve de 40 annonces
 * est un instantane bruite ; lisser evite qu'une cote saute de 30 % d'un jour a
 * l'autre parce que trois annonces cheres sont arrivees.
 */
export function lisserCote(ancienne, nouvelle, poids = CONFIG.coteLissage ?? 0.3) {
  if (!nouvelle || !nouvelle.mediane) return nouvelle;
  if (!ancienne || !ancienne.mediane || !(poids > 0)) return nouvelle;
  return { ...nouvelle, mediane: Math.round((1 - poids) * nouvelle.mediane + poids * ancienne.mediane), lissee: true };
}

/**
 * Garde-fou partage par toutes les requetes : des qu'une reponse trahit un
 * blocage (403, 429, page de challenge), le passage s'arrete au lieu d'enchainer
 * les requetes de cote. Insister est le meilleur moyen de faire bannir l'IP.
 */
const garde = { bloque: false, dernierStatut: 0, requetes: 0 };
export const statutBloquant = (statut) => statut === 403 || statut === 429 || statut === "challenge";
/**
 * Espacement minimal entre deux requetes Vinted (`pauseEntreRequetesMs`). Avant,
 * les requetes de cote d'un passage partaient en rafale, sans pause ni plafond.
 */
let dernierAppel = 0;
async function espacer() {
  const reste = dernierAppel + (CONFIG.pauseEntreRequetesMs ?? 600) - Date.now();
  if (reste > 0) await attendre(reste);
  dernierAppel = Date.now();
}
function noterStatut(statut) {
  garde.dernierStatut = statut;
  garde.requetes += 1;
  if (statutBloquant(statut)) garde.bloque = true;
}

/**
 * Delai avant le prochain passage : l'intervalle normal, double a chaque echec
 * consecutif, plafonne. Jamais en dessous de l'intervalle configure.
 */
export function delaiBackoff(echecs, intervalle, plafond) {
  if (!echecs) return intervalle;
  return Math.max(intervalle, Math.min(plafond, intervalle * 2 ** Math.min(echecs, 6)));
}

/**
 * Description de l'annonce.
 *
 * L'API /api/v2/items/<id> repond 404 et /details repond 403 (verifie) : la
 * description n'est lisible que sur la fiche publique. On recupere son HTML par
 * un fetch same-origin — sans rendu, ~500 ms — et on lit le bloc JSON-LD que
 * Vinted y depose, qui contient la description en clair.
 */
/**
 * Renvoie { statut, description } :
 *   - "ok" : description lue (eventuellement vide) ;
 *   - "supprimee" : 404/410, ou vraie fiche sans bloc JSON-LD ;
 *   - "indisponible" : blocage, erreur reseau ou page de challenge.
 * La distinction est capitale : avant, les trois cas renvoyaient null et une
 * vraie affaire tombee pendant un 429 etait jetee comme « introuvable », pour
 * toujours puisque deja marquee vue.
 */
async function descriptionDe(page, url) {
  let r;
  await espacer();
  try {
    r = await page.evaluate(async (lien) => {
      try {
        const reponse = await fetch(lien, { headers: { accept: "text/html" } });
        if (reponse.status === 404 || reponse.status === 410) return { statut: reponse.status, etat: "supprimee" };
        if (!reponse.ok) return { statut: reponse.status, etat: "indisponible" };
        const html = await reponse.text();
        const bloc = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
        if (!bloc) {
          // Une vraie fiche Next.js sans JSON-LD : annonce retiree. Sinon c'est
          // une page de challenge, et on ne sait rien.
          return html.includes("__next_f")
            ? { statut: 200, etat: "supprimee" }
            : { statut: "challenge", etat: "indisponible" };
        }
        const donnees = JSON.parse(bloc[1]);
        return { statut: 200, etat: "ok", description: typeof donnees.description === "string" ? donnees.description : "" };
      } catch (_) {
        return { statut: 0, etat: "indisponible" };
      }
    }, url);
  } catch (erreur) {
    r = { statut: 0, etat: "indisponible" };
  }
  noterStatut(r.statut);
  return { statut: r.etat, description: r.description ?? null };
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
 * La maison reconnue dans un libelle, sous une forme unique : "TISSOT",
 * "Tissot 1853" et "tissot" donnent tous "tissot". Sans cela la cote de marque
 * etait calculee par libelle brut, et une "Tissot 1853" n'etait jamais comparee
 * a une "Tissot". Hors liste blanche, le libelle normalise tel quel.
 */
export const marqueCanonique = (marque) => {
  const texte = ` ${normaliser(marque)} `;
  return MARQUES_CANON.find((m) => texte.includes(` ${m} `)) || normaliser(marque);
};

/**
 * Le champ marque est vide sur un quart des annonces — le profil type du
 * vendeur qui ignore ce qu'il vend. On cherche alors une maison de la liste
 * blanche dans le titre, en ecartant les noms qui sont aussi des mots courants
 * (Orient, Lotus, Jaguar, Ball…) : une "montre Jaguar" est souvent un objet
 * publicitaire de la voiture.
 */
export function marqueDepuisTitre(titre) {
  const texte = ` ${normaliser(titre)} `;
  const trouvee = MARQUES_CANON.find((m) => m.length >= 3 && !AMBIGUES.has(m) && texte.includes(` ${m} `));
  return trouvee ? CONFIG.marquesMontres.find((orig) => normaliser(orig) === trouvee) || trouvee : "";
}

/** Libelle de marque qui ne dit rien : vide, "Autre", "Vintage", "Sans marque"… */
export const marqueGenerique = (marque) => !normaliser(marque) || GENERIQUES.has(normaliser(marque));

/**
 * La marque a retenir pour une annonce : celle du champ si elle est horlogere,
 * sinon celle du titre quand le champ est generique. Une recherche ciblee
 * `toutesMarques` garde la marque du vendeur telle quelle.
 */
export function marqueDe(item) {
  const brute = String((item && item.brand_title) || "").trim();
  if (marqueHorlogere(brute)) return { marque: brute, deduite: false };
  if (item && item.recherche && item.recherche.toutesMarques && brute) return { marque: brute, deduite: false };
  if (CONFIG.marqueDepuisTitre && marqueGenerique(brute)) {
    const titre = marqueDepuisTitre(item && item.title);
    if (titre) return { marque: titre, deduite: true };
  }
  return { marque: "", deduite: false };
}

/**
 * Imitation annoncee des le titre : "homage", "réplique", "clone", ou un
 * prefixe suivi d'une maison ou d'un modele iconique ("style Rolex", "type
 * Submariner", "homage Nautilus"). Avant, ces mots n'etaient cherches qu'apres
 * le calcul de cote et la lecture de la description : deux requetes perdues, et
 * seul "style rolex" etait couvert. Renvoie le motif trouve, ou "".
 */
export function estImitation(titre) {
  const texte = ` ${normaliser(titre)} `;
  const mot = IMITATIONS.find((m) => texte.includes(m));
  if (mot) return mot.trim();
  const cible = IMITATION_CIBLEE && texte.match(IMITATION_CIBLEE);
  return cible ? cible[0].trim() : "";
}

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
  const { marque, deduite } = marqueDe(item);
  if (!marque) return "marque";
  if (!etatAcceptable(item.status)) return "etat";
  if (estAccessoire(item.title)) return "accessoire";
  if (estImitation(item.title)) return "imitation";
  // Un lot est accepte quand son nombre de montres est annonce : on peut alors
  // le valoriser. Sans chiffre, on ignore ce qu'on achete.
  if (estLot(item.title) && !(CONFIG.accepterLots && nombreDansLot(item.title))) return "lot";
  if (marqueInexistante(marque) || marqueInexistante(item.brand_title)) return "fausse";
  if (estLuxe(marque) && prix < CONFIG.prixMinimumLuxe) return "fausse";
  // Une Rolex vendue sans marque renseignee est presque toujours une copie : le
  // vrai proprietaire remplit le champ. On ne prend pas le risque par defaut.
  if (deduite && estLuxe(marque) && !CONFIG.marqueTitreLuxe) return "fausse";
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
  const texte = ` ${propre} `;
  if (ACCESSOIRES_PARTOUT.some((m) => texte.includes(m))) return true;
  // "box", "case", "scatola" ou qu'ils soient designaient un accessoire, ce qui
  // jetait "Omega Seamaster with box" ou "Tissot PRX full set box". L'emballage
  // n'est plus un accessoire quand le titre dit qu'il accompagne la montre.
  return EMBALLAGES.some((m) => texte.includes(m)) && !AVEC_MONTRE.some((m) => texte.includes(m));
};

/**
 * Une Omega a 50 EUR n'est pas une bonne affaire, c'est une contrefacon — ou un
 * bracelet vendu sous le nom de la marque. Sur ces maisons, en dessous d'un
 * certain prix il n'y a rien d'authentique, et le calcul de cote ne fait
 * qu'amplifier l'illusion : plus la marque est chere, plus la fausse parait etre
 * une affaire. Observe en vrai : Omega 50 EUR, Tudor 145 EUR, Zenith 110 EUR.
 */
/**
 * Marques a refuser quel que soit le prix.
 *
 * Deux familles s'y trouvent : les collaborations inventees — Swatch n'a jamais
 * travaille avec Audemars Piguet, une "Swatch x AP" a 100 EUR est une
 * contrefacon que Vinted supprime en quelques minutes — et les vraies
 * collaborations Swatch, ecartees avec la marque elle-meme : leur libelle porte
 * "Omega" ou "Blancpain", qui les faisait passer par la bande.
 */
export const marqueInexistante = (marque) => {
  const texte = ` ${normaliser(marque)} `;
  return INEXISTANTES.some((m) => texte.includes(m));
};

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
/**
 * References horlogeres d'un titre, lues AVANT normalisation : "F-91W",
 * "7S26-0020", "T120.407", "SNK809", "6139". La normalisation coupait
 * "F-91W" en "f" et "91w", et "T120.407" en deux morceaux sans valeur.
 *
 * Chaque reference a deux formes : `brut`, pour la recherche Vinted, et
 * `compact` (sans tiret ni point), pour reconnaitre "F91W", "F-91W" et
 * "F 91W" comme la meme montre.
 *
 * Ne sont pas des references : diametres et etancheites ("40mm", "200m",
 * "10atm"), annees ("1970"), carats ("18k"), rubis ("21j"), petits nombres.
 */
export function extraireReferences(titre) {
  const brut = String(titre || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const vues = new Set();
  const sortie = [];
  for (const [jeton] of brut.matchAll(/[a-z0-9]+(?:[-./][a-z0-9]+)*/g)) {
    const compact = jeton.replace(/[-./]/g, "");
    if (!/\d/.test(compact)) continue;
    if (/^\d{1,2}$/.test(compact)) continue;
    if (/^\d{1,4}(mm|cm|m|atm|bar|ft)$/.test(compact)) continue;
    if (/^(19[2-9]\d|20[0-2]\d)$/.test(compact)) continue;
    if (/^\d{1,2}(k|kt|ct|j|jewels|rubis|rubini)$/.test(compact)) continue;
    if (/^\d+(eur|e|euros?)$/.test(compact)) continue;
    if (vues.has(compact)) continue;
    vues.add(compact);
    sortie.push({ brut: jeton, compact });
  }
  return sortie;
}

/**
 * Le coeur commun de requeteModele et jetonsModele : les deux mots porteurs,
 * references d'abord, sous leur forme de recherche et sous leur forme de
 * comparaison.
 */
function analyseModele(titre, marque) {
  const marqueMots = new Set(normaliser(marque).split(" "));
  // Une reference (des chiffres colles a des lettres, ou 3+ chiffres) vaut plus
  // que tout le reste : "6139", "SNK809", "PR516".
  const references = extraireReferences(titre).filter((r) => !marqueMots.has(r.compact));
  // Les diametres et les annees ne designent pas un modele : "40mm", "1970".
  // Trois lettres suffisent : PRX, GMT, SKX sont des modeles entiers.
  const autres = normaliser(titre)
    .split(" ")
    .filter((m) => m.length >= 3 && !/\d/.test(m) && !MOTS_VIDES.has(m) && !marqueMots.has(m));
  const choisis = [
    ...references.map((r) => ({ recherche: r.brut, jeton: r.compact })),
    ...[...new Set(autres)].map((m) => ({ recherche: m, jeton: m })),
  ].slice(0, 2);
  return choisis;
}

export function requeteModele(titre, marque) {
  const choisis = analyseModele(titre, marque);
  if (!choisis.length) return "";
  return `${String(marque || "").trim()} ${choisis.map((c) => c.recherche).join(" ")}`.trim();
}

/** Les mots qui doivent se retrouver dans une annonce pour qu'elle compte. */
export function jetonsModele(titre, marque) {
  return analyseModele(titre, marque).map((c) => c.jeton);
}

/**
 * Le titre contient-il ce jeton ? Soit comme mot entier, soit, pour une
 * reference, en recollant deux ou trois mots voisins : "F 91W" et "T120 407"
 * doivent reconnaitre "f91w" et "t120407". Jamais en sous-chaine : "pr100" ne
 * doit pas matcher "pr1000".
 */
export function titreContient(titre, jeton) {
  const mots = normaliser(titre).split(" ").filter(Boolean);
  if (mots.includes(jeton)) return true;
  if (!/\d/.test(jeton)) return false;
  for (let i = 0; i < mots.length; i += 1) {
    if (mots[i] + (mots[i + 1] || "") === jeton) return true;
    if (mots[i] + (mots[i + 1] || "") + (mots[i + 2] || "") === jeton) return true;
  }
  return false;
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
 * Combien de montres dans ce lot ? Zero si ce n'est pas un lot, ou si le nombre
 * n'est pas annonce — un "Konvolut Uhren" sans chiffre est invendable a
 * l'aveugle, on ne sait pas ce qu'on achete.
 */
export function nombreDansLot(titre) {
  const propre = normaliser(titre);
  const parMot = propre.match(LOT_COMPTE);
  const parChiffre = propre.match(LOT_CHIFFRE);
  const n = Number((parMot && parMot[1]) || (parChiffre && parChiffre[2]) || 0);
  return n >= 2 && n <= CONFIG.lotMaxMontres ? n : 0;
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
export function merite(prix, cote, pepite, precise = true) {
  if (cote) {
    // Ce qui compte, c'est le benefice a la revente, pas le pourcentage : -70 %
    // sur une montre a 40 EUR ne rapporte que 28 EUR et ne vaut pas le
    // deplacement, la ou -35 % sur une montre a 200 EUR en rapporte 70.
    //
    // Quand la cote ne vaut que pour la MARQUE, elle melange tous les modeles et
    // se trompe largement : c'est de la que venaient les alertes mediocres. On
    // n'y alerte donc plus que sur les tres grosses marges — rater une Baume &
    // Mercier a 199 EUR cotee 550 coute infiniment plus cher qu'une alerte de
    // trop, alors qu'une marge de 40 EUR mal estimee ne rapporte rien.
    if (cote - prix < (precise ? CONFIG.margeMinimum : CONFIG.margeMinimumMarque)) return false;
    // Garde-fou : une marge de 40 EUR sur une montre a 500 EUR n'est que 8 %,
    // trop mince pour absorber une cote imprecise.
    const seuil = pepite ? CONFIG.seuilPepite : CONFIG.seuilBonneAffaire;
    return prix / cote <= seuil;
  }
  return pepite && prix <= CONFIG.pepitePrixMax;
}

export const niveauEtat = (etat) => ECHELLE_ETAT.indexOf(normaliser(etat));

/** Une neuve sous etiquette et une "satisfaisant" ne se comparent pas. */
export function etatProche(a, b) {
  const x = niveauEtat(a);
  const y = niveauEtat(b);
  if (x < 0 || y < 0) return false;
  return Math.abs(x - y) <= 1;
}

/**
 * Cette annonce peut-elle servir a coter celle qu'on examine ?
 *
 * Une recherche texte Vinted ramene tout ce qui ressemble vaguement : sur
 * "Seiko 5 sports" on recupere des Seiko quelconques, et la mediane ne veut plus
 * rien dire. On exige donc la meme marque, tous les mots du modele presents dans
 * le titre, un etat voisin — et ni lot ni accessoire, qui tirent la mediane vers
 * le bas et vers le haut respectivement.
 */
export function comparable(candidat, marque, jetons, etat) {
  if (!candidat || !candidat.title) return false;
  // Marque canonique : "TISSOT" et "Tissot 1853" cotent une "Tissot".
  if (marqueCanonique(candidat.brand_title) !== marqueCanonique(marque)) return false;
  if (estLot(candidat.title) || estAccessoire(candidat.title) || estImitation(candidat.title)) return false;
  if (etat && !etatProche(etat, candidat.status)) return false;
  return jetons.every((jeton) => titreContient(candidat.title, jeton));
}

/** Premier mot redhibitoire trouve dans le texte, ou "" si tout va bien. */
export function motRedhibitoire(...textes) {
  const texte = ` ${normaliser(textes.join(" "))} `;
  for (let i = 0; i < MOTS.length; i += 1) {
    if (texte.includes(MOTS[i])) return CONFIG.motsRedhibitoires[i];
  }

  // Ces defauts-la sont reels, mais le mot sert aussi a dire qu'ils sont
  // absents : "verre plexiglas fissure" disqualifie, "aucune fissure" non. On
  // regarde donc les quelques caracteres qui precedent chaque occurrence.
  for (let i = 0; i < AMBIGUS.length; i += 1) {
    let depuis = 0;
    for (;;) {
      const trouve = texte.indexOf(AMBIGUS[i], depuis);
      if (trouve < 0) break;
      const avant = texte.slice(Math.max(0, trouve - FENETRE_NEGATION), trouve + 1);
      const nie = NEGATIONS.some((n) => avant.includes(` ${n} `));
      if (!nie) return CONFIG.motsAmbigus[i];
      depuis = trouve + 1;
    }
  }
  return "";
}

/**
 * Cote tiree d'une liste de prix : mediane robuste, taille de l'echantillon,
 * dispersion. Isolee pour etre testable ; null si l'echantillon est trop maigre.
 */
export function calculerCote(prixBruts, minimum) {
  const prix = nettoyer(prixBruts.filter((p) => Number.isFinite(p) && p > 0));
  if (prix.length < minimum) return { mediane: null, echantillon: prix.length, dispersion: null };
  return { mediane: Math.round(mediane(prix)), echantillon: prix.length, dispersion: dispersion(prix) };
}

const COTE_VALIDE_MS = 24 * 3600 * 1000;

/**
 * Cote d'un modele precis. Repli silencieux sur la marque quand l'echantillon
 * est trop maigre : mieux vaut une cote large qu'une cote fausse tiree de deux
 * annonces. Mise en cache 24 h.
 *
 * Une requete bloquee ne met RIEN en cache : avant, un 429 enregistrait "pas de
 * cote" pour 24 h, et le modele restait invisible toute la journee.
 */
async function coteModele(page, requete, jetons, marque, etat, cache) {
  // L'etat fait partie de la cle : la meme requete donne une cote differente
  // selon qu'on cherche des neuves ou des montres portees.
  const cle = `modele:${normaliser(requete)}|${niveauEtat(etat)}`;
  const memo = cache[cle];
  if (memo && Date.now() - memo.date < COTE_VALIDE_MS) return memo;

  const reponse = await catalogue(
    page,
    rechercheUrl({ search_text: requete, catalog_ids: String(CONFIG.categorieVinted) })
  );
  if (!reponse) return { mediane: null, echantillon: 0, niveau: "modèle", indisponible: true };
  // On ne garde que les annonces dont on est sur qu'il s'agit du meme modele,
  // dans un etat voisin : sans ce tri, la mediane melange tout ce que Vinted
  // juge vaguement ressemblant.
  const cote = calculerCote(
    reponse.items.filter((c) => comparable(c, marque, jetons, etat)).map(prixDe),
    CONFIG.coteMinAnnoncesModele
  );
  cache[cle] = lisserCote(memo, { date: Date.now(), ...cote, niveau: "modèle" });
  return cache[cle];
}

/**
 * Cote d'une marque : mediane des montres comparables en vente. Cle de cache
 * canonique : "TISSOT", "Tissot" et "Tissot 1853" partagent la meme.
 */
async function coteMarque(page, marque, cache) {
  const canon = marqueCanonique(marque);
  const cle = `marque:${canon}`;
  const memo = cache[cle];
  if (memo && Date.now() - memo.date < COTE_VALIDE_MS) return memo;

  const reponse = await catalogue(
    page,
    rechercheUrl({ search_text: marque, catalog_ids: String(CONFIG.categorieVinted) })
  );
  if (!reponse) return { mediane: null, echantillon: 0, indisponible: true };

  // Meme pour une cote de marque, un lot, un bracelet ou une copie n'a rien a y faire.
  const cote = calculerCote(
    reponse.items
      .filter((c) => c && c.title && !estLot(c.title) && !estAccessoire(c.title) && !estImitation(c.title))
      .filter((c) => marqueCanonique(c.brand_title) === canon)
      .map(prixDe),
    CONFIG.coteMinAnnonces
  );

  // Une marque dont les montres valent quelques euros n'a pas de "bonne
  // affaire" a offrir : -60 % sur une cote de 15 EUR ne vaut pas une alerte.
  if (cote.mediane && cote.mediane < CONFIG.coteMinimum) {
    cache[cle] = { date: Date.now(), mediane: null, echantillon: cote.echantillon, coteTropBasse: cote.mediane };
    return cache[cle];
  }
  cache[cle] = lisserCote(memo, { date: Date.now(), ...cote, niveau: "marque" });
  return cache[cle];
}

/**
 * Adresse d'une page de catalogue.
 *
 * Le 14 septembre 2026, Vinted a retire /api/v2/catalog/items (404, verifie
 * depuis un poste ordinaire : ce n'est pas un blocage anti-robot) et sert
 * desormais ses resultats directement dans la page /catalog. Les parametres
 * changent de nom en consequence ; per_page n'existe plus, une page fait ~96
 * annonces.
 */
export function rechercheUrl(params) {
  const q = new URLSearchParams();
  if (params.search_text) q.set("search_text", params.search_text);
  if (params.catalog_ids) q.append("catalog[]", params.catalog_ids);
  if (params.page) q.set("page", params.page);
  if (params.order) q.set("order", params.order);
  // Fourchette de prix des recherches ciblees. Parametres de l'adresse web de
  // Vinted, non reverifies depuis le changement de septembre : le scan refiltre
  // donc lui-meme les prix (motifDeRefus), pour ne pas dependre de leur effet.
  if (params.price_from) q.set("price_from", params.price_from);
  if (params.price_to) q.set("price_to", params.price_to);
  if (params.price_from || params.price_to) q.set("currency", "EUR");
  return `/catalog?${q}`;
}

/**
 * Prix total paye par l'acheteur, lu a la fin du libelle d'accessibilite :
 * "…, 980.00 €, 1029.70 €" — le second inclut la protection acheteurs. Null
 * quand il n'y a qu'un prix. Accepte "1 029,70 €" au cas ou le format changerait.
 */
export function prixTotalDepuisLibelle(libelle) {
  const montants = [...String(libelle || "").matchAll(/(\d[\d\s\u00a0\u202f]*(?:[.,]\d{1,2})?)\s*€/g)]
    .map((m) => Number(m[1].replace(/[\s\u00a0\u202f]/g, "").replace(",", ".")))
    .filter(Number.isFinite);
  if (montants.length < 2) return null;
  const total = montants[montants.length - 1];
  return total >= montants[montants.length - 2] ? total : null;
}

const ETATS_CONNUS = ["Neuf avec étiquette", "Neuf sans étiquette", "Très bon état", "Bon état", "Satisfaisant"];

/**
 * Convertit une annonce du nouveau format de page vers la forme de l'ancienne
 * API, que tout le reste du scan attend. La marque et l'etat n'ont plus de champ
 * propre : ils sont dans itemBox. On lit le libelle d'accessibilite
 * ("titre, Marque: X, État: Y, Taille: Z, prix") en partant de la fin, pour
 * qu'un titre contenant lui-meme "Marque:" ne trompe pas la lecture.
 */
export function annonceDepuisProduit(p) {
  if (!p || !p.id) return null;
  const boite = p.itemBox || {};
  const libelle = String(boite.accessibilityLabel || "");

  const champ = (nom) => {
    const i = libelle.lastIndexOf(`, ${nom}: `);
    if (i < 0) return "";
    const reste = libelle.slice(i + nom.length + 4);
    const fin = reste.indexOf(", ");
    return (fin < 0 ? reste : reste.slice(0, fin)).trim();
  };

  let etat = champ("État");
  if (!ETATS_CONNUS.includes(etat)) {
    const dernier = String(boite.secondLine || "").split(" · ").pop().trim();
    etat = ETATS_CONNUS.includes(dernier) ? dernier : etat;
  }

  const photo = (p.photos && p.photos[0] && p.photos[0].url) || p.thumbnailUrl || "";
  const url = String(p.url || "");
  return {
    id: p.id,
    title: p.title || "",
    url: url.startsWith("http") ? url : `https://www.vinted.fr${url}`,
    price: { amount: p.price && p.price.amount },
    prix_total: prixTotalDepuisLibelle(libelle),
    brand_title: champ("Marque"),
    status: etat,
    user: p.user ? { id: p.user.id, business: Boolean(p.user.isBusiness) } : null,
    photo: photo ? { url: photo } : null,
  };
}

/**
 * Lit une page de catalogue et en extrait les annonces.
 *
 * Les donnees ne sont plus dans une reponse JSON mais dans le flux de rendu
 * Next.js inclus dans le HTML (self.__next_f.push). On recupere ce HTML par un
 * fetch same-origin — sans rendu, ~1 s — puis on isole chaque objet
 * {"id":…,"productItem":{…}}. Seuls les champs utiles quittent la page.
 */
async function catalogue(page, chemin) {
  let resultat;
  await espacer();
  try {
    resultat = await page.evaluate(async (c) => {
    try {
      const reponse = await fetch(c, { headers: { accept: "text/html" } });
      if (!reponse.ok) return { statut: reponse.status, produits: null };
      const html = await reponse.text();
      // Sans flux Next.js, ce n'est pas une page de catalogue : challenge.
      if (!html.includes("__next_f")) return { statut: "challenge", produits: null };
      const flux = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)]
        .map((m) => { try { return JSON.parse(m[1]); } catch (_) { return ""; } })
        .join("");
      const sortie = [];
      const motif = /\{"id":(\d{6,}),"productItem":/g;
      let m;
      while ((m = motif.exec(flux))) {
        let profondeur = 0;
        let fin = m.index;
        for (; fin < flux.length; fin += 1) {
          const ch = flux[fin];
          if (ch === "{") profondeur += 1;
          else if (ch === "}") { profondeur -= 1; if (profondeur === 0) break; }
        }
        try {
          const p = JSON.parse(flux.slice(m.index, fin + 1)).productItem;
          sortie.push({ id: p.id, title: p.title, url: p.url, price: p.price, user: p.user,
                        photos: (p.photos || []).slice(0, 1).map((x) => ({ url: x.url })),
                        thumbnailUrl: p.thumbnailUrl, itemBox: p.itemBox });
        } catch (_) {}
      }
      return { statut: 200, produits: sortie };
    } catch (_) {
      return { statut: 0, produits: null };
    }
  }, `https://www.vinted.fr${chemin}`);
  } catch (erreur) {
    // La page elle-meme a plante (navigation, contexte detruit) : on le dit.
    erreurJournal(`catalogue : ${erreur.message.split("\n")[0]}`);
    resultat = { statut: 0, produits: null };
  }
  noterStatut(resultat.statut);
  if (statutBloquant(resultat.statut)) erreurJournal(`Vinted bloque (${resultat.statut}) sur ${chemin.slice(0, 60)}`);
  const produits = resultat.produits;
  if (!produits) return null;
  const vus = new Set();
  const items = [];
  for (const p of produits) {
    const a = annonceDepuisProduit(p);
    if (a && !vus.has(a.id)) { vus.add(a.id); items.push(a); }
  }
  return { items };
}


/** "du modèle", "de la marque", "du lot de 3" : l'article suit le niveau. */
export const article = (niveau) => (String(niveau) === "marque" ? "de la marque" : `du ${niveau}`);

const borner = (x) => Math.max(0, Math.min(1, x));
/** Une neuve sous etiquette se revend mieux et plus vite qu'une "bon etat". */
const POINTS_ETAT = { "neuf avec etiquette": 10, "neuf sans etiquette": 9, "tres bon etat": 7, "bon etat": 5, satisfaisant: 2 };

/**
 * Score d'affaire sur 100, pour hierarchiser les alertes. Il ne decide pas
 * seul (sauf `scoreMinimum`) : le filtre de marge reste `merite`. Il dit
 * laquelle ouvrir en premier.
 *
 *   decote      35  (1 − cout / cote), plein a −60 %
 *   marge nette 25  cote − cout, pleine a 300 EUR
 *   fiabilite   15  cote de modele > cote de marque > lot ; echantillon ;
 *                   penalite si les prix comparables sont tres disperses
 *   etat        10  echelle Vinted
 *   vendeur      5  un particulier qui vend UNE montre vend rarement au prix pro
 *   fraicheur    5  rang dans les nouveautes : en tete = personne ne l'a vue
 *   pepite       5  maison de niche ou signal de valeur
 *
 * Le cout est le prix TOTAL (protection acheteurs comprise, lue dans le
 * libelle) plus un forfait de port `fraisPortEstimes` : le catalogue ne donne
 * pas les frais de port, on ne les invente pas, on les regle.
 */
export function scoreAffaire(a) {
  const prixTotal = a.prixTotal && a.prixTotal >= a.prix ? a.prixTotal : a.prix;
  const port = CONFIG.fraisPortEstimes ?? 0;
  const cout = Math.round((prixTotal + port) * 100) / 100;
  const details = { decote: 0, marge: 0, fiabilite: 0 };
  let margeNette = null;
  let decote = null;

  if (a.cote) {
    margeNette = Math.round(a.cote - cout);
    decote = Math.round((1 - a.prix / a.cote) * 100);
    details.decote = Math.round(borner((1 - cout / a.cote) / 0.6) * 35);
    details.marge = Math.round(borner(margeNette / 300) * 25);
    let fiabilite;
    if (a.lot) fiabilite = 4;
    else if (a.niveau === "modèle") fiabilite = 9 + (Math.min(a.echantillon || 0, 12) / 12) * 6;
    else fiabilite = 3 + (Math.min(a.echantillon || 0, 30) / 30) * 4;
    // Dispersion de 0,3 ou moins : rien a redire. Au-dela de 1,3 : cote sans valeur.
    if (a.dispersion != null) fiabilite *= borner(1.3 - a.dispersion);
    details.fiabilite = Math.round(fiabilite);
  }
  details.etat = POINTS_ETAT[normaliser(a.etat)] ?? 3;
  const nb = a.vendeurNb || 1;
  details.vendeur = nb <= 1 ? 5 : nb <= 3 ? 3 : 1;
  details.fraicheur = a.rang == null ? 3 : a.rang < 96 ? 5 : a.rang < 192 ? 3 : 1;
  details.pepite = a.pepite ? 5 : 0;

  const score = Math.max(0, Math.min(100, Object.values(details).reduce((s, x) => s + x, 0)));
  const urgence =
    score >= (CONFIG.scoreMention ?? 75) ? "urgente" : score >= (CONFIG.scoreFort ?? 55) ? "forte" : "normale";
  return { score, urgence, margeNette, decote, prixTotal, cout, details };
}

const LIBELLES_URGENCE = { urgente: "🔥 très grosse affaire", forte: "⚡ bonne affaire", normale: "à regarder" };

/**
 * Le message Discord d'une alerte, isole pour etre testable. La mention
 * (`mentionDiscord`, "@here" par defaut) n'est posee QUE sur les tres grosses
 * affaires : mentionner a chaque alerte, c'est apprendre a ignorer les
 * mentions.
 */
export function corpsAlerte(annonce) {
  const s = annonce.score || scoreAffaire(annonce);
  const mention = s.urgence === "urgente" && CONFIG.mentionDiscord ? CONFIG.mentionDiscord : "";
  const couleurs = { urgente: 0xe74c3c, forte: 0xe67e22, normale: annonce.pepite ? 0x9b59b6 : 0x2ecc71 };
  const port = CONFIG.fraisPortEstimes ?? 0;

  const extrait = annonce.description
    ? annonce.description.replace(/\s+/g, " ").trim().slice(0, 300) +
      (annonce.description.length > 300 ? "…" : "")
    : "_description vide — à vérifier sur place_";

  let tete;
  if (annonce.cote) {
    tete =
      `**${annonce.prix} €** au lieu de **~${annonce.cote} €** — **−${s.decote} %**\n` +
      `Cote ${article(annonce.niveau)} : médiane sur ${annonce.echantillon} annonces.\n` +
      `**Bénéfice net estimé : ~${s.margeNette} €** ` +
      `(coût total ~${Math.round(s.cout)} € : protection acheteurs${port ? ` + port ~${port} €` : ""}).`;
  } else if (annonce.cible) {
    tete = `**${annonce.prix} €** — sous ton prix cible de ${annonce.alerteSousPrix} € (recherche « ${annonce.cible} »). Aucune cote fiable.`;
  } else {
    tete = `**${annonce.prix} €** — pièce de collection, aucune cote fiable à ce jour.`;
  }

  const champs = [
    { name: "Score", value: `**${s.score}/100** · ${LIBELLES_URGENCE[s.urgence]}`, inline: true },
    { name: "Prix", value: s.prixTotal > annonce.prix ? `${annonce.prix} € (${s.prixTotal} € frais inclus)` : `${annonce.prix} €`, inline: true },
    ...(annonce.cote ? [{ name: "Cote", value: `${annonce.cote} € (${annonce.niveau})`, inline: true }] : []),
    { name: "Marque", value: `${annonce.marque || "inconnue"}${annonce.marqueDeduite ? " _(lue dans le titre)_" : ""}`, inline: true },
    { name: "État", value: annonce.etat || "non précisé", inline: true },
    ...(annonce.vendeurNb > 1 ? [{ name: "Vendeur", value: `${annonce.vendeurNb} montres publiées récemment`, inline: true }] : []),
    ...(annonce.pepite ? [{ name: "Signal", value: "montre de collection 💎", inline: true }] : []),
    ...(annonce.lot
      ? [{ name: "Lot", value: `${annonce.lot} montres, comptées à ${Math.round(CONFIG.facteurLot * 100)} % de la cote`, inline: false }]
      : []),
    ...(annonce.cible ? [{ name: "Recherche", value: annonce.cible, inline: true }] : []),
  ];

  return {
    ...(mention ? { content: `${mention} ${LIBELLES_URGENCE.urgente} : ${annonce.titre.slice(0, 120)}` } : {}),
    // Sans cette liste, Discord ignore la mention ; et a vide, aucun texte de la
    // description ne peut mentionner qui que ce soit.
    allowed_mentions: mention ? { parse: ["everyone", "roles", "users"] } : { parse: [] },
    embeds: [
      {
        title: `${annonce.pepite ? "💎 " : ""}${annonce.lot ? "📦 " : ""}${annonce.titre.slice(0, 235)}`,
        url: annonce.lien,
        color: couleurs[s.urgence],
        description: `${tete}\n\n> ${extrait}`,
        fields: champs,
        // La grande image plutot que la vignette : on juge une montre sur photo.
        image: annonce.photo ? { url: annonce.photo } : undefined,
        footer: { text: `Veille Vinted · ${annonce.lien}`.slice(0, 2048) },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

/**
 * Envoi au webhook, avec relance : sur un 429 Discord on attend le delai qu'il
 * indique (`retry_after`, en secondes), sur une erreur 5xx ou reseau on double
 * l'attente. Quatre essais au plus, puis l'erreur remonte.
 */
async function envoyerDiscord(corps, essais = 4) {
  for (let essai = 1; ; essai += 1) {
    let reponse;
    try {
      reponse = await fetch(WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corps),
      });
    } catch (erreur) {
      if (essai >= essais) throw erreur;
      await attendre(2000 * 2 ** (essai - 1));
      continue;
    }
    if (reponse.ok) return;
    if (reponse.status === 429 && essai < essais) {
      let secondes = Number(reponse.headers.get("retry-after")) || 2;
      try {
        const j = await reponse.json();
        if (j && j.retry_after) secondes = Number(j.retry_after);
      } catch (_) {}
      await attendre(Math.min(30, secondes) * 1000 + 250);
      continue;
    }
    if (reponse.status >= 500 && essai < essais) {
      await attendre(2000 * 2 ** (essai - 1));
      continue;
    }
    throw new Error(`Discord a répondu ${reponse.status}`);
  }
}

/** Envoi d'une alerte Discord, ou simple ligne de journal en mode essai. */
async function alerter(annonce) {
  if (ESSAI) {
    const s = annonce.score;
    console.log(
      `  [essai] ${String(s.score).padStart(3)}/100${annonce.pepite ? " 💎" : "  "} ${String(annonce.prix).padStart(4)} € — ` +
        (annonce.cote
          ? `+${String(s.margeNette).padStart(3)} € net (cote ${annonce.niveau} ${annonce.cote} €, −${s.decote} %)`
          : annonce.cible ? `cible « ${annonce.cible} »` : "sans cote") +
        ` — ${annonce.marque} — ${annonce.titre.slice(0, 45)}`
    );
    return;
  }
  await envoyerDiscord(corpsAlerte(annonce));
}

/** Le texte du resume : le tunnel en une phrase, motifs du plus gros au plus petit. */
export function texteResume(bilan, ecoule) {
  const duree = Math.round(ecoule / 60000);
  const motifs = [
    [bilan.marque, "hors horlogerie"],
    [bilan.prix, "sous le prix plancher"],
    [bilan.etat, "état insuffisant"],
    [bilan.accessoire, "accessoire, pas une montre"],
    [bilan.imitation, "imitation annoncée"],
    [bilan.lot, "lot de plusieurs montres"],
    [bilan.fausse, "luxe à prix impossible"],
    [bilan.pro, "vendeur professionnel"],
    [bilan.vendeurSpecialise, "revendeur de montres"],
    [bilan.sansCote, "marque sans cote fiable"],
    [bilan.chere, "au prix du marché"],
    [bilan.scoreFaible, "score trop faible"],
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
      : `**Pourquoi :** ${motifs.join(" · ")}.`) +
    (bilan.blocages > 0 ? `\n\n⚠️ Vinted a freiné le bot ${bilan.blocages} fois (403/429) : passages ralentis.` : "")
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
    allowed_mentions: { parse: [] },
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
    await envoyerDiscord(corps);
    journal(`résumé envoyé : rien depuis ${duree} min`);
  } catch (erreur) {
    erreurJournal(`résumé non envoyé (${erreur.message})`);
    return false; // on garde le bilan, il repartira au prochain job
  }
  return true;
}

/**
 * Les recherches ciblees a lancer a ce passage : `recherchesParPassage` au
 * plus, en rotation. Une par passage par defaut — chaque recherche est une
 * requete de plus, et on ne martele pas Vinted.
 */
export function recherchesDuPassage(recherches, tour, combien = 1) {
  const actives = (recherches || []).filter((r) => r && r.actif !== false && (r.texte || r.nom));
  if (!actives.length || !(combien > 0)) return [];
  const sortie = [];
  for (let i = 0; i < Math.min(combien, actives.length); i += 1) sortie.push(actives[(tour + i) % actives.length]);
  return sortie;
}

/** L'annonce tient-elle dans la fourchette de prix de la recherche ? */
export function dansFourchette(item, recherche) {
  const prix = prixDe(item);
  if (!Number.isFinite(prix)) return false;
  if (recherche.prixMin && prix < recherche.prixMin) return false;
  if (recherche.prixMax && prix > recherche.prixMax) return false;
  return true;
}

/**
 * Un passage : on relit les nouveautes et on alerte sur ce qui merite.
 * Renvoie { ok, bloque } : ok = Vinted a renvoye des annonces.
 *
 * `ctx.file` porte les candidates qu'on n'a pas pu juger a ce passage (plafond
 * d'alertes ou de requetes atteint, Vinted qui freine, fiche momentanement
 * illisible) : elles passent en tete au passage suivant au lieu d'etre perdues.
 */
export async function unPassage(page, ctx) {
  const { vues, cotes, bilan, vendeurs, file } = ctx;
  garde.bloque = false;

  // On lit la CATEGORIE, sans mot-cle. Chercher "montre", "orologio", "uhr"...
  // paraissait couvrir large, mais laissait passer tout titre ne contenant aucun
  // de ces mots : mesure faite, 59 des 285 annonces les plus recentes — une sur
  // cinq. Dont une Baume & Mercier a 199 EUR cotee 550 EUR, intitulee
  // "Baume e mercier automatico". La categorie dit deja que ce sont des montres.
  const trouvees = new Map();
  let rang = 0;
  for (let numero = 1; numero <= CONFIG.pagesCatalogue; numero += 1) {
    const r = await catalogue(
      page,
      rechercheUrl({ catalog_ids: String(CONFIG.categorieVinted), page: String(numero), order: "newest_first" })
    );
    const lot = (r && r.items) || [];
    for (const item of lot) {
      if (!trouvees.has(item.id)) trouvees.set(item.id, { ...item, rang });
      rang += 1;
    }
    if (!lot.length || garde.bloque) break;
  }

  if (!trouvees.size) {
    // Ce message disait "challenge non franchi" : c'etait faux le 14 septembre,
    // quand Vinted a simplement change d'adresse. On dit ce qu'on sait.
    erreurJournal(
      garde.bloque
        ? `Vinted freine le bot (${garde.dernierStatut}) : aucune annonce lue.`
        : "Vinted n'a renvoyé aucune annonce (site modifié ou accès bloqué)."
    );
    return { ok: false, bloque: garde.bloque };
  }

  // Recherches ciblees, en rotation : une requete de plus par passage au plus
  // (par defaut). Une annonce deja vue par la categorie recoit simplement le
  // nom de la recherche.
  if (!garde.bloque) {
    for (const r of recherchesDuPassage(CONFIG.recherches, ctx.tour, CONFIG.recherchesParPassage ?? 1)) {
      const res = await catalogue(
        page,
        rechercheUrl({
          search_text: r.texte || r.nom,
          catalog_ids: String(CONFIG.categorieVinted),
          order: "newest_first",
          price_from: r.prixMin,
          price_to: r.prixMax,
        })
      );
      for (const item of (res && res.items) || []) {
        if (!dansFourchette(item, r)) continue;
        const deja = trouvees.get(item.id);
        if (deja) deja.recherche = r;
        else trouvees.set(item.id, { ...item, recherche: r });
      }
      if (garde.bloque) break;
    }
    ctx.tour += 1;
  }

  bilan.passages += 1;

  // Les reportees du passage precedent d'abord : elles ont deja attendu.
  const candidates = file.splice(0);
  for (const item of trouvees.values()) {
    const refus = motifDeRefus(item, vues);
    if (refus === "deja") continue;
    // Memorisee des maintenant, quel que soit le sort : sans cela une annonce
    // recalee sur la marque serait recomptee a chaque passage, et le resume
    // annoncerait trois fois le nombre reel de nouveautes.
    vues.add(String(item.id));
    bilan.nouvelles += 1;

    // Combien de montres DIFFERENTES ce vendeur a-t-il publiees ces derniers
    // `vendeurFenetreJours` ? L'API ignore le filtre user_id (verifie : elle
    // renvoie les memes 96 articles pour tout le monde), mais on peut compter
    // soi-meme, sans une seule requete de plus.
    const vendeur = item.user && item.user.id ? String(item.user.id) : "";
    if (vendeur) {
      const v = lireVendeur(vendeurs[vendeur]);
      vendeurs[vendeur] = { n: v.n + 1, vu: Date.now() };
      item.vendeurNb = v.n + 1;
    }

    if (refus) bilan[refus] = (bilan[refus] || 0) + 1;
    else if (item.vendeurNb > CONFIG.vendeurMaxMontres) bilan.vendeurSpecialise += 1;
    else candidates.push(item);
  }

  const alertes = [];
  const debut = garde.requetes;
  const budget = CONFIG.maxRequetesParPassage ?? 40;
  const essaisMax = CONFIG.essaisDescription ?? 3;
  // Remise en file d'une annonce qu'on n'a pas pu juger, avec un plafond
  // d'essais : une fiche qui reste illisible finit par etre abandonnee.
  const remettre = (item) => {
    item.essais = (item.essais || 0) + 1;
    if (item.essais <= essaisMax) file.push(item);
    else journal(`  abandonnée après ${essaisMax} essais : ${item.title.slice(0, 45)}`);
  };

  for (let i = 0; i < candidates.length; i += 1) {
    // Plafonds : alertes, requetes, blocage. Le reste attend le passage
    // suivant — avant, tout ce qui suivait la cinquieme alerte etait perdu.
    if (alertes.length >= CONFIG.maxAlertesParPassage || garde.bloque || garde.requetes - debut >= budget) {
      file.push(...candidates.slice(i));
      break;
    }
    const item = candidates[i];
    const { marque, deduite } = marqueDe(item);
    const prix = prixDe(item);

    // Cote du modele d'abord : c'est elle qui revele les pepites. La cote de
    // marque ne sert que de repli quand l'echantillon est trop maigre.
    // La cote de marque est en cache et ne coute rien ; celle du modele demande
    // une requete par modele distinct. On ne la calcule donc que si l'annonce
    // n'est pas manifestement hors de prix — sans quoi chaque passage
    // interrogerait Vinted trois cents fois.
    let cote = await coteMarque(page, marque, cotes);
    if (cote.indisponible) {
      remettre(item);
      continue;
    }

    const lot = CONFIG.accepterLots ? nombreDansLot(item.title) : 0;
    if (lot) {
      // Un lot ne se compare pas a une montre seule. Chaque piece n'est comptee
      // qu'a `facteurLot` de la cote : un lot contient presque toujours du
      // dechet, et mieux vaut rater un lot que faire acheter un carton de pieces.
      if (cote.mediane) {
        cote = {
          ...cote,
          mediane: Math.round(cote.mediane * lot * CONFIG.facteurLot),
          niveau: `lot de ${lot}`,
        };
      }
    } else if (!cote.mediane || prix / cote.mediane <= CONFIG.ratioAvantCoteModele) {
      const jetons = jetonsModele(item.title, marque);
      const requete = requeteModele(item.title, marque);
      const precise = requete ? await coteModele(page, requete, jetons, marque, item.status, cotes) : null;
      if (precise && precise.mediane) cote = precise;
      else if (precise && precise.indisponible) {
        remettre(item);
        continue;
      }
    }

    // Une montre de niche merite qu'on lise sa description avant de la juger :
    // le signal de valeur y est souvent, pas dans le titre.
    const pepiteTitre = estPepite(item.title, "", marque);
    // Recherche ciblee avec prix d'alerte : on alerte sous ce prix meme sans cote.
    const cible =
      item.recherche && item.recherche.alerteSousPrix && prix <= item.recherche.alerteSousPrix ? item.recherche : null;

    if (!cote.mediane && !pepiteTitre && !cible) {
      bilan.sansCote += 1;
      continue;
    }

    if (!cible && !merite(prix, cote.mediane, pepiteTitre, (cote.niveau || "marque") !== "marque")) {
      bilan.chere += 1;
      continue;
    }

    // La description ne se lit qu'ici : une requete par finaliste, pas par
    // annonce. A ce stade il n'en reste qu'une poignee.
    const lien = item.url || `https://www.vinted.fr/items/${item.id}`;
    const fiche = await descriptionDe(page, lien);

    // Fiche momentanement illisible (blocage, reseau) : on retentera.
    if (fiche.statut === "indisponible") {
      remettre(item);
      journal(`  reportée (fiche illisible, ${garde.dernierStatut}) : ${item.title.slice(0, 45)} — ${prix} €`);
      continue;
    }
    // Annonce supprimee : presque toujours une contrefacon, que Vinted retire
    // en quelques minutes. Envoyer un lien mort n'aide personne.
    if (fiche.statut === "supprimee") {
      bilan.description += 1;
      journal(`  écartée (annonce supprimée) : ${item.title.slice(0, 45)} — ${prix} €`);
      continue;
    }
    const description = fiche.description || "";

    const probleme = motRedhibitoire(item.title, description);
    if (probleme) {
      bilan.description += 1;
      journal(`  écartée (« ${probleme} ») : ${item.title.slice(0, 45)} — ${prix} €`);
      continue;
    }

    const annonce = {
      id: item.id,
      titre: item.title || "Annonce Vinted",
      prix,
      prixTotal: item.prix_total || null,
      marque,
      marqueDeduite: deduite,
      etat: item.status || "",
      description,
      cote: cote.mediane,
      echantillon: cote.echantillon,
      dispersion: cote.dispersion ?? null,
      niveau: cote.niveau || "marque",
      lot,
      pepite: estPepite(item.title, description, marque),
      vendeurNb: item.vendeurNb || 1,
      rang: item.rang,
      cible: cible ? cible.nom || cible.texte : null,
      alerteSousPrix: cible ? cible.alerteSousPrix : null,
      lien,
      photo: (item.photo && (item.photo.url || item.photo.thumbnail_url)) || "",
    };
    annonce.score = scoreAffaire(annonce);
    if (!cible && annonce.score.score < (CONFIG.scoreMinimum ?? 0)) {
      bilan.scoreFaible += 1;
      journal(`  écartée (score ${annonce.score.score}) : ${item.title.slice(0, 45)} — ${prix} €`);
      continue;
    }
    alertes.push(annonce);
  }

  // Les meilleures d'abord : si Discord rechigne, ce sont elles qui passent.
  alertes.sort((a, b) => b.score.score - a.score.score);
  for (const alerte of alertes) {
    try {
      await alerter(alerte);
      bilan.alertes += 1;
      if (!ESSAI) journal(`alerte envoyée (${alerte.score.score}/100) : ${alerte.titre.slice(0, 40)} — ${alerte.prix} €`);
    } catch (erreur) {
      // Un envoi rate ne doit pas faire perdre le reste du passage : on retire
      // l'annonce des "vues" pour la retenter au prochain tour.
      vues.delete(String(alerte.id));
      erreurJournal(`envoi impossible (${erreur.message}) — sera retentée.`);
    }
  }

  const plafond = CONFIG.fileAttenteMax ?? 150;
  if (file.length > plafond) {
    const perdues = file.splice(0, file.length - plafond);
    erreurJournal(`file d'attente pleine : ${perdues.length} annonce(s) abandonnée(s)`);
  }
  if (garde.bloque) bilan.blocages += 1;
  return { ok: true, bloque: garde.bloque };
}

/**
 * Previent sur Discord quand le bot ne voit plus aucune annonce, et quand il
 * les revoit.
 *
 * Le 14 septembre 2026, Vinted a change l'adresse de ses resultats : le bot a
 * tourne DEUX JOURS ET DEMI sans rien lire, chaque job se terminant en
 * "success" et Discord restant muet. Le silence ne doit plus jamais pouvoir
 * vouloir dire "en panne". Un rappel toutes les `rappelPanneHeures` au plus,
 * pour ne pas spammer pendant une panne longue.
 */
async function signalerPanne(etat, enPanne) {
  if (ESSAI || !WEBHOOK) return;
  const maintenant = Date.now();
  let corps = null;

  if (enPanne) {
    const dernier = etat.panne || 0;
    if (maintenant - dernier < CONFIG.rappelPanneHeures * 3600 * 1000) return;
    const depuis = etat.panneDebut || maintenant;
    const heures = Math.round((maintenant - depuis) / 3600000);
    const cause = statutBloquant(garde.dernierStatut)
      ? `Vinted bloque l'accès (réponse ${garde.dernierStatut}).`
      : "Vinted ne renvoie plus rien au bot : site modifié ou accès bloqué.";
    corps = {
      embeds: [{
        title: "⚠️ Le bot ne voit plus aucune annonce",
        color: 0xe74c3c,
        description:
          `${cause} **Aucune alerte ne peut partir tant que ce n'est pas réparé.**` +
          (heures >= 1 ? `\n\nPanne en cours depuis environ ${heures} h.` : ""),
        footer: { text: "Veille Vinted" },
        timestamp: new Date().toISOString(),
      }],
    };
    etat.panne = maintenant;
    etat.panneDebut = depuis;
  } else {
    if (!etat.panneDebut) return;
    const heures = Math.round((maintenant - etat.panneDebut) / 3600000);
    corps = {
      embeds: [{
        title: "✅ Le bot voit à nouveau les annonces",
        color: 0x2ecc71,
        description: `La surveillance a repris après environ ${heures} h d'interruption.`,
        footer: { text: "Veille Vinted" },
        timestamp: new Date().toISOString(),
      }],
    };
    etat.panne = null;
    etat.panneDebut = null;
  }

  try {
    await envoyerDiscord(corps);
    journal(enPanne ? "panne signalée sur Discord" : "fin de panne signalée sur Discord");
  } catch (erreur) {
    erreurJournal(`signalement de panne impossible (${erreur.message})`);
  }
}

/**
 * Charger le site d'abord : c'est ce qui resout le challenge et pose les
 * cookies. Refait apres plusieurs echecs, pour repartir d'une session propre.
 * Trois essais espaces ; aucune autre manoeuvre.
 */
async function ouvrirSession(page) {
  for (let essai = 1; essai <= 3; essai += 1) {
    try {
      await page.goto("https://www.vinted.fr/", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(4000);
      return true;
    } catch (erreur) {
      erreurJournal(`accueil Vinted inaccessible (essai ${essai}) : ${erreur.message.split("\n")[0]}`);
      await attendre(15000 * essai);
    }
  }
  return false;
}

/**
 * Un job GitHub coute 40 s de mise en route (installation de Chrome) pour 8 s de
 * scan. Lancer le workflow plus souvent revient donc a payer surtout de
 * l'attente. On boucle plutot DANS le job, en gardant le meme navigateur et la
 * meme session Vinted : le delai entre deux relevés tombe a l'intervalle choisi
 * au lieu de la periode du cron.
 *
 * Quand Vinted freine (403/429) ou ne repond plus, l'intervalle double a chaque
 * echec (`backoffMaxSecondes` au plus) ; apres `echecsAvantRelance` echecs on
 * revisite l'accueil ; apres `echecsAvantAbandon`, on signale la panne et on
 * rend la main : le job suivant repartira avec un navigateur et une IP neufs.
 */
async function main() {
  if (!WEBHOOK && !ESSAI) {
    console.error("DISCORD_WEBHOOK absent : ajoute-le dans les secrets du dépôt.");
    process.exit(1);
  }

  const etat = await lireEtat();
  const vues = new Set(etat.vues || []);
  // Elagage des l'ouverture : l'etat herite pesait 6,8 Mo, surtout de cotes
  // perimees et de vendeurs oublies.
  const cotes = elaguerCotes(etat.cotes, Date.now(), CONFIG.coteConserverHeures);
  const bilan = { ...nouveauBilan(), ...(etat.bilan || {}) };
  const vendeurs = elaguerVendeurs(etat.vendeurs, Date.now(), CONFIG.vendeurFenetreJours, CONFIG.vendeurMaxMontres);
  const ctx = { vues, cotes, bilan, vendeurs, file: [], tour: 0 };

  const etatCourant = (bilanAEcrire = bilan) => ({
    vues: [...vues].slice(-PLAFOND_VUES),
    cotes: elaguerCotes(cotes, Date.now(), CONFIG.coteConserverHeures),
    vendeurs: elaguerVendeurs(vendeurs, Date.now(), CONFIG.vendeurFenetreJours),
    bilan: bilanAEcrire,
    panne: etat.panne || null,
    panneDebut: etat.panneDebut || null,
  });

  const navigateur = await chromium.launch({ channel: "chrome", headless: true });
  const contexte = await navigateur.newContext({ userAgent: UA, locale: "fr-FR" });
  const page = await contexte.newPage();

  const fin = Date.now() + CONFIG.bouclerSecondes * 1000;
  const avant = { ...bilan };
  let passages = 0;
  let echecs = 0;
  let dernierEnregistrement = Date.now();
  const relance = CONFIG.echecsAvantRelance ?? 2;
  const abandon = CONFIG.echecsAvantAbandon ?? 4;

  // Cumul du job, independant du bilan qui se remet a zero a chaque resume :
  // sans lui, la ligne de journal finale annoncait "0 alerte" apres un resume.
  const cumul = { nouvelles: 0, alertes: 0 };
  const reporter = () => {
    cumul.nouvelles += bilan.nouvelles - avant.nouvelles;
    cumul.alertes += bilan.alertes - avant.alertes;
  };

  try {
    let session = await ouvrirSession(page);

    while (true) {
      passages += 1;
      let r = { ok: false, bloque: false };
      if (session) {
        try {
          r = await unPassage(page, ctx);
        } catch (erreur) {
          // Une exception ne doit plus emporter tout le job de cinq heures.
          erreurJournal(`passage ${passages} interrompu : ${erreur.message.split("\n")[0]}`);
        }
      }

      if (r.ok) {
        if (echecs) journal(`Vinted répond à nouveau après ${echecs} échec(s).`);
        echecs = 0;
        await signalerPanne(etat, false);
      } else {
        echecs += 1;
        if (r.bloque) bilan.blocages += 1;
        if (echecs >= abandon) {
          await signalerPanne(etat, true);
          erreurJournal(`${echecs} échecs de suite : fin du job, le suivant repartira avec un navigateur neuf.`);
          break;
        }
        if (echecs >= relance) {
          journal("nouvelle visite de l'accueil pour rafraîchir la session");
          session = await ouvrirSession(page);
        }
      }

      // Le resume horaire se teste ici et non a la fin du job : depuis que les
      // jobs durent cinq heures, il ne serait plus parti qu'une fois par job.
      if (await resumer(bilan)) {
        reporter();
        Object.assign(bilan, nouveauBilan());
        Object.assign(avant, bilan);
      }

      if (
        process.env.ENREGISTRER_EN_ROUTE === "1" &&
        Date.now() - dernierEnregistrement >= CONFIG.enregistrerToutesLesSecondes * 1000
      ) {
        await writeFile(ETAT, JSON.stringify(etatCourant(), null, 1));
        await enregistrerEnRoute();
        dernierEnregistrement = Date.now();
      }

      const delai = delaiBackoff(echecs, CONFIG.intervalleSecondes, CONFIG.backoffMaxSecondes ?? 600);
      if (Date.now() + delai * 1000 >= fin) break;
      if (echecs) journal(`prochain essai dans ${delai} s`);
      await attendre(delai * 1000);
    }
  } finally {
    await navigateur.close().catch(() => {});
  }

  reporter();
  journal(
    `${passages} passages en ${Math.round((CONFIG.bouclerSecondes * 1000 - (fin - Date.now())) / 1000)} s : ` +
      `${cumul.nouvelles} nouvelles annonces, ${cumul.alertes} alerte(s), ${garde.requetes} requêtes Vinted.`
  );
  if (ctx.file.length) journal(`${ctx.file.length} annonce(s) encore en file à la fin du job (non réexaminées).`);

  // Dernier passage : le resume a deja ete teste a chaque tour de boucle. Pas de
  // "Rien a signaler" pendant une panne : ce serait exactement le faux silence
  // qu'on cherche a eliminer.
  const remis = etat.panneDebut ? false : await resumer(bilan);

  if (!ESSAI) await writeFile(ETAT, JSON.stringify(etatCourant(remis ? nouveauBilan() : bilan), null, 1));
}

if (process.argv[1] && process.argv[1].endsWith("scan.mjs")) await main();
