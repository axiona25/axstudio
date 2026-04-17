/**
 * Sorgente unica per i master personaggio: `projectCharacterMasters`.
 * `masterImages` / `masterByCharName` sono solo cache derivate (salvabili ma non fonte di verità).
 */

import {
  stableCharacterKey,
  pcmRowForCharacter,
  getDisplayMasterUrl,
  isHttpUrl,
} from "./scenografiePcidLookup.js";
import {
  PCM_SOURCE_USER_CANONICAL_LOCK,
  syncLegacyMapsFromCanonicalPlan,
} from "./scenografieProjectPersistence.js";

export const CANONICAL_PCM_LOG = "[CANONICAL_PCM]";

/** @param {Record<string, unknown>|null|undefined} pcm */
/** @param {{ id?: string, pcid?: string }|null|undefined} char */
export function getCanonicalProjectCharacterMaster(pcm, char) {
  return pcmRowForCharacter(pcm, char);
}

/** @param {Record<string, unknown>|null|undefined} pcm */
/** @param {{ id?: string, pcid?: string }|null|undefined} char */
export function getCanonicalProjectCharacterMasterUrl(pcm, char) {
  return getDisplayMasterUrl(char, pcm);
}

/**
 * Sincronizza le cache legacy da PCM e logga.
 * @param {object|null} plan
 * @param {Record<string, unknown>} projectCharacterMasters
 * @param {string} reason
 * @returns {{ masterImages: Record<string,string>, masterByCharName: Record<string,string> }}
 */
export function syncDerivedMasterCachesFromCanonical(plan, projectCharacterMasters, reason = "") {
  const derived = syncLegacyMapsFromCanonicalPlan(plan, projectCharacterMasters);
  const tag = reason ? `${CANONICAL_PCM_LOG} cache_sync reason=${JSON.stringify(reason)}` : `${CANONICAL_PCM_LOG} cache_sync`;
  console.info(
    `${tag} keys_mi=${Object.keys(derived.masterImages || {}).length} keys_mbn=${Object.keys(derived.masterByCharName || {}).length}`,
  );
  return derived;
}

/**
 * Confronta cache derivate vs valore atteso da PCM (solo personaggi del piano).
 * @returns {{ ok: boolean, issues: object[] }}
 */
export function auditDerivedCacheDrift(plan, projectCharacterMasters, masterImages, masterByCharName) {
  const expected = syncLegacyMapsFromCanonicalPlan(plan, projectCharacterMasters);
  const issues = [];
  const miE = expected.masterImages || {};
  const miA = masterImages && typeof masterImages === "object" ? masterImages : {};
  for (const k of Object.keys(miE)) {
    const ve = String(miE[k] || "").trim();
    const va = miA[k] != null ? String(miA[k]).trim() : "";
    if (ve !== va) {
      issues.push({
        kind: "cache_drift",
        layer: "masterImages",
        key: k,
        expectedUrl: ve,
        actualUrl: va || null,
        severity: "needs_manual_review",
        hint: "Risincronizza da PCM o usa strumenti di correzione",
      });
    }
  }
  const mbnE = expected.masterByCharName || {};
  const mbnA = masterByCharName && typeof masterByCharName === "object" ? masterByCharName : {};
  for (const k of Object.keys(mbnE)) {
    const ve = String(mbnE[k] || "").trim();
    const va = mbnA[k] != null ? String(mbnA[k]).trim() : "";
    if (ve !== va) {
      issues.push({
        kind: "cache_drift",
        layer: "masterByCharName",
        key: k,
        expected: ve,
        actual: va || null,
        severity: "needs_manual_review",
      });
    }
  }
  if (issues.length) {
    console.warn(`${CANONICAL_PCM_LOG} mismatch cache vs canonical\n${JSON.stringify(issues, null, 2)}`);
  }
  return { ok: issues.length === 0, issues };
}

const TRANSFER_FIELDS = [
  "masterImageUrl",
  "characterMasterPrompt",
  "lastCharacterRegenerationPrompt",
  "characterPromptHistory",
  "priorMasterImageUrls",
];

/**
 * Aggiorna una riga canonica (merge shallow su riga esistente).
 * @returns {{ nextPcm: Record<string, object>, stableKey: string }}
 */
export function setCanonicalProjectCharacterMaster(plan, pcm, char, patch) {
  const stableKey = stableCharacterKey(char);
  if (!stableKey || !char?.id) {
    console.warn(`${CANONICAL_PCM_LOG} set_master skip: missing stableKey or char.id`);
    return { nextPcm: { ...(pcm || {}) }, stableKey: stableKey || "" };
  }
  const prev = pcm && typeof pcm[stableKey] === "object" ? pcm[stableKey] : {};
  const nextPcm = { ...(pcm && typeof pcm === "object" ? pcm : {}) };
  nextPcm[stableKey] = {
    ...prev,
    ...patch,
    characterId: char.id,
    characterName: char.name,
    updatedAt: patch?.updatedAt || new Date().toISOString(),
  };
  console.info(
    `${CANONICAL_PCM_LOG} set_master key=${stableKey} charId=${char.id} fields=${Object.keys(patch || {}).join(",")}`,
  );
  return { nextPcm, stableKey };
}

/**
 * Promuove un URL a master ufficiale (es. fotogramma scena).
 * @returns {{ nextPcm: Record<string, object>, stableKey: string }}
 */
export function promoteCanonicalProjectCharacterMaster(plan, pcm, char, imageUrl, opts = {}) {
  const u = String(imageUrl || "").trim();
  if (!u || !isHttpUrl(u)) {
    console.warn(`${CANONICAL_PCM_LOG} promote skip: invalid url`);
    return { nextPcm: { ...(pcm || {}) }, stableKey: stableCharacterKey(char) };
  }
  const stableKey = stableCharacterKey(char);
  const prev = pcm && typeof pcm[stableKey] === "object" ? pcm[stableKey] : {};
  const prevUrl = String(prev.masterImageUrl || "").trim();
  const prior = Array.isArray(prev.priorMasterImageUrls)
    ? prev.priorMasterImageUrls.filter((x) => typeof x === "string" && x.trim())
    : [];
  const nextPrior =
    prevUrl && prevUrl !== u ? [prevUrl, ...prior.filter((x) => x !== prevUrl)].slice(0, 20) : prior.slice(0, 20);
  const now = new Date().toISOString();
  const source = opts.source || PCM_SOURCE_USER_CANONICAL_LOCK;
  const { nextPcm } = setCanonicalProjectCharacterMaster(plan, pcm, char, {
    masterImageUrl: u,
    approved: opts.approved !== false,
    source,
    pendingManualReview: false,
    priorMasterImageUrls: nextPrior,
    updatedAt: now,
  });
  console.info(`${CANONICAL_PCM_LOG} promote key=${stableKey} url=${u.slice(0, 72)}…`);
  return { nextPcm, stableKey };
}

/**
 * Scambia interamente due righe canoniche (inclusi URL e metadati).
 */
export function swapCanonicalProjectCharacterMasters(plan, pcm, charA, charB) {
  const ka = stableCharacterKey(charA);
  const kb = stableCharacterKey(charB);
  if (!ka || !kb || ka === kb) {
    console.warn(`${CANONICAL_PCM_LOG} swap skip: invalid keys`);
    return { nextPcm: { ...(pcm || {}) }, ka, kb };
  }
  const rowA = pcm && typeof pcm[ka] === "object" ? { ...pcm[ka] } : {};
  const rowB = pcm && typeof pcm[kb] === "object" ? { ...pcm[kb] } : {};
  const now = new Date().toISOString();
  const nextPcm = { ...(pcm && typeof pcm === "object" ? pcm : {}) };
  nextPcm[ka] = {
    ...rowB,
    characterId: charA.id,
    characterName: charA.name,
    updatedAt: now,
  };
  nextPcm[kb] = {
    ...rowA,
    characterId: charB.id,
    characterName: charB.name,
    updatedAt: now,
  };
  console.info(`${CANONICAL_PCM_LOG} swap_masters ka=${ka} kb=${kb}`);
  return { nextPcm, ka, kb };
}

/**
 * Copia il master canonico di `fromChar` su `toChar` (candidate swap / correzione ruoli).
 * @param {{ clearSource?: boolean, markPendingReview?: boolean, resetApprovalOnTarget?: boolean }} opts
 */
export function reassignCanonicalMasterToCharacter(plan, pcm, fromChar, toChar, opts = {}) {
  const kf = stableCharacterKey(fromChar);
  const kt = stableCharacterKey(toChar);
  if (!kf || !kt || !fromChar?.id || !toChar?.id) {
    console.warn(`${CANONICAL_PCM_LOG} reassign skip: invalid characters`);
    return { nextPcm: { ...(pcm || {}) }, kf, kt, note: "invalid" };
  }
  const fromRow = pcm && typeof pcm[kf] === "object" ? { ...pcm[kf] } : {};
  const toRow = pcm && typeof pcm[kt] === "object" ? { ...pcm[kt] } : {};
  const now = new Date().toISOString();
  const nextPcm = { ...(pcm && typeof pcm === "object" ? pcm : {}) };

  const payload = {};
  for (const f of TRANSFER_FIELDS) {
    if (fromRow[f] != null) payload[f] = fromRow[f];
  }
  nextPcm[kt] = {
    ...toRow,
    ...payload,
    characterId: toChar.id,
    characterName: toChar.name,
    updatedAt: now,
    approved: opts.resetApprovalOnTarget !== false ? false : toRow.approved,
    source: "manual_reassign_copy",
    pendingManualReview: opts.markPendingReview !== false,
  };

  if (opts.clearSource) {
    nextPcm[kf] = {
      ...fromRow,
      masterImageUrl: "",
      approved: false,
      source: "manual_reassign_cleared_source",
      pendingManualReview: true,
      updatedAt: now,
      characterId: fromChar.id,
      characterName: fromChar.name,
    };
  }

  console.info(
    `${CANONICAL_PCM_LOG} reassign_copy from=${kf} to=${kt} clearSource=${!!opts.clearSource}`,
  );
  return { nextPcm, kf, kt };
}
