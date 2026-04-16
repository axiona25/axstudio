/**
 * Miniatura / cover capitolo Scenografie — logica separata dalla locandina progetto.
 * Sceglie un'immagine già generata (scena o master) più rappresentativa del blocco narrativo del capitolo,
 * non la "prima disponibile" né il primo master in elenco.
 */

import { isEnvironmentScene, resolveItalianPlanLogline } from "./scenografiePlanner.js";

/** @param {string} s */
function normKey(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9àèéìòù]+/gi, " ")
    .trim();
}

const STOP = new Set([
  "una", "uno", "due", "tre", "per", "con", "che", "non", "alla", "alle", "degli", "della", "dello", "delle", "nel",
  "nella", "sullo", "sulla", "come", "anche", "piu", "molto", "tutto", "questo", "quella", "sono", "hanno", "degli",
  "alla", "dopo", "prima", "solo", "ogni", "suo", "sua", "loro", "cui", "cosa", "anni", "vita", "citta", "paese",
]);

/**
 * @param {string} blob
 * @returns {string[]}
 */
function tokens(blob) {
  const n = normKey(blob);
  if (!n) return [];
  return n
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/**
 * @param {object} chapterData
 * @param {{ chapterOrdinal?: number, chapterTitle?: string, workspaceTitle?: string, workspaceDescription?: string }} ctx
 */
function chapterNarrativeBlob(chapterData, ctx) {
  const d = chapterData || {};
  const plan = d.plan || {};
  const log = resolveItalianPlanLogline(plan) || String(plan.summary_it || "").trim();
  const parts = [
    log,
    typeof d.prompt === "string" ? d.prompt : "",
    typeof d.scenografiaProjectTitle === "string" ? d.scenografiaProjectTitle : "",
    ctx?.chapterTitle,
    ctx?.workspaceTitle,
    ctx?.workspaceDescription,
  ];
  return parts.filter(Boolean).join(" ").trim();
}

/**
 * @param {object[]} chars
 * @param {string} blobNorm
 * @returns {{ id: string, name: string, hits: number }[]}
 */
function characterNameHits(chars, blobNorm) {
  const out = [];
  const list = Array.isArray(chars) ? chars : [];
  for (const c of list) {
    const id = String(c?.id || "").trim();
    const name = String(c?.name || "").trim();
    if (!id || !name) continue;
    const nk = normKey(name);
    if (nk.length < 2) continue;
    let hits = 0;
    if (blobNorm.includes(nk)) hits += 3;
    for (const w of nk.split(/\s+/).filter((x) => x.length > 2)) {
      if (blobNorm.includes(w)) hits += 1;
    }
    out.push({ id, name, hits });
  }
  return out;
}

/**
 * @param {object} plan
 * @param {string} charId
 */
function countScenePresenceForCharacter(plan, charId) {
  const scenes = Array.isArray(plan?.scenes) ? plan.scenes : [];
  let n = 0;
  for (const sc of scenes) {
    const ids = Array.isArray(sc?.characters_present) ? sc.characters_present : [];
    if (ids.some((id) => String(id) === String(charId))) n += 1;
  }
  return n;
}

/**
 * @param {object} planScene
 * @param {Map<string, string>} idToNormName
 */
function scenePresentNormNames(planScene, idToNormName) {
  const ids = Array.isArray(planScene?.characters_present) ? planScene.characters_present : [];
  const names = [];
  for (const id of ids) {
    const nm = idToNormName.get(String(id));
    if (nm) names.push(nm);
  }
  return names;
}

/**
 * @param {object} chapterData
 * @param {{ chapterOrdinal?: number, chapterTitle?: string, workspaceTitle?: string, workspaceDescription?: string }} ctx
 * @returns {number}
 */
function scoreSceneRowForCover(chapterData, ctx, planScene, sceneRow) {
  const d = chapterData || {};
  const plan = d.plan || {};
  const del = new Set(d.deletedSceneIds || []);
  if (planScene?.id && del.has(planScene.id)) return -9999;
  const url = sceneRow?.imageUrl && String(sceneRow.imageUrl).trim();
  if (!url) return -9999;

  const ord = typeof ctx?.chapterOrdinal === "number" && ctx.chapterOrdinal > 0 ? ctx.chapterOrdinal : 99;
  const blob = chapterNarrativeBlob(d, ctx || {});
  const blobNorm = normKey(blob);
  const logTokens = new Set(tokens(blob));

  const chars = Array.isArray(plan.characters) ? plan.characters : [];
  const idToNormName = new Map(
    chars
      .map((c) => {
        const id = String(c?.id || "").trim();
        const nm = normKey(String(c?.name || ""));
        return id && nm ? [id, nm] : null;
      })
      .filter(Boolean),
  );

  const titleIt = String(planScene?.title_it || "");
  const sumIt = String(planScene?.summary_it || "");
  const sceneNorm = normKey(`${titleIt} ${sumIt}`);

  const env = isEnvironmentScene(planScene);
  const presentNames = scenePresentNormNames(planScene, idToNormName);
  const presentCount = presentNames.length;

  const hitsList = characterNameHits(chars, blobNorm);
  const namedInChapter = hitsList.filter((h) => h.hits >= 1);
  const multiCharacterSignal = namedInChapter.length >= 2;

  let score = 0;
  if (sceneRow.approved === true) score += 2;

  if (env) {
    score += 5;
    if (ord <= 1 && multiCharacterSignal) score += 14;
    if (ord <= 1 && !multiCharacterSignal) score += 4;
  } else {
    if (presentCount >= 2) score += 16;
    else if (presentCount === 1) {
      score += 6;
      if (ord <= 1 && multiCharacterSignal) score -= 10;
    } else score += 3;
  }

  let overlap = 0;
  for (const t of logTokens) {
    if (t.length >= 4 && sceneNorm.includes(t)) overlap += 1;
  }
  score += Math.min(overlap * 1.8, 12);

  const wsNorm = normKey([ctx?.workspaceTitle, ctx?.workspaceDescription].filter(Boolean).join(" "));
  if (wsNorm.length > 8) {
    for (const nm of presentNames) {
      if (nm.length > 2 && wsNorm.includes(nm)) score += 4;
    }
  }

  const soloFocus =
    hitsList.length > 0 &&
    hitsList[0].hits >= 4 &&
    (hitsList[1]?.hits || 0) <= 1;
  if (soloFocus && presentCount === 1 && presentNames[0]) {
    const top = normKey(hitsList[0].name);
    if (top && sceneNorm.includes(top)) score += 10;
  }

  return score;
}

/**
 * @param {object} chapterData
 * @param {{ chapterOrdinal?: number, chapterTitle?: string, workspaceTitle?: string, workspaceDescription?: string }} ctx
 * @returns {string|null}
 */
export function pickChapterRepresentativeThumbnailUrl(chapterData, ctx = {}) {
  const d = chapterData || {};
  const plan = d.plan || {};
  const rows = Array.isArray(d.sceneResults) ? d.sceneResults : [];
  const del = new Set(d.deletedSceneIds || []);
  const sceneById = new Map((Array.isArray(plan.scenes) ? plan.scenes : []).map((s) => [String(s.id), s]));

  let bestUrl = null;
  let bestScore = -Infinity;
  for (const r of rows) {
    const sid = String(r?.sceneId || "");
    if (!sid || del.has(sid)) continue;
    const ps = sceneById.get(sid);
    if (!ps) continue;
    const sc = scoreSceneRowForCover(d, ctx, ps, r);
    if (sc > bestScore) {
      bestScore = sc;
      bestUrl = String(r.imageUrl).trim();
    }
  }
  if (bestUrl && bestScore > -100) return bestUrl;

  const masters = d.masterImages && typeof d.masterImages === "object" ? d.masterImages : {};
  const chars = Array.isArray(plan.characters) ? plan.characters : [];
  const blob = chapterNarrativeBlob(d, ctx);
  const blobNorm = normKey(blob);

  const scoredChars = chars
    .map((c) => {
      const id = String(c.id || "");
      const url = id && masters[id] ? String(masters[id]).trim() : "";
      if (!url) return null;
      let s = countScenePresenceForCharacter(plan, id) * 2;
      if (c.is_protagonist) s += 8;
      if (String(c.character_role || "").includes("protagonist")) s += 6;
      const nk = normKey(String(c.name || ""));
      if (nk && blobNorm.includes(nk)) s += 14;
      for (const w of nk.split(/\s+/).filter((x) => x.length > 2)) {
        if (blobNorm.includes(w)) s += 5;
      }
      return { id, url, s };
    })
    .filter(Boolean)
    .sort((a, b) => b.s - a.s);

  if (scoredChars.length) return scoredChars[0].url;

  for (const c of chars) {
    const u = masters[c.id];
    if (u && String(u).trim()) return String(u).trim();
  }
  for (const k of Object.keys(masters)) {
    const u = masters[k];
    if (u && String(u).trim()) return String(u).trim();
  }
  return null;
}
