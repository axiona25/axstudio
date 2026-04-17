/**
 * Lookup stabile personaggio (STEP 4): `pcid` con fallback a `char.id` e warn sessione unica.
 */

const PCID_KEY_RE = /^pcid_[0-9a-f]{6}$/;

/** @param {unknown} s */
export function isPcidKey(s) {
  return PCID_KEY_RE.test(String(s || "").trim());
}

/** @param {unknown} s */
export function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s ?? "").trim());
}

let pcidLookupFallbackWarned = false;

/** Solo test harness: reset warn sessione. */
export function __resetPcidLookupFallbackWarnForTests() {
  pcidLookupFallbackWarned = false;
}

function warnPcidFallbackOnce(char) {
  if (pcidLookupFallbackWarned) return;
  pcidLookupFallbackWarned = true;
  const id = char && typeof char === "object" ? String(char.id || "").trim() : "";
  console.warn("[PCID LOOKUP FALLBACK] personaggio senza pcid valido — uso char.id", id || char);
}

/**
 * Chiave primaria per mappe master / approval / voice (pcid se valido, altrimenti char_N).
 * @param {{ id?: string, pcid?: string }|null|undefined} char
 */
export function stableCharacterKey(char) {
  if (!char || typeof char !== "object") return "";
  const p = String(char.pcid || "").trim();
  if (p && isPcidKey(p)) return p;
  const id = String(char.id || "").trim();
  if (id) warnPcidFallbackOnce(char);
  return id;
}

/**
 * Trova personaggio da riferimento in `characters_present` o da id pipeline (pcid o char_N).
 * @param {object|null} plan
 * @param {string} ref
 */
export function findPlanCharacterByPresentRef(plan, ref) {
  const r = String(ref || "").trim();
  if (!r) return undefined;
  const chars = plan?.characters || [];
  return chars.find((c) => String(c.pcid || "").trim() === r || String(c.id || "").trim() === r);
}

/**
 * @param {object|null} plan
 * @param {string} localCharId — tipicamente `char.id` dalla UI
 */
export function findPlanCharacterByLocalId(plan, localCharId) {
  const id = String(localCharId || "").trim();
  if (!id) return undefined;
  return (plan?.characters || []).find((c) => String(c.id || "").trim() === id);
}

/**
 * Nome display per logging / TTS (da ref pcid o char_N).
 */
export function planCharacterDisplayName(plan, characterIdOrPcid) {
  const c = findPlanCharacterByPresentRef(plan, characterIdOrPcid);
  if (c?.name) return String(c.name);
  const s = String(characterIdOrPcid || "").trim();
  return s || "Personaggio";
}

/**
 * @param {Record<string, unknown>|null|undefined} pcm
 * @param {{ id?: string, pcid?: string }} char
 */
export function pcmRowForCharacter(pcm, char) {
  if (!pcm || typeof pcm !== "object" || !char) return null;
  const k = stableCharacterKey(char);
  const row = (k && pcm[k]) || (char.id && pcm[char.id]);
  return row && typeof row === "object" ? row : null;
}

/**
 * @param {Record<string, unknown>|null|undefined} map
 * @param {{ id?: string, pcid?: string }} char
 */
export function approvalEntryForCharacter(map, char) {
  if (!map || typeof map !== "object" || !char) return undefined;
  const k = stableCharacterKey(char);
  return (k && map[k]) || (char.id != null ? map[char.id] : undefined);
}

/**
 * Voce master: chiave pcid preferita, fallback char.id sulla mappa.
 * @param {Record<string, unknown>|null|undefined} characterVoiceMasters
 * @param {string} characterIdRef — da battuta / UI (pcid o char_N)
 * @param {object|null} [plan]
 */
export function voiceMasterRawForRef(characterVoiceMasters, characterIdRef, plan = null) {
  const vm = characterVoiceMasters && typeof characterVoiceMasters === "object" ? characterVoiceMasters : {};
  const ref = String(characterIdRef || "").trim();
  if (!ref) return undefined;
  const c = plan ? findPlanCharacterByPresentRef(plan, ref) : null;
  if (c) {
    const k = stableCharacterKey(c);
    if (k && vm[k] != null) return vm[k];
  }
  return vm[ref];
}

/**
 * URL master da cache legacy (nome / id / pcid in masterByCharName).
 */
export function resolveMasterUrlForPlanChar(char, masterImages, masterByCharName) {
  if (!char) return null;
  const nk = normCharName(char.name);
  const k = stableCharacterKey(char);
  const mi = masterImages && typeof masterImages === "object" ? masterImages : {};
  const mbn = masterByCharName && typeof masterByCharName === "object" ? masterByCharName : {};
  if (nk && mbn[nk] != null) {
    const ref = String(mbn[nk]).trim();
    if (isHttpUrl(ref)) return ref;
    if (isPcidKey(ref) && mi[ref] != null) return String(mi[ref]).trim();
  }
  if (k && mi[k] != null) return String(mi[k]).trim();
  if (char.id && mi[char.id] != null) return String(mi[char.id]).trim();
  return null;
}

/** @param {{ id?: string, pcid?: string }|null|undefined} char */
export function getDisplayMasterUrl(char, projectCharacterMasters) {
  if (!char) return null;
  const row = pcmRowForCharacter(projectCharacterMasters, char);
  if (row && String(row.masterImageUrl || "").trim()) return String(row.masterImageUrl).trim();
  return null;
}

function normCharName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Mappa ref (present / stable id) → personaggio.
 * @param {object|null} plan
 * @returns {Map<string, object>}
 */
export function planCharacterMapByPresentRef(plan) {
  const m = new Map();
  for (const c of plan?.characters || []) {
    if (!c) continue;
    const id = String(c.id || "").trim();
    const p = String(c.pcid || "").trim();
    if (id) m.set(id, c);
    if (p && p !== id) m.set(p, c);
  }
  return m;
}
