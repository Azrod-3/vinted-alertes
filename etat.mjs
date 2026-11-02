/**
 * Regles de l'etat persistant, partagees par le scan et par la fusion.
 *
 * Ce module ne lit ni la config ni le reseau : il est importe par
 * `fusionner-etat.mjs`, qui tourne seul dans `enregistrer-etat.sh`, et par les
 * tests.
 *
 * Pourquoi il existe : au 2 novembre 2026, etat.json pesait 6,8 Mo, dont
 * 4,4 Mo de cotes (43 118, dont 42 228 perimees depuis plus de 24 h, donc
 * inutilisables) et 0,9 Mo de vendeurs (63 434, comptes depuis toujours). Rien
 * n'etait jamais efface, et ce fichier est commite toutes les quinze minutes.
 */

export const PLAFOND_VUES = 4000;
const JOUR = 24 * 3600 * 1000;

/**
 * Une cote plus vieille que `heures` ne sert plus : le scan la recalcule au-dela
 * de 24 h. On en garde un peu plus pour pouvoir la lisser avec la nouvelle.
 */
export function elaguerCotes(cotes, maintenant = Date.now(), heures = 48) {
  const limite = maintenant - heures * 3600 * 1000;
  const sortie = {};
  for (const [cle, cote] of Object.entries(cotes || {})) {
    if (cote && Number(cote.date) >= limite) sortie[cle] = cote;
  }
  return sortie;
}

/**
 * Compteur d'un vendeur : { n, vu }. L'ancien format etait un simple nombre,
 * accepte ici pour ne rien casser a la premiere lecture.
 */
export function lireVendeur(valeur, maintenant = Date.now()) {
  if (typeof valeur === "number") return { n: valeur, vu: maintenant };
  if (valeur && typeof valeur === "object") return { n: Number(valeur.n) || 0, vu: Number(valeur.vu) || maintenant };
  return { n: 0, vu: 0 };
}

/**
 * Les vendeurs etaient comptes depuis toujours : un particulier qui vend six
 * montres en trois mois finissait classe revendeur pour l'eternite. On oublie
 * donc ceux qu'on n'a pas revus depuis `jours`, et ceux qui n'ont publie qu'une
 * montre (ils ne servent a rien et faisaient l'essentiel du volume).
 */
export function elaguerVendeurs(vendeurs, maintenant = Date.now(), jours = 30, seuilAncien = 0) {
  const limite = maintenant - jours * JOUR;
  const sortie = {};
  for (const [id, brut] of Object.entries(vendeurs || {})) {
    // Ancien format, sans date : on ne garde que les comptes qui changent une
    // decision (deja au-dela du seuil revendeur). Les 2 a 5 montres, accumulees
    // depuis des mois, faisaient l'essentiel du volume pour rien.
    if (typeof brut === "number" && brut <= seuilAncien) continue;
    const v = lireVendeur(brut, maintenant);
    if (v.n > 1 && v.vu >= limite) sortie[id] = v;
  }
  return sortie;
}

/**
 * Suivi des alertes : 7 jours et 300 entrees au plus, les plus recentes.
 */
export const PLAFOND_SUIVI = 300;
export function elaguerSuivi(suivi, maintenant = Date.now(), jours = 7) {
  const limite = maintenant - jours * JOUR;
  return (Array.isArray(suivi) ? suivi : [])
    .filter((e) => e && e.id && Number(e.date) >= limite)
    .sort((a, b) => a.date - b.date)
    .slice(-PLAFOND_SUIVI);
}

/**
 * Fusion de notre etat dans celui du depot. L'union des annonces vues est la
 * bonne operation ; pour les cotes, la plus recente gagne ; pour les vendeurs,
 * le plus grand compte (jamais la somme : deux jobs qui ont vu la meme annonce
 * la compteraient deux fois).
 */
export function fusionnerEtats(depot, nous, maintenant = Date.now(), options = {}) {
  const d = depot || {};
  const n = nous || {};
  const vues = [...new Set([...(d.vues || []), ...(n.vues || [])])].slice(-PLAFOND_VUES);

  const cotes = { ...(d.cotes || {}) };
  for (const [cle, cote] of Object.entries(n.cotes || {})) {
    if (!cotes[cle] || Number(cote && cote.date) >= Number(cotes[cle].date)) cotes[cle] = cote;
  }

  const vendeurs = {};
  for (const source of [d.vendeurs || {}, n.vendeurs || {}]) {
    for (const [id, brut] of Object.entries(source)) {
      if (typeof brut === "number" && brut <= (options.seuilAncien || 0)) continue;
      const v = lireVendeur(brut, maintenant);
      const avant = vendeurs[id] || { n: 0, vu: 0 };
      vendeurs[id] = { n: Math.max(avant.n, v.n), vu: Math.max(avant.vu, v.vu) };
    }
  }

  // Suivi : par id ; une entree verifiee l'emporte sur une entree en attente.
  const suiviParId = new Map();
  for (const e of [...(d.suivi || []), ...(n.suivi || [])]) {
    if (!e || !e.id) continue;
    const avant = suiviParId.get(String(e.id));
    if (!avant || (!avant.statut && e.statut) || (e.statut && Number(e.verifieA) >= Number(avant.verifieA || 0))) {
      suiviParId.set(String(e.id), e);
    }
  }
  const recaps = [d.dernierRecap, n.dernierRecap].filter(Boolean).sort();

  return {
    vues,
    cotes: elaguerCotes(cotes, maintenant, options.coteHeures),
    vendeurs: elaguerVendeurs(vendeurs, maintenant, options.vendeurJours, options.seuilAncien),
    bilan: n.bilan || d.bilan || null,
    // L'etat de panne suit la version la plus recente : la notre.
    panne: "panne" in n ? n.panne : d.panne || null,
    panneDebut: "panneDebut" in n ? n.panneDebut : d.panneDebut || null,
    suivi: elaguerSuivi([...suiviParId.values()], maintenant),
    dernierRecap: recaps.length ? recaps[recaps.length - 1] : null,
  };
}
