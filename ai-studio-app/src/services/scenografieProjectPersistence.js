/**
 * Persistenza progetti Scenografie — multi-progetto.
 *
 * - Browser: localStorage (indice + un JSON per progetto).
 * - Electron: file JSON in DATA_DIR/scenografia/
 *
 * Migrazione: se esiste il vecchio `active-project-v1.json` e l'indice è vuoto,
 * viene importato come primo progetto.
 */

import {
  clipsReadyForFinalMontage,
  timelineNarrativeApproved,
  normalizeTimelinePlan,
} from "./scenografieVideoWorkflow.js";
import { getCharactersNeedingMaster, resolveItalianPlanLogline } from "./scenografiePlanner.js";

const LS_KEY_LEGACY = "ai-studio-scenografia-project-v1";
const LS_KEY_INDEX = "ai-studio-scenografia-projects-index-v1";
const LS_KEY_PROJECT_PREFIX = "ai-studio-scenografia-project-v1::";

/** @deprecated solo migrazione */
export const SCENOGRAFIA_DISK_FILE = "scenografia/active-project-v1.json";
export const SCENOGRAFIA_INDEX_FILE = "scenografia/projects-index-v1.json";

export const SCENOGRAFIA_PROJECT_VERSION = 1;
export const SCENOGRAFIA_INDEX_VERSION = 1;

/** @typedef {'none'|'production'|'completed'} ScenografiaVideoPhase */

/** Montaggio filmato finale (auto-montaggio) — separato dalla navigazione «Free video». */
/** @typedef {'none'|'assembly'|'done'} ScenografiaFinalMontagePhase */

/**
 * @typedef {'planning'|'character_approval'|'scene_approval'|'clip_approval'|'timeline_approval'|'final_film_ready'|'video_production'|'final_montage'|'completed'} ScenografiaUiStatus
 */

function hasElectronJsonStorage() {
  return (
    typeof window !== "undefined" &&
    window.electronAPI &&
    typeof window.electronAPI.saveJson === "function" &&
    typeof window.electronAPI.loadJson === "function"
  );
}

function normalizeLoadResult(res) {
  if (res == null) return null;
  if (res.success === true && "data" in res) return res.data;
  if (typeof res === "object" && res.data !== undefined) return res.data;
  return res;
}

export function scenografiaProjectFilePath(projectId) {
  return `scenografia/projects/${projectId}.json`;
}

function lsProjectKey(id) {
  return `${LS_KEY_PROJECT_PREFIX}${id}`;
}

/**
 * Stato sintetico per card hub e regole video / montaggio finale.
 * @param {object} d — payload progetto
 * @returns {string}
 */
export function deriveScenografiaUiStatus(d) {
  const fmp = d.finalMontagePhase || "none";
  if (fmp === "done") return "completed";
  if (fmp === "assembly") return "final_montage";

  const vp = d.scenografiaVideoPhase || "none";
  if (vp === "completed") return "completed";
  if (vp === "production") return "video_production";
  if (!d.plan) return "planning";
  const phase = d.scenografiaPhase || "plan";
  if (phase === "plan") return "planning";

  const needMaster = getCharactersNeedingMaster(d.plan);
  const allChars =
    needMaster.length > 0 &&
    needMaster.every((c) => d.characterApprovalMap?.[c.id]?.approved === true && !!d.masterImages?.[c.id]);
  if (!allChars) return "character_approval";
  if (phase === "scene_gen") return "scene_approval";

  const del = new Set(d.deletedSceneIds || []);
  const active = (d.plan.scenes || []).filter((s) => !del.has(s.id));
  if (active.length === 0) return "planning";
  const byId = Object.fromEntries((d.sceneResults || []).map((r) => [r.sceneId, r]));
  const scenesOk = active.every((s) => {
    const r = byId[s.id];
    return r?.imageUrl && r.approved === true;
  });
  if (!scenesOk) return "scene_approval";

  if (!clipsReadyForFinalMontage(d)) return "clip_approval";
  if (!timelineNarrativeApproved(d)) return "timeline_approval";
  return "final_film_ready";
}

export const SCENOGRAFIA_UI_STATUS_LABEL = {
  planning: "In pianificazione",
  character_approval: "Fase 1 · Character approval",
  scene_approval: "Fase 2 · Scene approval",
  clip_approval: "Fase 3 · Video clip approval",
  timeline_approval: "Fase 4 · Timeline / storyboard",
  final_film_ready: "Fase 5 · Pronto per montaggio finale",
  video_ready: "Pronto per video (legacy)",
  video_production: "In produzione video (libero)",
  final_montage: "Montaggio filmato finale",
  completed: "Completato",
};

/**
 * @param {object} data — progetto completo
 * @returns {{ displayTitle: string, characterCount: number, scenesInPlan: number, scenesGenerated: number, clipsCount: number, uiStatus: string }}
 */
export function summarizeScenografiaProjectForIndex(data) {
  const plan = data.plan;
  const del = new Set(data.deletedSceneIds || []);
  const scenesInPlan = plan?.scenes ? plan.scenes.filter((s) => !del.has(s.id)).length : 0;
  const scenesGenerated = Array.isArray(data.sceneResults) ? data.sceneResults.length : 0;
  const characterCount = plan?.characters?.length ?? 0;
  const customTitle =
    typeof data.scenografiaProjectTitle === "string" ? String(data.scenografiaProjectTitle).trim() : "";
  let displayTitle = "Senza titolo";
  if (customTitle) {
    displayTitle = customTitle.slice(0, 80);
  } else {
    const logIt = resolveItalianPlanLogline(plan);
    if (logIt) displayTitle = logIt.slice(0, 80);
    else if (plan?.scenes?.[0]?.title_it) displayTitle = String(plan.scenes[0].title_it).trim();
    else if (typeof data.prompt === "string" && data.prompt.trim()) displayTitle = data.prompt.trim().slice(0, 72);
  }
  const clips = Array.isArray(data.sceneVideoClips) ? data.sceneVideoClips : [];
  const clipsCount = clips.filter((c) => c && c.status !== "deleted").length;

  return {
    displayTitle,
    characterCount,
    scenesInPlan,
    scenesGenerated,
    clipsCount,
    uiStatus: deriveScenografiaUiStatus(data),
  };
}

export function emptyScenografiaProjectPayload() {
  return {
    version: SCENOGRAFIA_PROJECT_VERSION,
    updatedAt: new Date().toISOString(),
    prompt: "",
    scenografiaProjectTitle: "",
    plan: null,
    projectStyle: null,
    projectStyleLocked: false,
    masterImages: {},
    masterByCharName: {},
    sceneResults: [],
    deletedSceneIds: [],
    executionLog: [],
    enableRepair: false,
    selectedSceneIds: [],
    scenografiaPhase: "plan",
    characterApprovalMap: {},
    scenografiaVideoPhase: "none",
    /** Clip video collegati a scene (generazione da collegare al motore). */
    sceneVideoClips: [],
    /** none → assembly (auto-montaggio avviato) → done */
    finalMontagePhase: "none",
    /** Ordine clip + note narrative per il montatore automatico (placeholder). */
    finalMontagePlan: { orderedClipIds: [], orderedTimelineEntryIds: [], narrativeBeatNotes: "" },
    timelinePlan: { approved: false, approvedAt: null, entries: [] },
    runtimeHints: { sceneExecuteMode: "ALL", reuseMastersNext: false },
  };
}

/**
 * @typedef {object} ScenografiaPersistedProject
 * @property {number} version
 * @property {string} updatedAt
 * @property {string} prompt
 * @property {object|null} plan
 * @property {object|null} projectStyle
 * @property {boolean} projectStyleLocked
 * @property {Record<string, string>} masterImages
 * @property {Record<string, string>} masterByCharName
 * @property {Array<{ sceneId: string, title: string, imageUrl: string, approved?: boolean, approvedAt?: string|null, lastEditPrompt?: string|null, editHistory?: Array<{ prompt: string, at: string }>, lastUpdatedAt?: string|null }>} sceneResults
 * @property {string[]|undefined} deletedSceneIds
 * @property {Array<{ time: string, msg: string }>} executionLog
 * @property {boolean} enableRepair
 * @property {string[]} selectedSceneIds
 * @property {{ sceneExecuteMode?: string, reuseMastersNext?: boolean }|undefined} runtimeHints
 * @property {Record<string, { approved: boolean, approvedAt: string|null, version: number }>|undefined} characterApprovalMap
 * @property {string|undefined} scenografiaPhase
 * @property {ScenografiaVideoPhase|undefined} scenografiaVideoPhase
 * @property {Array<{ id: string, sceneId: string, label?: string, videoUrl?: string|null, status: string, sortOrder?: number, lastEditPrompt?: string|null, editHistory?: Array<{ prompt: string, at: string }>, createdAt?: string|null, updatedAt?: string|null, includeInFinal?: boolean }>|undefined} sceneVideoClips
 * @property {'none'|'assembly'|'done'|undefined} finalMontagePhase
 * @property {{ orderedClipIds?: string[], orderedTimelineEntryIds?: string[], narrativeBeatNotes?: string }|undefined} finalMontagePlan
 * @property {{ approved?: boolean, approvedAt?: string|null, entries?: Array<{ id: string, kind: string, sceneId: string, clipId?: string|null, durationSec?: number|null }>}|undefined} timelinePlan
 * @property {string|undefined} scenografiaProjectTitle — nome progetto modificabile dall'utente
 */

/** @returns {Promise<ScenografiaPersistedProject|null>} */
export async function loadScenografiaProject() {
  if (hasElectronJsonStorage()) {
    try {
      const res = await window.electronAPI.loadJson(SCENOGRAFIA_DISK_FILE);
      let data = normalizeLoadResult(res);
      if (data && data.version === SCENOGRAFIA_PROJECT_VERSION) {
        return data;
      }
    } catch {
      /* fall through */
    }
    try {
      const raw = localStorage.getItem(LS_KEY_LEGACY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && data.version === SCENOGRAFIA_PROJECT_VERSION) {
          await saveScenografiaProject(data);
          localStorage.removeItem(LS_KEY_LEGACY);
          return data;
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  try {
    const raw = localStorage.getItem(LS_KEY_LEGACY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== SCENOGRAFIA_PROJECT_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

/** @param {ScenografiaPersistedProject} data */
export async function saveScenografiaProject(data) {
  const payload = {
    ...data,
    version: SCENOGRAFIA_PROJECT_VERSION,
    updatedAt: new Date().toISOString(),
  };
  try {
    if (hasElectronJsonStorage()) {
      const r = await window.electronAPI.saveJson(SCENOGRAFIA_DISK_FILE, payload);
      if (r && r.success === false) {
        console.warn("[SCENOGRAFIE] saveJson:", r.error);
        return false;
      }
      return true;
    }
    localStorage.setItem(LS_KEY_LEGACY, JSON.stringify(payload));
    return true;
  } catch (e) {
    console.warn("[SCENOGRAFIE] Salvataggio fallito:", e?.message || e);
    return false;
  }
}

export async function clearScenografiaProject() {
  try {
    localStorage.removeItem(LS_KEY_LEGACY);
  } catch {
    /* ignore */
  }
  if (hasElectronJsonStorage() && typeof window.electronAPI.deleteJson === "function") {
    try {
      await window.electronAPI.deleteJson(SCENOGRAFIA_DISK_FILE);
    } catch {
      /* ignore */
    }
  }
}

// ─── Multi-progetto ─────────────────────────────────────────

function defaultIndex() {
  return { version: SCENOGRAFIA_INDEX_VERSION, projects: [] };
}

/** @returns {Promise<{ version: number, projects: Array<{ id: string, createdAt: string, updatedAt: string, summary: ReturnType<summarizeScenografiaProjectForIndex> }> }>} */
export async function loadScenografiaProjectsIndex() {
  if (hasElectronJsonStorage()) {
    try {
      const res = await window.electronAPI.loadJson(SCENOGRAFIA_INDEX_FILE);
      const data = normalizeLoadResult(res);
      if (data && data.version === SCENOGRAFIA_INDEX_VERSION && Array.isArray(data.projects)) {
        return data;
      }
    } catch {
      /* empty */
    }
    return defaultIndex();
  }
  try {
    const raw = localStorage.getItem(LS_KEY_INDEX);
    if (!raw) return defaultIndex();
    const data = JSON.parse(raw);
    if (!data || data.version !== SCENOGRAFIA_INDEX_VERSION || !Array.isArray(data.projects)) return defaultIndex();
    return data;
  } catch {
    return defaultIndex();
  }
}

/** @param {{ version: number, projects: object[] }} idx */
export async function saveScenografiaProjectsIndex(idx) {
  const payload = { ...idx, version: SCENOGRAFIA_INDEX_VERSION, updatedAt: new Date().toISOString() };
  try {
    if (hasElectronJsonStorage()) {
      const r = await window.electronAPI.saveJson(SCENOGRAFIA_INDEX_FILE, payload);
      if (r && r.success === false) {
        console.warn("[SCENOGRAFIE] index saveJson:", r.error);
        return false;
      }
      return true;
    }
    localStorage.setItem(LS_KEY_INDEX, JSON.stringify(payload));
    return true;
  } catch (e) {
    console.warn("[SCENOGRAFIE] index save failed:", e?.message || e);
    return false;
  }
}

/** @returns {Promise<ScenografiaPersistedProject|null>} */
export async function loadScenografiaProjectById(projectId) {
  if (!projectId) return null;
  if (hasElectronJsonStorage()) {
    try {
      const res = await window.electronAPI.loadJson(scenografiaProjectFilePath(projectId));
      const data = normalizeLoadResult(res);
      if (data && data.version === SCENOGRAFIA_PROJECT_VERSION) return data;
    } catch {
      /* */
    }
    return null;
  }
  try {
    const raw = localStorage.getItem(lsProjectKey(projectId));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== SCENOGRAFIA_PROJECT_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

/** @param {string} projectId @param {ScenografiaPersistedProject} data */
export async function saveScenografiaProjectById(projectId, data) {
  if (!projectId) return false;
  const payload = {
    ...data,
    version: SCENOGRAFIA_PROJECT_VERSION,
    updatedAt: new Date().toISOString(),
  };
  try {
    if (hasElectronJsonStorage()) {
      const r = await window.electronAPI.saveJson(scenografiaProjectFilePath(projectId), payload);
      if (r && r.success === false) {
        console.warn("[SCENOGRAFIE] project save:", r.error);
        return false;
      }
      return true;
    }
    localStorage.setItem(lsProjectKey(projectId), JSON.stringify(payload));
    return true;
  } catch (e) {
    console.warn("[SCENOGRAFIE] project save failed:", e?.message || e);
    return false;
  }
}

/** @param {string} projectId @param {ScenografiaPersistedProject} projectData */
export async function upsertScenografiaProjectInIndex(projectId, projectData) {
  const idx = await loadScenografiaProjectsIndex();
  const summary = summarizeScenografiaProjectForIndex(projectData);
  const now = new Date().toISOString();
  const i = idx.projects.findIndex((p) => p.id === projectId);
  if (i === -1) {
    idx.projects.unshift({
      id: projectId,
      createdAt: now,
      updatedAt: now,
      summary,
    });
  } else {
    idx.projects[i] = {
      ...idx.projects[i],
      updatedAt: now,
      summary,
    };
  }
  await saveScenografiaProjectsIndex(idx);
}

export function createScenografiaProjectId() {
  return `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/** @param {string} projectId */
export async function deleteScenografiaProjectById(projectId) {
  if (!projectId) return;
  const idx = await loadScenografiaProjectsIndex();
  idx.projects = idx.projects.filter((p) => p.id !== projectId);
  await saveScenografiaProjectsIndex(idx);
  if (hasElectronJsonStorage() && typeof window.electronAPI.deleteJson === "function") {
    try {
      await window.electronAPI.deleteJson(scenografiaProjectFilePath(projectId));
    } catch {
      /* */
    }
  } else {
    try {
      localStorage.removeItem(lsProjectKey(projectId));
    } catch {
      /* */
    }
  }
}

/**
 * Migra active-project legacy → primo elemento indice (una tantum).
 * @returns {Promise<boolean>} true se ha migrato
 */
export async function migrateLegacyScenografiaToMultiIfNeeded() {
  const idx = await loadScenografiaProjectsIndex();
  if (idx.projects.length > 0) return false;
  const legacy = await loadScenografiaProject();
  if (!legacy) return false;
  const id = createScenografiaProjectId();
  const merged = {
    ...legacy,
    scenografiaVideoPhase: legacy.scenografiaVideoPhase || "none",
    sceneVideoClips: Array.isArray(legacy.sceneVideoClips) ? legacy.sceneVideoClips : [],
    finalMontagePhase: legacy.finalMontagePhase || "none",
    finalMontagePlan:
      legacy.finalMontagePlan && typeof legacy.finalMontagePlan === "object"
        ? {
            orderedClipIds: Array.isArray(legacy.finalMontagePlan.orderedClipIds)
              ? legacy.finalMontagePlan.orderedClipIds
              : [],
            orderedTimelineEntryIds: Array.isArray(legacy.finalMontagePlan.orderedTimelineEntryIds)
              ? legacy.finalMontagePlan.orderedTimelineEntryIds
              : [],
            narrativeBeatNotes:
              typeof legacy.finalMontagePlan.narrativeBeatNotes === "string"
                ? legacy.finalMontagePlan.narrativeBeatNotes
                : "",
          }
        : { orderedClipIds: [], orderedTimelineEntryIds: [], narrativeBeatNotes: "" },
    timelinePlan: normalizeTimelinePlan(legacy.timelinePlan),
    scenografiaProjectTitle:
      typeof legacy.scenografiaProjectTitle === "string" ? legacy.scenografiaProjectTitle : "",
  };
  await saveScenografiaProjectById(id, merged);
  await upsertScenografiaProjectInIndex(id, merged);
  await clearScenografiaProject();
  return true;
}
