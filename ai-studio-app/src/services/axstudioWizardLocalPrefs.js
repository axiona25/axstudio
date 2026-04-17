/**
 * Preferenze wizard / copilota — solo locale (nessun vincolo sul payload capitolo).
 */

const STORAGE_VERSION = 1;
const PREFIX = "axstudio-editor-wizard";

/**
 * @typedef {{
 *   v: number,
 *   activeStepId?: string,
 *   guidedMode?: boolean,
 *   renderIntentId?: string,
 *   guidedSubmode?: string,
 *   audioMode?: string,
 * }} AxstudioWizardLocalPrefs
 */

/**
 * @param {string|null|undefined} projectId
 * @param {string|null|undefined} chapterId
 */
export function wizardPrefsStorageKey(projectId, chapterId) {
  const p = projectId != null ? String(projectId).trim() : "none";
  const c = chapterId != null ? String(chapterId).trim() : "none";
  return `${PREFIX}-v${STORAGE_VERSION}::${p}::${c}`;
}

/**
 * @param {string|null|undefined} projectId
 * @param {string|null|undefined} chapterId
 * @returns {AxstudioWizardLocalPrefs}
 */
export function loadWizardPrefs(projectId, chapterId) {
  if (typeof localStorage === "undefined") return { v: STORAGE_VERSION };
  try {
    const raw = localStorage.getItem(wizardPrefsStorageKey(projectId, chapterId));
    if (!raw) return { v: STORAGE_VERSION };
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return { v: STORAGE_VERSION };
    return { v: STORAGE_VERSION, ...o };
  } catch {
    return { v: STORAGE_VERSION };
  }
}

/**
 * @param {string|null|undefined} projectId
 * @param {string|null|undefined} chapterId
 * @param {Partial<AxstudioWizardLocalPrefs>} partial
 */
export function saveWizardPrefs(projectId, chapterId, partial) {
  if (typeof localStorage === "undefined") return;
  try {
    const prev = loadWizardPrefs(projectId, chapterId);
    const next = { ...prev, ...partial, v: STORAGE_VERSION };
    localStorage.setItem(wizardPrefsStorageKey(projectId, chapterId), JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}
