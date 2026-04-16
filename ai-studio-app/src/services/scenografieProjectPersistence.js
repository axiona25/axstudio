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
import { PROJECT_POSTER_STATUS } from "./scenografieProjectPoster.js";
import { pickChapterRepresentativeThumbnailUrl } from "./scenografieChapterCover.js";

const LS_KEY_LEGACY = "ai-studio-scenografia-project-v1";
const LS_KEY_INDEX = "ai-studio-scenografia-projects-index-v1";
const LS_KEY_PROJECT_PREFIX = "ai-studio-scenografia-project-v1::";

/** @deprecated solo migrazione */
export const SCENOGRAFIA_DISK_FILE = "scenografia/active-project-v1.json";
export const SCENOGRAFIA_INDEX_FILE = "scenografia/projects-index-v1.json";

export const SCENOGRAFIA_PROJECT_VERSION = 1;
export const SCENOGRAFIA_INDEX_VERSION = 1;
/** File root: workspace narrativo (progetto → capitoli → payload editor per capitolo). */
export const SCENOGRAFIA_WORKSPACE_VERSION = 2;

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

/** Master confermato esplicitamente dall'utente come canonico (non sovrascritto da migrazione / piano). */
export const PCM_SOURCE_USER_CANONICAL_LOCK = "user_canonical_lock";

/**
 * Personaggio pronto per pipeline scene: URL, approvazione, niente revisione pendente e **conferma canonica esplicita**
 * (`source === user_canonical_lock`).
 * @param {{ id: string }} char
 * @param {object} d — payload capitolo (plan, projectCharacterMasters, characterApprovalMap)
 */
export function characterMasterReadyForScenes(char, d) {
  const row = d.projectCharacterMasters?.[char.id];
  const url = row?.masterImageUrl ? String(row.masterImageUrl).trim() : "";
  if (!url) return false;
  if (row.pendingManualReview === true) return false;
  if (d.characterApprovalMap?.[char.id]?.approved !== true) return false;
  if (row.source !== PCM_SOURCE_USER_CANONICAL_LOCK) return false;
  return true;
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
    needMaster.length === 0 || needMaster.every((c) => characterMasterReadyForScenes(c, d));
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
  clip_approval: "Revisione clip",
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

/** Secondi video stimati da timeline (durate voce). */
export function estimateChapterVideoSeconds(chapterData) {
  const d = chapterData || {};
  let sec = 0;
  const entries = d.timelinePlan?.entries || [];
  for (const e of entries) {
    if (typeof e?.durationSec === "number" && Number.isFinite(e.durationSec) && e.durationSec > 0) sec += e.durationSec;
  }
  return Math.round(sec * 10) / 10;
}

/** Metriche per card capitolo nella hub capitoli. */
export function summarizeChapterHubCard(chapterData, workspaceForCharacterPool = null) {
  const merged =
    workspaceForCharacterPool && typeof workspaceForCharacterPool === "object"
      ? mergeChapterDataWithProjectCharacterPool(chapterData || {}, workspaceForCharacterPool)
      : chapterData || {};
  const s = summarizeScenografiaProjectForIndex(merged);
  return {
    ...s,
    videoSecondsApprox: estimateChapterVideoSeconds(chapterData),
  };
}

/** Indice griglia Progetti (workspace). */
export function summarizeScenografiaWorkspaceForIndex(ws) {
  const w = ensureWorkspace(ws);
  if (!w) {
    return {
      displayTitle: "Senza titolo",
      chaptersCount: 0,
      posterImageUrl: null,
      posterGenerationStatus: "none",
      projectPosterStatus: PROJECT_POSTER_STATUS.NONE,
      uiStatus: "planning",
      characterCount: 0,
      scenesGenerated: 0,
      scenesInPlan: 0,
      clipsCount: 0,
    };
  }
  const chapters = [...w.chapters].sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.id).localeCompare(String(b.id)));
  const nt = String(w.projectTitle || w.narrativeProjectTitle || "").trim();
  let displayTitle = nt;
  const first = chapters[0]?.data;
  if (!displayTitle && first) {
    displayTitle = summarizeScenografiaProjectForIndex(first).displayTitle;
  }
  if (!displayTitle) displayTitle = "Senza titolo";

  let characterCount = 0;
  let scenesGenerated = 0;
  let scenesInPlan = 0;
  let clipsCount = 0;
  for (const ch of chapters) {
    const sum = summarizeScenografiaProjectForIndex(ch.data || {});
    characterCount += sum.characterCount || 0;
    scenesGenerated += sum.scenesGenerated || 0;
    scenesInPlan += sum.scenesInPlan || 0;
    clipsCount += sum.clipsCount || 0;
  }

  let posterImageUrl =
    (typeof w.projectPosterUrl === "string" && w.projectPosterUrl.trim()) ||
    (typeof w.posterImageUrl === "string" && w.posterImageUrl.trim()) ||
    null;
  const pstRaw = String(w.projectPosterStatus || w.posterGenerationStatus || "").trim();
  if (
    !posterImageUrl &&
    (!pstRaw || pstRaw === PROJECT_POSTER_STATUS.NONE || pstRaw === "none") &&
    !w.projectPosterPrompt
  ) {
    posterImageUrl = pickPosterFallbackFromChapters(chapters, w) || null;
  }

  const posterGenerationStatus =
    typeof w.projectPosterStatus === "string" && w.projectPosterStatus.trim()
      ? w.projectPosterStatus.trim()
      : typeof w.posterGenerationStatus === "string" && w.posterGenerationStatus.trim()
        ? w.posterGenerationStatus.trim()
        : posterImageUrl
          ? "ready"
          : "none";

  const uiStatus = first ? deriveScenografiaUiStatus(first) : "planning";

  return {
    displayTitle,
    chaptersCount: chapters.length,
    posterImageUrl,
    projectPosterUrl: posterImageUrl,
    posterGenerationStatus,
    projectPosterStatus: posterGenerationStatus,
    uiStatus,
    characterCount,
    scenesGenerated,
    scenesInPlan,
    clipsCount,
    projectPosterOutdated: w.projectPosterOutdated === true,
  };
}

export function createChapterId() {
  return `ch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * @param {object|null} loaded
 * @returns {boolean}
 */
export function isWorkspacePayload(loaded) {
  return (
    !!loaded &&
    loaded.workspaceVersion === SCENOGRAFIA_WORKSPACE_VERSION &&
    Array.isArray(loaded.chapters) &&
    loaded.chapters.length > 0
  );
}

/** Master / approval personaggi condivisi tra tutti i capitoli del workspace. */
function ensureProjectCharacterPool(ws) {
  if (!ws || typeof ws !== "object") return;
  if (!ws.projectMasterImages || typeof ws.projectMasterImages !== "object") ws.projectMasterImages = {};
  if (!ws.projectMasterByCharName || typeof ws.projectMasterByCharName !== "object") ws.projectMasterByCharName = {};
  if (!ws.projectCharacterApprovalMap || typeof ws.projectCharacterApprovalMap !== "object") {
    ws.projectCharacterApprovalMap = {};
  }
  if (!ws.projectCharacterMasters || typeof ws.projectCharacterMasters !== "object") ws.projectCharacterMasters = {};
}

function liftMastersFromChaptersToProjectWorkspace(ws) {
  if (!isWorkspacePayload(ws)) return;
  ensureProjectCharacterPool(ws);
  for (const ch of ws.chapters) {
    const data = ch?.data;
    if (!data || typeof data !== "object") continue;
    if (data.masterImages && typeof data.masterImages === "object") {
      Object.assign(ws.projectMasterImages, data.masterImages);
    }
    if (data.masterByCharName && typeof data.masterByCharName === "object") {
      Object.assign(ws.projectMasterByCharName, data.masterByCharName);
    }
    if (data.characterApprovalMap && typeof data.characterApprovalMap === "object") {
      Object.assign(ws.projectCharacterApprovalMap, data.characterApprovalMap);
    }
    if (data.projectCharacterMasters && typeof data.projectCharacterMasters === "object") {
      Object.assign(ws.projectCharacterMasters, data.projectCharacterMasters);
    }
  }
}

function normCharNameForMasterPool(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Allinea `masterImages[id]` con `masterByCharName[nome]` per il cast del piano.
 * In conflitto vince il pool per nome (chiave stabile); i merge multi-capitolo possono aver lasciato id incrociati.
 * @returns {{ masterImages: Record<string,string>, masterByCharName: Record<string,string>, mismatches: object[] }}
 */
export function reconcileCharacterMasterMaps(plan, masterImages, masterByCharName) {
  const mi = { ...(masterImages && typeof masterImages === "object" ? masterImages : {}) };
  const mbn = { ...(masterByCharName && typeof masterByCharName === "object" ? masterByCharName : {}) };
  const mismatches = [];
  for (const c of plan?.characters || []) {
    if (!c?.id) continue;
    const nk = normCharNameForMasterPool(c.name);
    const byId = mi[c.id] ? String(mi[c.id]).trim() : "";
    const byName = nk && mbn[nk] ? String(mbn[nk]).trim() : "";
    if (byId && byName && byId !== byName) {
      mismatches.push({
        characterId: c.id,
        characterName: c.name,
        masterImagesUrl: byId,
        masterByCharNameKey: nk,
        masterByCharNameUrl: byName,
        fix: "id_map_overwritten_from_name_pool",
      });
      mi[c.id] = byName;
    } else if (byId && !byName && nk) {
      mbn[nk] = byId;
    } else if (!byId && byName) {
      mi[c.id] = byName;
    }
  }
  return { masterImages: mi, masterByCharName: mbn, mismatches };
}

/**
 * Sorgente canonica unica per personaggio (id piano): costruita da legacy se assente.
 * `pendingManualReview` = true quando id e nome concordavano sullo stesso URL (possibile errore condiviso) o solo id.
 * @returns {Record<string, { characterId: string, characterName: string, masterImageUrl: string, approved: boolean, updatedAt: string, source: string, pendingManualReview: boolean, characterMasterPrompt?: string, lastCharacterRegenerationPrompt?: string, characterPromptHistory?: { prompt: string, at: string }[], priorMasterImageUrls?: string[] }>}
 */
export function migrateLegacyToProjectCharacterMasters(plan, masterImages, masterByCharName, characterApprovalMap) {
  const out = {};
  const mi = masterImages && typeof masterImages === "object" ? masterImages : {};
  const mbn = masterByCharName && typeof masterByCharName === "object" ? masterByCharName : {};
  const cap = characterApprovalMap && typeof characterApprovalMap === "object" ? characterApprovalMap : {};
  const now = new Date().toISOString();
  for (const c of plan?.characters || []) {
    if (!c?.id) continue;
    const nk = normCharNameForMasterPool(c.name);
    const byId = mi[c.id] ? String(mi[c.id]).trim() : "";
    const byName = nk && mbn[nk] ? String(mbn[nk]).trim() : "";
    let url = "";
    let source = "none";
    let pendingManualReview = false;
    if (byId && byName) {
      if (byId === byName) {
        url = byId;
        source = "migrated_id_and_name_same_url";
        pendingManualReview = true;
      } else {
        url = byName;
        source = "migrated_reconciled_prefer_name";
        pendingManualReview = true;
      }
    } else if (byName) {
      url = byName;
      source = "migrated_name_only";
    } else if (byId) {
      url = byId;
      source = "migrated_id_only";
      pendingManualReview = true;
    }
    if (!url) continue;
    const ap = cap[c.id];
    out[c.id] = {
      characterId: c.id,
      characterName: c.name,
      masterImageUrl: url,
      approved: ap?.approved === true,
      updatedAt: now,
      source,
      pendingManualReview,
    };
  }
  return out;
}

/**
 * Aggiorna `projectCharacterMasters` dopo riconciliazione delle mappe legacy.
 * Preserva righe con `source === user_canonical_lock` (URL scelto dall'utente).
 */
export function mergeProjectCharacterMastersFromLegacy(plan, prevPcm, masterImages, masterByCharName, characterApprovalMap) {
  const filled = migrateLegacyToProjectCharacterMasters(plan, masterImages, masterByCharName, characterApprovalMap);
  const next = { ...(prevPcm && typeof prevPcm === "object" ? prevPcm : {}) };
  const charIds = new Set((plan?.characters || []).map((c) => c.id).filter(Boolean));
  for (const k of Object.keys(next)) {
    if (!charIds.has(k)) delete next[k];
  }
  for (const id of charIds) {
    const cur = next[id];
    if (cur?.source === PCM_SOURCE_USER_CANONICAL_LOCK) {
      const ch = (plan.characters || []).find((c) => c.id === id);
      if (ch && cur.characterName !== ch.name) {
        next[id] = { ...cur, characterName: ch.name, updatedAt: new Date().toISOString() };
      }
      continue;
    }
    if (filled[id]) {
      const merged = { ...filled[id] };
      if (cur) {
        if (typeof cur.characterMasterPrompt === "string" && cur.characterMasterPrompt.trim()) {
          merged.characterMasterPrompt = cur.characterMasterPrompt;
        }
        if (typeof cur.lastCharacterRegenerationPrompt === "string" && cur.lastCharacterRegenerationPrompt.trim()) {
          merged.lastCharacterRegenerationPrompt = cur.lastCharacterRegenerationPrompt;
        }
        if (Array.isArray(cur.characterPromptHistory) && cur.characterPromptHistory.length) {
          merged.characterPromptHistory = cur.characterPromptHistory;
        }
        if (Array.isArray(cur.priorMasterImageUrls) && cur.priorMasterImageUrls.length) {
          merged.priorMasterImageUrls = [...cur.priorMasterImageUrls].slice(0, 24);
        }
      }
      next[id] = merged;
    } else delete next[id];
  }
  return next;
}

/**
 * Deriva `masterImages` / `masterByCharName` dalla mappa canonica (cache salvabile, non fonte di verità).
 */
export function syncLegacyMapsFromCanonicalPlan(plan, projectCharacterMasters) {
  const pcm = projectCharacterMasters && typeof projectCharacterMasters === "object" ? projectCharacterMasters : {};
  const mi = {};
  const mbn = {};
  for (const c of plan?.characters || []) {
    if (!c?.id) continue;
    const row = pcm[c.id];
    const u = row?.masterImageUrl ? String(row.masterImageUrl).trim() : "";
    if (!u) continue;
    mi[c.id] = u;
    const nk = normCharNameForMasterPool(c.name);
    if (nk) mbn[nk] = u;
  }
  return { masterImages: mi, masterByCharName: mbn };
}

/**
 * Unisce i master salvati a livello progetto nel payload capitolo (il pool vince sui duplicati).
 * @param {object} chapterData
 * @param {object|null} workspace
 */
export function mergeChapterDataWithProjectCharacterPool(chapterData, workspace) {
  const d = chapterData && typeof chapterData === "object" ? chapterData : {};
  if (!workspace || typeof workspace !== "object") return { ...d };
  const pm = workspace.projectMasterImages && typeof workspace.projectMasterImages === "object" ? workspace.projectMasterImages : {};
  const pbn = workspace.projectMasterByCharName && typeof workspace.projectMasterByCharName === "object" ? workspace.projectMasterByCharName : {};
  const pam =
    workspace.projectCharacterApprovalMap && typeof workspace.projectCharacterApprovalMap === "object"
      ? workspace.projectCharacterApprovalMap
      : {};
  const pcmChapter = d.projectCharacterMasters && typeof d.projectCharacterMasters === "object" ? d.projectCharacterMasters : {};
  const pcmPool =
    workspace.projectCharacterMasters && typeof workspace.projectCharacterMasters === "object"
      ? workspace.projectCharacterMasters
      : {};
  const merged = {
    ...d,
    masterImages: { ...(d.masterImages || {}), ...pm },
    masterByCharName: { ...(d.masterByCharName || {}), ...pbn },
    characterApprovalMap: { ...(d.characterApprovalMap || {}), ...pam },
    projectCharacterMasters: { ...pcmChapter, ...pcmPool },
  };
  if (merged.plan?.characters?.length) {
    const r = reconcileCharacterMasterMaps(merged.plan, merged.masterImages, merged.masterByCharName);
    merged.masterImages = r.masterImages;
    merged.masterByCharName = r.masterByCharName;
    if (r.mismatches.length) {
      console.warn("[SCENOGRAFIE merge chapter+pool] master riallineati:\n" + JSON.stringify(r.mismatches, null, 2));
    }
    const filled = migrateLegacyToProjectCharacterMasters(
      merged.plan,
      merged.masterImages,
      merged.masterByCharName,
      merged.characterApprovalMap,
    );
    const mergedPcm = { ...(merged.projectCharacterMasters || {}) };
    for (const c of merged.plan.characters) {
      if (!c?.id) continue;
      const cur = mergedPcm[c.id];
      const hasUrl = cur && String(cur.masterImageUrl || "").trim();
      if (!hasUrl && filled[c.id]) mergedPcm[c.id] = filled[c.id];
    }
    merged.projectCharacterMasters = mergedPcm;
  }
  return merged;
}

/**
 * Piano legacy (un solo blocco) → workspace con un capitolo che contiene quel blocco.
 * @param {object} flat
 * @returns {object}
 */
export function migrateFlatToWorkspace(flat) {
  if (!flat || typeof flat !== "object") return flat;
  if (isWorkspacePayload(flat)) return flat;
  const inner = JSON.parse(JSON.stringify(flat));
  if (inner.plan?.characters?.length) {
    const r = reconcileCharacterMasterMaps(inner.plan, inner.masterImages || {}, inner.masterByCharName || {});
    inner.masterImages = r.masterImages;
    inner.masterByCharName = r.masterByCharName;
    inner.projectCharacterMasters = migrateLegacyToProjectCharacterMasters(
      inner.plan,
      inner.masterImages,
      inner.masterByCharName,
      inner.characterApprovalMap || {},
    );
  }
  const innerTitle = String(inner.scenografiaProjectTitle || inner.projectTitle || "").trim();
  const innerDesc = String(
    inner.narrativeProjectDescription || inner.projectDescription || inner.prompt || ""
  ).trim();
  return {
    workspaceVersion: SCENOGRAFIA_WORKSPACE_VERSION,
    version: SCENOGRAFIA_PROJECT_VERSION,
    createdAt: inner.createdAt || inner.updatedAt || new Date().toISOString(),
    updatedAt: inner.updatedAt || new Date().toISOString(),
    narrativeProjectTitle: innerTitle,
    narrativeProjectDescription: innerDesc,
    projectTitle: innerTitle,
    projectDescription: innerDesc,
    globalProjectStyle: inner.globalProjectStyle && typeof inner.globalProjectStyle === "object" ? inner.globalProjectStyle : null,
    posterImageUrl:
      typeof inner.posterImageUrl === "string" && inner.posterImageUrl.trim()
        ? inner.posterImageUrl.trim()
        : typeof inner.projectPosterUrl === "string" && inner.projectPosterUrl.trim()
          ? inner.projectPosterUrl.trim()
          : null,
    projectPosterUrl:
      typeof inner.projectPosterUrl === "string" && inner.projectPosterUrl.trim()
        ? inner.projectPosterUrl.trim()
        : typeof inner.posterImageUrl === "string" && inner.posterImageUrl.trim()
          ? inner.posterImageUrl.trim()
          : null,
    posterGenerationStatus:
      inner.projectPosterStatus ||
      inner.posterGenerationStatus ||
      (inner.posterImageUrl || inner.projectPosterUrl ? "ready" : "none"),
    projectPosterStatus:
      inner.projectPosterStatus ||
      inner.posterGenerationStatus ||
      (inner.posterImageUrl || inner.projectPosterUrl ? PROJECT_POSTER_STATUS.READY : PROJECT_POSTER_STATUS.NONE),
    projectPosterPrompt: typeof inner.projectPosterPrompt === "string" ? inner.projectPosterPrompt : null,
    projectPosterStyle:
      inner.projectPosterStyle && typeof inner.projectPosterStyle === "object" ? inner.projectPosterStyle : null,
    projectPosterMetadata:
      inner.projectPosterMetadata && typeof inner.projectPosterMetadata === "object" ? inner.projectPosterMetadata : null,
    projectPosterUpdatedAt: inner.projectPosterUpdatedAt || null,
    projectPosterOutdated: inner.projectPosterOutdated === true,
    chapters: [
      {
        id: createChapterId(),
        sortOrder: 0,
        chapterTitle: "",
        data: inner,
      },
    ],
    projectMasterImages: inner.masterImages && typeof inner.masterImages === "object" ? { ...inner.masterImages } : {},
    projectMasterByCharName:
      inner.masterByCharName && typeof inner.masterByCharName === "object" ? { ...inner.masterByCharName } : {},
    projectCharacterApprovalMap:
      inner.characterApprovalMap && typeof inner.characterApprovalMap === "object"
        ? { ...inner.characterApprovalMap }
        : {},
    projectCharacterMasters:
      inner.plan?.characters?.length
        ? migrateLegacyToProjectCharacterMasters(
            inner.plan,
            inner.masterImages || {},
            inner.masterByCharName || {},
            inner.characterApprovalMap || {},
          )
        : {},
  };
}

/** @param {object|null} loaded */
export function ensureWorkspace(loaded) {
  if (!loaded) return null;
  if (isWorkspacePayload(loaded)) {
    normalizeChapterSortOrders(loaded);
    if (loaded.narrativeProjectDescription == null) loaded.narrativeProjectDescription = "";
    if (loaded.projectTitle == null && loaded.narrativeProjectTitle) {
      loaded.projectTitle = String(loaded.narrativeProjectTitle).trim();
    }
    if (loaded.narrativeProjectTitle == null && loaded.projectTitle) {
      loaded.narrativeProjectTitle = String(loaded.projectTitle).trim();
    }
    if (loaded.projectDescription == null && loaded.narrativeProjectDescription != null) {
      loaded.projectDescription = String(loaded.narrativeProjectDescription);
    }
    if (loaded.narrativeProjectDescription == null && loaded.projectDescription != null) {
      loaded.narrativeProjectDescription = String(loaded.projectDescription);
    }
    if (!loaded.createdAt) loaded.createdAt = loaded.updatedAt || new Date().toISOString();
    if (!loaded.posterGenerationStatus) {
      loaded.posterGenerationStatus =
        loaded.projectPosterStatus ||
        (loaded.posterImageUrl || loaded.projectPosterUrl ? "ready" : "none");
    }
    if (!loaded.projectPosterStatus) {
      const g = String(loaded.posterGenerationStatus || "").trim();
      if (g === "ready") loaded.projectPosterStatus = PROJECT_POSTER_STATUS.READY;
      else if (g === "failed") loaded.projectPosterStatus = PROJECT_POSTER_STATUS.FAILED;
      else if (g === "pending") loaded.projectPosterStatus = PROJECT_POSTER_STATUS.PENDING;
      else if (g === "generating") loaded.projectPosterStatus = PROJECT_POSTER_STATUS.GENERATING;
      else loaded.projectPosterStatus = loaded.posterImageUrl || loaded.projectPosterUrl ? PROJECT_POSTER_STATUS.READY : PROJECT_POSTER_STATUS.NONE;
    }
    if (loaded.projectPosterStatus && !loaded.posterGenerationStatus) {
      loaded.posterGenerationStatus = loaded.projectPosterStatus;
    }
    if (loaded.posterImageUrl && !loaded.projectPosterUrl) loaded.projectPosterUrl = loaded.posterImageUrl;
    if (loaded.projectPosterUrl && !loaded.posterImageUrl) loaded.posterImageUrl = loaded.projectPosterUrl;
    if (loaded.projectPosterPrompt == null) loaded.projectPosterPrompt = null;
    if (loaded.projectPosterStyle == null) loaded.projectPosterStyle = null;
    if (loaded.projectPosterMetadata == null) loaded.projectPosterMetadata = null;
    if (loaded.projectPosterUpdatedAt == null) loaded.projectPosterUpdatedAt = null;
    if (loaded.projectPosterOutdated == null) loaded.projectPosterOutdated = false;
    ensureProjectCharacterPool(loaded);
    for (const ch of loaded.chapters || []) {
      const data = ch?.data;
      const plan = data?.plan;
      if (!data || !plan?.characters?.length) continue;
      const r = reconcileCharacterMasterMaps(plan, data.masterImages || {}, data.masterByCharName || {});
      data.masterImages = r.masterImages;
      data.masterByCharName = r.masterByCharName;
      if (r.mismatches.length) {
        console.warn("[SCENOGRAFIE workspace load] master id/nome riallineati:\n" + JSON.stringify(r.mismatches, null, 2));
      }
      const filled = migrateLegacyToProjectCharacterMasters(
        plan,
        data.masterImages || {},
        data.masterByCharName || {},
        data.characterApprovalMap || {},
      );
      const existingPcm = data.projectCharacterMasters && typeof data.projectCharacterMasters === "object" ? data.projectCharacterMasters : {};
      const nextPcm = { ...existingPcm };
      for (const c of plan.characters) {
        if (!c?.id) continue;
        if (!nextPcm[c.id]?.masterImageUrl?.trim() && filled[c.id]) nextPcm[c.id] = filled[c.id];
      }
      data.projectCharacterMasters = nextPcm;
    }
    liftMastersFromChaptersToProjectWorkspace(loaded);
    return loaded;
  }
  if (loaded.version === SCENOGRAFIA_PROJECT_VERSION) {
    return migrateFlatToWorkspace(loaded);
  }
  return null;
}

export function normalizeChapterSortOrders(ws) {
  if (!ws?.chapters?.length) return ws;
  const sorted = [...ws.chapters].sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.id).localeCompare(String(b.id)));
  sorted.forEach((c, i) => {
    c.sortOrder = i;
  });
  ws.chapters = sorted;
  return ws;
}

/**
 * Fallback locandina workspace quando non c'è poster dedicato: per ogni capitolo usa la stessa euristica della cover capitolo.
 * @param {object[]} chapters
 * @param {object|null} [ws]
 */
function pickPosterFallbackFromChapters(chapters, ws = null) {
  const list = Array.isArray(chapters) ? chapters : [];
  const sorted = [...list].sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.id).localeCompare(String(b.id)));
  const wt = ws ? String(ws.narrativeProjectTitle || ws.projectTitle || "").trim() : "";
  const wd = ws ? String(ws.narrativeProjectDescription || ws.projectDescription || "").trim() : "";
  for (let i = 0; i < sorted.length; i++) {
    const ch = sorted[i];
    const u = pickChapterRepresentativeThumbnailUrl(ch?.data || {}, {
      chapterOrdinal: i + 1,
      chapterTitle: ch?.chapterTitle,
      workspaceTitle: wt,
      workspaceDescription: wd,
    });
    if (u) return u;
  }
  return null;
}

/**
 * Miniatura capitolo (delega a logica narrativa dedicata in scenografieChapterCover.js).
 * @param {object} chapterData
 * @param {{ chapterOrdinal?: number, chapterTitle?: string, workspaceTitle?: string, workspaceDescription?: string }} [ctx]
 */
export function pickChapterPosterThumbnailUrl(chapterData, ctx) {
  return pickChapterRepresentativeThumbnailUrl(chapterData, ctx || {});
}

export { pickChapterRepresentativeThumbnailUrl } from "./scenografieChapterCover.js";

/**
 * Workspace vuoto: un capitolo con payload editor standard.
 * @returns {object}
 */
export function emptyScenografiaWorkspace() {
  const now = new Date().toISOString();
  return {
    workspaceVersion: SCENOGRAFIA_WORKSPACE_VERSION,
    version: SCENOGRAFIA_PROJECT_VERSION,
    createdAt: now,
    updatedAt: now,
    narrativeProjectTitle: "",
    narrativeProjectDescription: "",
    projectTitle: "",
    projectDescription: "",
    globalProjectStyle: null,
    posterImageUrl: null,
    projectPosterUrl: null,
    posterGenerationStatus: "none",
    projectPosterStatus: PROJECT_POSTER_STATUS.NONE,
    projectPosterPrompt: null,
    projectPosterStyle: null,
    projectPosterMetadata: null,
    projectPosterUpdatedAt: null,
    projectPosterOutdated: false,
    projectMasterImages: {},
    projectMasterByCharName: {},
    projectCharacterApprovalMap: {},
    projectCharacterMasters: {},
    chapters: [
      {
        id: createChapterId(),
        sortOrder: 0,
        chapterTitle: "",
        data: emptyScenografiaProjectPayload(),
      },
    ],
  };
}

/**
 * Workspace iniziale da creazione guidata (titolo, descrizione, stile globale).
 * @param {{ title: string, description: string, projectStyle: object|null }} opts
 */
export function buildScenografiaWorkspaceFromWizard({ title, description, projectStyle }) {
  const now = new Date().toISOString();
  const t = String(title || "").trim();
  const d = String(description || "").trim();
  const ps = projectStyle && typeof projectStyle === "object" ? { ...projectStyle } : null;
  const chapterPayload = {
    ...emptyScenografiaProjectPayload(),
    prompt: d,
    scenografiaProjectTitle: t,
    projectStyle: ps,
    projectStyleLocked: true,
    updatedAt: now,
  };
  return {
    workspaceVersion: SCENOGRAFIA_WORKSPACE_VERSION,
    version: SCENOGRAFIA_PROJECT_VERSION,
    createdAt: now,
    updatedAt: now,
    narrativeProjectTitle: t,
    narrativeProjectDescription: d,
    projectTitle: t,
    projectDescription: d,
    globalProjectStyle: ps,
    posterImageUrl: null,
    projectPosterUrl: null,
    posterGenerationStatus: PROJECT_POSTER_STATUS.PENDING,
    projectPosterStatus: PROJECT_POSTER_STATUS.PENDING,
    projectPosterPrompt: null,
    projectPosterStyle: ps
      ? { presetId: ps.presetId, label: ps.label, isAnimated: ps.isAnimated === true }
      : null,
    projectPosterMetadata: null,
    projectPosterUpdatedAt: null,
    projectPosterOutdated: false,
    projectMasterImages: {},
    projectMasterByCharName: {},
    projectCharacterApprovalMap: {},
    projectCharacterMasters: {},
    chapters: [
      {
        id: createChapterId(),
        sortOrder: 0,
        chapterTitle: "",
        data: chapterPayload,
      },
    ],
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
    /** Fonte canonica master personaggio (id piano). */
    projectCharacterMasters: {},
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
    /** Voice master per personaggio (ElevenLabs / meta). */
    characterVoiceMasters: {},
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
      if (data && (data.workspaceVersion === SCENOGRAFIA_WORKSPACE_VERSION || data.version === SCENOGRAFIA_PROJECT_VERSION)) {
        return ensureWorkspace(data);
      }
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
    return ensureWorkspace(data);
  } catch {
    return null;
  }
}

/** @param {string} projectId @param {ScenografiaPersistedProject} data */
/**
 * Aggiorna il payload editor di un capitolo nel workspace (clone sicuro).
 * @param {object} workspace
 * @param {string} chapterId
 * @param {object} chapterPayload
 */
export function upsertChapterDataInWorkspace(workspace, chapterId, chapterPayload) {
  const w = JSON.parse(JSON.stringify(workspace));
  if (!isWorkspacePayload(w)) throw new Error("Workspace non valido");
  const i = w.chapters.findIndex((c) => c.id === chapterId);
  if (i === -1) throw new Error("Capitolo non trovato");
  w.chapters[i].data = { ...chapterPayload, version: SCENOGRAFIA_PROJECT_VERSION };
  ensureProjectCharacterPool(w);
  if (chapterPayload.masterImages && typeof chapterPayload.masterImages === "object") {
    w.projectMasterImages = { ...(w.projectMasterImages || {}), ...chapterPayload.masterImages };
  }
  if (chapterPayload.masterByCharName && typeof chapterPayload.masterByCharName === "object") {
    w.projectMasterByCharName = { ...(w.projectMasterByCharName || {}), ...chapterPayload.masterByCharName };
  }
  if (chapterPayload.characterApprovalMap && typeof chapterPayload.characterApprovalMap === "object") {
    w.projectCharacterApprovalMap = {
      ...(w.projectCharacterApprovalMap || {}),
      ...chapterPayload.characterApprovalMap,
    };
  }
  if (chapterPayload.projectCharacterMasters && typeof chapterPayload.projectCharacterMasters === "object") {
    w.projectCharacterMasters = { ...(w.projectCharacterMasters || {}), ...chapterPayload.projectCharacterMasters };
  }
  normalizeChapterSortOrders(w);
  return w;
}

export async function saveScenografiaProjectById(projectId, data) {
  if (!projectId) return false;
  const base = isWorkspacePayload(data) ? JSON.parse(JSON.stringify(data)) : migrateFlatToWorkspace(data);
  const existing = await loadScenografiaProjectById(projectId);
  const existingWs = existing && ensureWorkspace(existing);
  const now = new Date().toISOString();
  const payload = {
    ...base,
    version: SCENOGRAFIA_PROJECT_VERSION,
    createdAt: base.createdAt || existingWs?.createdAt || now,
    updatedAt: now,
  };
  if (isWorkspacePayload(payload)) {
    normalizeChapterSortOrders(payload);
  }
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
  const ws = ensureWorkspace(projectData);
  const summary = summarizeScenografiaWorkspaceForIndex(ws || projectData);
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
    characterVoiceMasters:
      legacy.characterVoiceMasters && typeof legacy.characterVoiceMasters === "object"
        ? legacy.characterVoiceMasters
        : {},
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
  const ws = migrateFlatToWorkspace(merged);
  await saveScenografiaProjectById(id, ws);
  await upsertScenografiaProjectInIndex(id, ws);
  await clearScenografiaProject();
  return true;
}
