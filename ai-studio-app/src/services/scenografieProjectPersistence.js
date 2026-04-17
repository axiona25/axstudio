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
import { pcmRowForCharacter, approvalEntryForCharacter } from "./scenografiePcidLookup.js";
import { PROJECT_POSTER_STATUS } from "./scenografieProjectPoster.js";
import { pickChapterRepresentativeThumbnailUrl } from "./scenografieChapterCover.js";
import { emptyFinalFilmMontage } from "./montageAssembler.js";
import {
  consumerPhaseFromScenografiaUiStatus,
  reconcileWorkspaceFilmOutputState,
  FILM_DELIVERY_STATE,
  FILM_OUTPUT_TRUST,
  FILM_OUTPUT_READINESS,
} from "./scenografieConsumerReliability.js";
import {
  readFilmOutputVerificationFromWorkspace,
  computeFilmVerificationEffective,
  verifyFinalOutputUrl,
  buildPersistedFilmOutputVerification,
} from "./scenografieOutputVerification.js";

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

/** Schema progetto: 2 = identità personaggio per `pcid` (pool e lookup per pcid). */
export const SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID = 2;

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

/** Log una-tantum: master considerato ready grazie a source post-migrazione (non `user_canonical_lock`). */
let __migrationReadyLogged = false;

/** Solo test harness: reset log sessione `characterMasterReadyForScenes`. */
export function __resetMigrationReadyLogForTests() {
  __migrationReadyLogged = false;
}

const VALID_MIGRATION_SOURCES = new Set([
  "migrated_id_and_name_same_url",
  "migrated_id_and_name",
  "migrated_name_only",
  "migrated_pcid_layout",
]);

/**
 * Riga PCM utilizzabile per identity lock e pipeline scene (stessa policy di `source`).
 * Non implica URL presente né approvazione — vanno verificati a parte.
 */
export function pcmRowTrustedForIdentityLock(row) {
  if (!row || typeof row !== "object") return false;
  if (row.pendingManualReview === true) return false;
  if (row.source === PCM_SOURCE_USER_CANONICAL_LOCK) return true;
  return VALID_MIGRATION_SOURCES.has(row.source);
}

/**
 * Personaggio pronto per pipeline scene: URL, approvazione, niente revisione pendente e
 * `source` canonico (`user_canonical_lock`) oppure **source coerente post-migrazione** (whitelist).
 * @param {{ id: string }} char
 * @param {object} d — payload capitolo (plan, projectCharacterMasters, characterApprovalMap)
 */
export function characterMasterReadyForScenes(char, d) {
  const pcm = d.projectCharacterMasters && typeof d.projectCharacterMasters === "object" ? d.projectCharacterMasters : {};
  const row = pcmRowForCharacter(pcm, char);
  const url = row?.masterImageUrl ? String(row.masterImageUrl).trim() : "";
  if (!url) return false;
  if (row.pendingManualReview === true) return false;
  const ap = approvalEntryForCharacter(d.characterApprovalMap, char);
  if (ap?.approved !== true) return false;
  // Policy: ready se lock utente OPPURE source migrato coerente (evita stallo post-STEP1–4).
  if (!pcmRowTrustedForIdentityLock(row)) {
    return false;
  }
  if (row.source !== PCM_SOURCE_USER_CANONICAL_LOCK && !__migrationReadyLogged) {
    console.info(
      `[PCID READY · MIGRATION SOURCE] character ready without user_canonical_lock (source="${row.source}")`,
    );
    __migrationReadyLogged = true;
  }
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

/** Progresso massimo tra capitoli (hub / indice meno dipendente dal solo primo capitolo). */
const SCENOGRAFIA_UI_STATUS_RANK = {
  planning: 10,
  character_approval: 20,
  scene_approval: 30,
  clip_approval: 40,
  timeline_approval: 50,
  final_film_ready: 60,
  video_ready: 65,
  video_production: 70,
  final_montage: 80,
  completed: 100,
};

/**
 * @param {Array<{ data?: object }>} chapters
 * @returns {string}
 */
export function deriveAggregateScenografiaUiStatus(chapters) {
  const list = Array.isArray(chapters) ? chapters : [];
  if (!list.length) return "planning";
  let best = "planning";
  let bestRank = 0;
  for (const ch of list) {
    const u = deriveScenografiaUiStatus(ch?.data || {});
    const r = SCENOGRAFIA_UI_STATUS_RANK[u] ?? 0;
    if (r > bestRank) {
      bestRank = r;
      best = u;
    }
  }
  return best;
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
  const uiStatus = deriveScenografiaUiStatus(data);

  return {
    displayTitle,
    characterCount,
    scenesInPlan,
    scenesGenerated,
    clipsCount,
    uiStatus,
    consumerWorkflowPhase: consumerPhaseFromScenografiaUiStatus(uiStatus),
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
      workspaceAggregateUiStatus: "planning",
      consumerWorkflowPhase: "draft",
      characterCount: 0,
      scenesGenerated: 0,
      scenesInPlan: 0,
      clipsCount: 0,
      completedFilmUrl: null,
      completedFilmDurationSec: null,
      filmOutputReadiness: FILM_OUTPUT_READINESS.MISSING_OUTPUT,
      filmDeliveryState: FILM_DELIVERY_STATE.NOT_READY,
      filmPrimaryChapterId: null,
      filmPlayableSourceChapterId: null,
      filmLatestPlayableChapterId: null,
      filmOutputTrust: FILM_OUTPUT_TRUST.MISSING,
      filmOutputRecordedAt: null,
      filmOutputUrlKind: "unknown",
      filmRenderModeHint: null,
      filmChaptersCompletedCount: 0,
      filmChaptersWithPlayableOutput: 0,
      filmChaptersConsolidated: 0,
      filmHasPartialMontageFailure: false,
      filmUserHint: null,
      lastFilmWorkflowFailure: null,
      multiChapterFilmHint: null,
      filmReconcileMeta: null,
      summaryReconciledAt: null,
      summaryDerivedFrom: null,
      summaryFreshness: "none",
      filmVerificationEffective: computeFilmVerificationEffective(null, null),
      filmOutputVerificationStatus: null,
      filmOutputVerificationCheckedAt: null,
      filmOutputVerificationMethod: null,
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
  const workspaceAggregateUiStatus = deriveAggregateScenografiaUiStatus(chapters);
  const consumerWorkflowPhase = consumerPhaseFromScenografiaUiStatus(workspaceAggregateUiStatus);

  let filmChaptersCompletedCount = 0;
  for (const ch of chapters) {
    if (deriveScenografiaUiStatus(ch?.data || {}) === "completed") filmChaptersCompletedCount += 1;
  }

  const filmRollup = reconcileWorkspaceFilmOutputState(w);
  let completedFilmUrl = filmRollup.completedFilmUrl;
  let completedFilmDurationSec = null;

  const nominalCompletedWithoutFilm =
    workspaceAggregateUiStatus === "completed" &&
    (!filmRollup.completedFilmUrl ||
      filmRollup.filmOutputReadiness === FILM_OUTPUT_READINESS.MISSING_OUTPUT ||
      filmRollup.filmOutputReadiness === FILM_OUTPUT_READINESS.MONTAGE_FAILED);

  const filmReconcileMeta = {
    ...(filmRollup.reconcileMeta && typeof filmRollup.reconcileMeta === "object" ? filmRollup.reconcileMeta : {}),
    nominalCompletedWithoutFilm,
  };

  const primaryData =
    (filmRollup.primaryChapterId &&
      chapters.find((c) => c.id === filmRollup.primaryChapterId)?.data) ||
    first;
  const primaryMontage =
    primaryData?.finalFilmMontage && typeof primaryData.finalFilmMontage === "object"
      ? primaryData.finalFilmMontage
      : null;

  if (!completedFilmUrl && primaryMontage) {
    const u = String(primaryMontage.outputUrl || "").trim();
    if (u) completedFilmUrl = u;
  }
  if (primaryMontage) {
    const est = primaryMontage.compiledMontagePlan?.totalDurationSecEstimate;
    if (typeof est === "number" && Number.isFinite(est)) completedFilmDurationSec = est;
  }
  if (completedFilmDurationSec == null && primaryData) {
    completedFilmDurationSec = estimateChapterVideoSeconds(primaryData);
  }

  const filmOutputReadiness = filmRollup.filmOutputReadiness;
  let filmUserHint = filmRollup.filmUserHint || null;
  if (nominalCompletedWithoutFilm) {
    filmUserHint =
      "Il progetto risulta «completato» ma non c’è un file film consolidato riconosciuto: apri il montaggio e rigenera o verifica il capitolo.";
  }
  const lastFilmWorkflowFailure = filmRollup.lastFilmWorkflowFailure || null;

  const summaryReconciledAt = filmReconcileMeta.reconciledAt || new Date().toISOString();

  const storedVerification = readFilmOutputVerificationFromWorkspace(w);
  const filmVerificationEffective = computeFilmVerificationEffective(storedVerification, completedFilmUrl);

  return {
    displayTitle,
    chaptersCount: chapters.length,
    posterImageUrl,
    projectPosterUrl: posterImageUrl,
    posterGenerationStatus,
    projectPosterStatus: posterGenerationStatus,
    uiStatus,
    workspaceAggregateUiStatus,
    consumerWorkflowPhase,
    characterCount,
    scenesGenerated,
    scenesInPlan,
    clipsCount,
    projectPosterOutdated: w.projectPosterOutdated === true,
    completedFilmUrl,
    completedFilmDurationSec,
    filmOutputReadiness,
    filmDeliveryState: filmRollup.filmDeliveryState,
    filmPrimaryChapterId: filmRollup.primaryChapterId,
    filmPlayableSourceChapterId: filmRollup.pickedOutputSourceChapterId || null,
    filmLatestPlayableChapterId: filmReconcileMeta.latestPlayableChapterId || null,
    filmOutputTrust: filmRollup.outputTrust,
    filmOutputRecordedAt: filmRollup.outputRecordedAt,
    filmOutputUrlKind: filmRollup.outputUrlKind,
    filmRenderModeHint: filmRollup.renderModeHint,
    filmChaptersCompletedCount,
    filmChaptersWithPlayableOutput: filmRollup.filmChaptersWithPlayableOutput,
    filmChaptersConsolidated: filmRollup.filmChaptersConsolidated,
    filmHasPartialMontageFailure: filmRollup.hasPartialMontageFailure === true,
    filmUserHint,
    lastFilmWorkflowFailure,
    multiChapterFilmHint: filmRollup.multiChapterFilmHint,
    filmReconcileMeta,
    summaryReconciledAt,
    summaryDerivedFrom: "workspace_payload",
    summaryFreshness: "live_recomputed",
    filmVerificationEffective,
    filmOutputVerificationStatus: storedVerification?.outputVerificationStatus ?? null,
    filmOutputVerificationCheckedAt: storedVerification?.outputVerificationCheckedAt ?? null,
    filmOutputVerificationMethod: storedVerification?.outputVerificationMethod ?? null,
    filmOutputVerificationError: storedVerification?.outputVerificationError ?? null,
    filmOutputVerificationSourceUrl: storedVerification?.outputVerificationSourceUrl ?? null,
  };
}

/**
 * Esegue verifica reale dell’URL film (HEAD/GET/video probe) e persiste il risultato sul workspace.
 * @param {string} projectId
 * @param {string|null} [urlOverride] — URL da controllare (default: sintesi `completedFilmUrl`)
 */
export async function runAndPersistFilmOutputVerification(projectId, urlOverride = null) {
  const raw = await loadScenografiaProjectById(projectId);
  const ws = ensureWorkspace(raw);
  if (!ws) {
    return { ok: false, errorUser: "Progetto non trovato o workspace non valido." };
  }
  const sum = summarizeScenografiaWorkspaceForIndex(ws);
  const url =
    urlOverride != null && String(urlOverride).trim() ? String(urlOverride).trim() : sum.completedFilmUrl;
  if (!url) {
    return { ok: false, errorUser: "Nessun file film indicizzato da verificare." };
  }
  const result = await verifyFinalOutputUrl(url);
  ws.filmOutputVerification = buildPersistedFilmOutputVerification(result, url);
  ws.updatedAt = new Date().toISOString();
  await saveScenografiaProjectById(projectId, ws);
  await upsertScenografiaProjectInIndex(projectId, ws);
  return {
    ok: true,
    result,
    summary: summarizeScenografiaWorkspaceForIndex(ws),
    persistedVerification: ws.filmOutputVerification && typeof ws.filmOutputVerification === "object" ? { ...ws.filmOutputVerification } : null,
  };
}

/**
 * Indice su disco potenzialmente precedente alla riconciliazione film: refresh leggero (pochi progetti) in hub.
 * @param {object|null|undefined} summary
 */
export function indexSummaryNeedsLightReconcile(summary) {
  const s = summary && typeof summary === "object" ? summary : {};
  if (!s.summaryReconciledAt) return true;
  if ((s.chaptersCount || 0) > 1 && s.filmPlayableSourceChapterId == null && (s.filmChaptersWithPlayableOutput || 0) > 0) {
    return true;
  }
  return false;
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

function mergeCharacterApprovalState(dst, src) {
  if (!src || typeof src !== "object") return dst;
  const a = dst && typeof dst === "object" ? { ...dst } : {};
  const b = src;
  return {
    ...a,
    ...b,
    approved: a.approved === true || b.approved === true,
    version: Math.max(
      typeof a.version === "number" && Number.isFinite(a.version) ? a.version : 0,
      typeof b.version === "number" && Number.isFinite(b.version) ? b.version : 0,
    ),
  };
}

function liftMastersFromChaptersToProjectWorkspace(ws) {
  if (!isWorkspacePayload(ws)) return;
  ensureProjectCharacterPool(ws);
  const wsPcid = schemaAtLeastPcidWorkspace(ws);
  for (const ch of ws.chapters) {
    const data = ch?.data;
    if (!data || typeof data !== "object") continue;
    if (!wsPcid) {
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
      continue;
    }
    const plan = data.plan;
    for (const [k, v] of Object.entries(data.masterImages && typeof data.masterImages === "object" ? data.masterImages : {})) {
      if (looksLikePcidKey(k)) {
        ws.projectMasterImages[k] = v;
      } else {
        const c = (plan?.characters || []).find((x) => x?.id === k);
        const p = c?.pcid && looksLikePcidKey(c.pcid) ? String(c.pcid).trim() : "";
        if (p) ws.projectMasterImages[p] = ws.projectMasterImages[p] ?? v;
        else
          console.warn(
            `[SCENOGRAFIE lift masters] schema>=2: chiave masterImages non-pcid senza pcid sul personaggio, skip chapter=${ch?.id} key=${k}`,
          );
      }
    }
    for (const [nk, val] of Object.entries(
      data.masterByCharName && typeof data.masterByCharName === "object" ? data.masterByCharName : {},
    )) {
      const s = String(val ?? "").trim();
      if (looksLikePcidKey(s)) {
        ws.projectMasterByCharName[nk] = s;
      } else if (isHttpMasterUrl(s)) {
        const c = (plan?.characters || []).find((x) => normCharNameForMasterPool(x?.name) === nk);
        const p = c?.pcid && looksLikePcidKey(c.pcid) ? String(c.pcid).trim() : "";
        if (p) {
          ws.projectMasterByCharName[nk] = p;
          if (!ws.projectMasterImages[p] && s) ws.projectMasterImages[p] = s;
        } else {
          console.warn(
            `[SCENOGRAFIE lift masters] schema>=2: masterByCharName URL senza pcid sul personaggio, skip chapter=${ch?.id} nk=${nk}`,
          );
        }
      } else if (s) {
        console.warn(`[SCENOGRAFIE lift masters] schema>=2: valore masterByCharName non riconosciuto, skip nk=${nk}`);
      }
    }
    for (const [k, v] of Object.entries(
      data.characterApprovalMap && typeof data.characterApprovalMap === "object" ? data.characterApprovalMap : {},
    )) {
      if (looksLikePcidKey(k)) {
        ws.projectCharacterApprovalMap[k] = mergeCharacterApprovalState(ws.projectCharacterApprovalMap[k], v);
      } else {
        const c = (plan?.characters || []).find((x) => x?.id === k);
        const p = c?.pcid && looksLikePcidKey(c.pcid) ? String(c.pcid).trim() : "";
        if (p) {
          ws.projectCharacterApprovalMap[p] = mergeCharacterApprovalState(ws.projectCharacterApprovalMap[p], v);
        } else {
          console.warn(
            `[SCENOGRAFIE lift masters] schema>=2: approval key non-pcid senza pcid sul personaggio, skip chapter=${ch?.id} key=${k}`,
          );
        }
      }
    }
    for (const [k, row] of Object.entries(
      data.projectCharacterMasters && typeof data.projectCharacterMasters === "object" ? data.projectCharacterMasters : {},
    )) {
      if (looksLikePcidKey(k)) {
        const prev = ws.projectCharacterMasters[k] && typeof ws.projectCharacterMasters[k] === "object" ? ws.projectCharacterMasters[k] : {};
        ws.projectCharacterMasters[k] = { ...prev, ...row };
      } else {
        const c = (plan?.characters || []).find((x) => x?.id === k);
        const p = c?.pcid && looksLikePcidKey(c.pcid) ? String(c.pcid).trim() : "";
        if (p) {
          const prev = ws.projectCharacterMasters[p] && typeof ws.projectCharacterMasters[p] === "object" ? ws.projectCharacterMasters[p] : {};
          ws.projectCharacterMasters[p] = { ...prev, ...row };
        } else {
          console.warn(
            `[SCENOGRAFIE lift masters] schema>=2: projectCharacterMasters key char_N senza pcid sul personaggio, skip chapter=${ch?.id} key=${k}`,
          );
        }
      }
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

const PCID_RANDOM_HEX_LEN = 6;
const PCID_KEY_RE = /^pcid_[0-9a-f]{6}$/;

function looksLikePcidKey(s) {
  return PCID_KEY_RE.test(String(s || "").trim());
}

function generatePcidCandidate() {
  let hex = "";
  for (let i = 0; i < PCID_RANDOM_HEX_LEN; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return `pcid_${hex}`;
}

/**
 * @param {Set<string>} usedPcids
 * @returns {string}
 */
function allocatePcid(usedPcids) {
  for (let n = 0; n < 10000; n++) {
    const p = generatePcidCandidate();
    if (!usedPcids.has(p)) {
      usedPcids.add(p);
      return p;
    }
  }
  throw new Error("[PCID MIGRATION] impossibile allocare pcid (collisioni eccessive)");
}

function parseIsoMs(s) {
  const t = Date.parse(String(s || ""));
  return Number.isFinite(t) ? t : 0;
}

function voiceHasCanonicalLock(v) {
  if (!v || typeof v !== "object") return false;
  if (v.canonicalLock === true || v.voiceCanonicalLock === true) return true;
  if (v.source === PCM_SOURCE_USER_CANONICAL_LOCK) return true;
  return false;
}

function voiceUpdatedMs(v) {
  return parseIsoMs(v?.updatedAt);
}

function charLocalKey(chapterId, charId) {
  return `${String(chapterId || "").trim()}::${String(charId || "").trim()}`;
}

function isHttpMasterUrl(val) {
  const s = String(val ?? "").trim();
  return /^https?:\/\//i.test(s);
}

function schemaAtLeastPcidWorkspace(ws) {
  const v = ws?.projectSchemaVersion;
  return typeof v === "number" && v >= SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID;
}

/**
 * True se mappe master usano `pcid` (chiavi / valori) invece di URL legacy.
 * @param {object|null} plan
 * @param {Record<string, unknown>} [masterImages]
 * @param {Record<string, unknown>} [masterByCharName]
 */
export function inferPcidMasterLayout(plan, masterImages, masterByCharName) {
  const mi = masterImages && typeof masterImages === "object" ? masterImages : {};
  const mbn = masterByCharName && typeof masterByCharName === "object" ? masterByCharName : {};
  for (const c of plan?.characters || []) {
    if (looksLikePcidKey(c?.pcid)) return true;
  }
  for (const v of Object.values(mbn)) {
    if (looksLikePcidKey(String(v ?? "").trim())) return true;
  }
  for (const k of Object.keys(mi)) {
    if (looksLikePcidKey(k)) return true;
  }
  return false;
}

function masterUrlFromMiOrPcm(pcid, charId, mi, pcm) {
  const p = String(pcid || "").trim();
  const id = String(charId || "").trim();
  const pcmRow = p && pcm[p] && typeof pcm[p] === "object" ? pcm[p] : null;
  const uPcm = pcmRow?.masterImageUrl ? String(pcmRow.masterImageUrl).trim() : "";
  if (isHttpMasterUrl(uPcm)) return uPcm;
  if (p && mi[p]) {
    const u = String(mi[p]).trim();
    if (isHttpMasterUrl(u)) return u;
  }
  if (id && mi[id]) {
    const u = String(mi[id]).trim();
    if (isHttpMasterUrl(u)) return u;
  }
  return "";
}

function assignPcidsFromPoolToPlanCharacters(plan, poolByName) {
  const pbn = poolByName && typeof poolByName === "object" ? poolByName : {};
  for (const c of plan?.characters || []) {
    if (!c?.id) continue;
    const nk = normCharNameForMasterPool(c.name);
    if (!nk) continue;
    const poolRef = String(pbn[nk] ?? "").trim();
    if (!looksLikePcidKey(poolRef)) continue;
    const loc = String(c.pcid ?? "").trim();
    if (!looksLikePcidKey(loc)) {
      c.pcid = poolRef;
      continue;
    }
    if (loc !== poolRef) {
      console.warn(
        `[SCENOGRAFIE merge chapter+pool] pcid mismatch normName=${nk} chapterPcid=${loc} poolPcid=${poolRef} — using pool`,
      );
      c.pcid = poolRef;
    }
  }
}

function rekeyChapterMasterMapsCharIdToPcid(merged) {
  const plan = merged?.plan;
  const mi = merged.masterImages && typeof merged.masterImages === "object" ? merged.masterImages : {};
  const cap = merged.characterApprovalMap && typeof merged.characterApprovalMap === "object" ? merged.characterApprovalMap : {};
  const pcm = merged.projectCharacterMasters && typeof merged.projectCharacterMasters === "object" ? merged.projectCharacterMasters : {};
  for (const c of plan?.characters || []) {
    if (!c?.id) continue;
    const p = String(c.pcid ?? "").trim();
    if (!looksLikePcidKey(p)) continue;
    const id = String(c.id).trim();
    if (id && id !== p && mi[id] != null) {
      const u = String(mi[id]).trim();
      if (!mi[p] || !String(mi[p]).trim()) {
        mi[p] = u;
      }
      delete mi[id];
    }
    if (id && id !== p && cap[id] != null) {
      const dst = cap[p] && typeof cap[p] === "object" ? { ...cap[p], ...cap[id] } : { ...cap[id] };
      cap[p] = dst;
      delete cap[id];
    }
    if (id && id !== p && pcm[id] != null) {
      const dst = pcm[p] && typeof pcm[p] === "object" ? { ...pcm[id], ...pcm[p] } : { ...pcm[id] };
      pcm[p] = dst;
      delete pcm[id];
    }
  }
}

function mergePcmChapterAndPoolForPlan(plan, pcmChapter, pcmPool) {
  const ch = pcmChapter && typeof pcmChapter === "object" ? pcmChapter : {};
  const pl = pcmPool && typeof pcmPool === "object" ? pcmPool : {};
  const out = {};
  for (const c of plan?.characters || []) {
    if (!c?.id) continue;
    const p = String(c.pcid ?? "").trim();
    if (!looksLikePcidKey(p)) continue;
    out[p] = { ...(ch[p] || ch[c.id] || {}), ...(pl[p] || {}) };
  }
  return out;
}

/**
 * Migrazione isolata workspace → `projectSchemaVersion` 2: master, approval, voci e riferimenti scena/clip
 * passano da chiavi `char_N` a `pcid_*` per identità stabile. Idempotente se `projectSchemaVersion >= 2`.
 *
 * Policy (3 fasi): (1) globale — snapshot solo dai capitoli (no pool workspace): stesso `normName` → **un solo
 * `pcid`** in tutto il progetto; merge master/voci cross-capitolo con priorità lock/`updatedAt`/lessicografico;
 * senza nome → un `pcid` per `(chapterId, char_N)`. (2) per capitolo — remap scene/clip/voci con mappe locali.
 * (3) pool workspace — `projectMasterByCharName` con chiavi `normName` pure. Legacy `masterByCharName` URL →
 * `masterByCharNameValuesAsUrlsForLegacy`.
 *
 * @param {object} project — workspace serializzato (o payload con `chapters`)
 * @returns {object}
 */
function migrationNormalizeHttpMaster(val) {
  const s = String(val ?? "").trim();
  return isHttpMasterUrl(s) ? s : "";
}

/**
 * Dopo il merge canonico master (senza cambiare URL scelti in collisione): imposta `source` e
 * `pendingManualReview` + dedup URL condiviso tra pcid distinti. Un log riepilogativo è emesso
 * una sola volta a fine `migrateProjectToPcidSchema`.
 */
function applyPcidMigrationPendingAndSourcePolicy(
  pcidToCanonicalMaster,
  membersByNk,
  globalNkToPcid,
  snapByChapterId,
  nkUrlCollision,
) {
  const namedPcids = new Set();
  for (const [nk, members] of membersByNk) {
    const pcid = globalNkToPcid[nk];
    if (!looksLikePcidKey(pcid)) continue;
    namedPcids.add(pcid);
    const row = pcidToCanonicalMaster[pcid];
    if (!row || typeof row !== "object") continue;
    if (row.source === PCM_SOURCE_USER_CANONICAL_LOCK) {
      row.pendingManualReview = false;
      continue;
    }
    if (nkUrlCollision.get(nk)) {
      row.source = "migrated_id_and_name";
      row.pendingManualReview = true;
      continue;
    }
    const m0 = members[0];
    const snap = snapByChapterId.get(m0.chapterId);
    if (!snap) continue;
    const charId = m0.charId;
    const byId = migrationNormalizeHttpMaster(snap.miIn?.[charId]);
    const byName = migrationNormalizeHttpMaster(snap.mbnIn?.[nk]);

    let source = "migrated_pcid_layout";
    let pending = true;

    if (!byId && byName) {
      source = "migrated_name_only";
      pending = true;
    } else if (byId && byName) {
      if (byId === byName) {
        source = "migrated_id_and_name_same_url";
        pending = false;
      } else {
        source = "migrated_id_and_name";
        pending = true;
      }
    } else if (byId && !byName) {
      source = "migrated_id_only";
      pending = true;
    }

    row.source = source;
    row.pendingManualReview = pending;
  }

  for (const pcid of Object.keys(pcidToCanonicalMaster)) {
    if (!looksLikePcidKey(pcid)) continue;
    if (namedPcids.has(pcid)) continue;
    const row = pcidToCanonicalMaster[pcid];
    if (!row || typeof row !== "object") continue;
    if (row.source === PCM_SOURCE_USER_CANONICAL_LOCK) {
      row.pendingManualReview = false;
      continue;
    }
    row.source = "migrated_unnamed_slot";
    row.pendingManualReview = true;
  }

  const urlToPcids = new Map();
  for (const [pcid, row] of Object.entries(pcidToCanonicalMaster)) {
    if (!looksLikePcidKey(pcid)) continue;
    const u = migrationNormalizeHttpMaster(row.masterImageUrl);
    if (!u) continue;
    if (!urlToPcids.has(u)) urlToPcids.set(u, []);
    urlToPcids.get(u).push(pcid);
  }
  for (const [, pcids] of urlToPcids) {
    if (pcids.length <= 1) continue;
    for (const p of pcids) {
      const row = pcidToCanonicalMaster[p];
      if (row && typeof row === "object" && row.source !== PCM_SOURCE_USER_CANONICAL_LOCK) {
        row.pendingManualReview = true;
      }
    }
  }
}

function tallyPcidMigrationPendingPolicyLog(pcidToCanonicalMaster) {
  let nonPending = 0;
  let pending = 0;
  const reasons = {};
  for (const [pcid, row] of Object.entries(pcidToCanonicalMaster)) {
    if (!looksLikePcidKey(pcid)) continue;
    if (!row || typeof row !== "object") continue;
    if (row.pendingManualReview === true) pending += 1;
    else nonPending += 1;
    const s = String(row.source || "unknown");
    reasons[s] = (reasons[s] || 0) + 1;
  }
  return { nonPending, pending, reasons };
}

export function migrateProjectToPcidSchema(project) {
  if (!project || typeof project !== "object") return project;
  const schemaV = project.projectSchemaVersion;
  if (typeof schemaV === "number" && schemaV >= SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID) {
    return project;
  }

  const out = JSON.parse(JSON.stringify(project));
  const usedPcids = new Set();
  const seedMaps = [
    out.projectCharacterMasters,
    out.projectMasterImages,
    out.projectCharacterApprovalMap,
  ];
  for (const m of seedMaps) {
    if (m && typeof m === "object") {
      for (const k of Object.keys(m)) {
        if (looksLikePcidKey(k)) usedPcids.add(k);
      }
    }
  }

  let voiceRemapCount = 0;
  let voiceBucketsCollapsedCount = 0;
  let dialogLineRemapCount = 0;

  const chapters = Array.isArray(out.chapters) ? [...out.chapters] : [];
  chapters.sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.id).localeCompare(String(b.id)));

  const allPlanCharIds = new Set();
  for (const ch of chapters) {
    const plan = ch?.data?.plan;
    for (const c of plan?.characters || []) {
      if (c?.id) allPlanCharIds.add(String(c.id).trim());
    }
  }

  const oldPoolPcm =
    project.projectCharacterMasters && typeof project.projectCharacterMasters === "object"
      ? { ...project.projectCharacterMasters }
      : {};
  const oldPoolPm =
    project.projectMasterImages && typeof project.projectMasterImages === "object"
      ? { ...project.projectMasterImages }
      : {};
  const oldPoolPam =
    project.projectCharacterApprovalMap && typeof project.projectCharacterApprovalMap === "object"
      ? { ...project.projectCharacterApprovalMap }
      : {};

  console.info(
    `[PCID MIGRATION] start chapters=${chapters.length} planCharIds=${allPlanCharIds.size} schemaVersion→${SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID}`,
  );

  if (chapters.length === 0) {
    out.projectSchemaVersion = SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID;
    console.info(
      `[PCID MIGRATION] no chapters — bump only voiceRemap=${voiceRemapCount} voiceBucketsCollapsed=${voiceBucketsCollapsedCount} dialogLineRemap=${dialogLineRemapCount}`,
    );
    console.info(
      `[PCID MIGRATION · VOICE REMAP] ${voiceRemapCount}`,
    );
    console.info(
      `[PCID MIGRATION · DIALOG LINES REMAP] ${dialogLineRemapCount}`,
    );
    console.info(`[PCID MIGRATION · PENDING REVIEW POLICY] nonPending=0 pending=0 reasons={}`);
    return out;
  }

  /**
   * Valori `masterByCharName` già in formato pcid (re-run / dati parziali): risolvi a URL per `migrateLegacy`.
   * @param {Record<string, string>} mbn
   * @param {Record<string, object>} pcm
   */
  function masterByCharNameValuesAsUrlsForLegacy(mbn, pcm) {
    const raw = mbn && typeof mbn === "object" ? mbn : {};
    const out = {};
    const p = pcm && typeof pcm === "object" ? pcm : {};
    for (const [k, v] of Object.entries(raw)) {
      let val = String(v ?? "").trim();
      if (!val) continue;
      if (looksLikePcidKey(val)) {
        const u = p[val]?.masterImageUrl ? String(p[val].masterImageUrl).trim() : "";
        if (u) out[k] = u;
        continue;
      }
      out[k] = val;
    }
    return out;
  }

  function mergeCharacterApproval(dst, src) {
    if (!src || typeof src !== "object") return dst;
    const a = dst && typeof dst === "object" ? { ...dst } : {};
    const b = src;
    return {
      ...a,
      ...b,
      approved: a.approved === true || b.approved === true,
      version: Math.max(
        typeof a.version === "number" && Number.isFinite(a.version) ? a.version : 0,
        typeof b.version === "number" && Number.isFinite(b.version) ? b.version : 0,
      ),
    };
  }

  function mergePcmSnapshotRows(rows) {
    const list = (rows || []).filter((x) => x && typeof x === "object");
    if (!list.length) return {};
    const sorted = [...list].sort((a, b) => {
      const la = a?.source === PCM_SOURCE_USER_CANONICAL_LOCK ? 1 : 0;
      const lb = b?.source === PCM_SOURCE_USER_CANONICAL_LOCK ? 1 : 0;
      if (la !== lb) return lb - la;
      const ta = parseIsoMs(a?.updatedAt);
      const tb = parseIsoMs(b?.updatedAt);
      if (ta !== tb) return tb - ta;
      return String(a?.masterImageUrl || "").localeCompare(String(b?.masterImageUrl || ""));
    });
    return { ...sorted[0] };
  }

  function compareVoiceLocationCandidates(a, b) {
    const la = voiceHasCanonicalLock(a.val) ? 1 : 0;
    const lb = voiceHasCanonicalLock(b.val) ? 1 : 0;
    if (la !== lb) return lb - la;
    const ta = voiceUpdatedMs(a.val);
    const tb = voiceUpdatedMs(b.val);
    if (ta !== tb) return tb - ta;
    return String(a.locKey).localeCompare(String(b.locKey));
  }

  const chapterSnaps = [];
  for (const ch of chapters) {
    const chapterId = String(ch?.id || "").trim() || "?";
    const data = ch?.data && typeof ch.data === "object" ? ch.data : null;
    if (!data) continue;
    const plan = data.plan;
    if (!plan || typeof plan !== "object" || !Array.isArray(plan.characters) || plan.characters.length === 0) {
      continue;
    }
    const miIn = data.masterImages && typeof data.masterImages === "object" ? { ...data.masterImages } : {};
    const pcmIn = data.projectCharacterMasters && typeof data.projectCharacterMasters === "object" ? { ...data.projectCharacterMasters } : {};
    const mbnIn = masterByCharNameValuesAsUrlsForLegacy(data.masterByCharName, pcmIn);
    const capIn = data.characterApprovalMap && typeof data.characterApprovalMap === "object" ? { ...data.characterApprovalMap } : {};
    const filled = migrateLegacyToProjectCharacterMasters(plan, miIn, mbnIn, capIn, pcmIn, {});
    chapterSnaps.push({ ch, chapterId, data, plan, miIn, mbnIn, pcmIn, capIn, filled });
  }

  const snapByChapterId = new Map(chapterSnaps.map((s) => [s.chapterId, s]));

  /** @type {Map<string, object[]>} */
  const membersByNk = new Map();
  for (const snap of chapterSnaps) {
    for (const c of snap.plan.characters) {
      if (!c?.id) continue;
      const charId = String(c.id).trim();
      const nameTrim = String(c.name ?? "").trim();
      const nk = normCharNameForMasterPool(c.name);
      const row = snap.filled[charId];
      let url = row?.masterImageUrl ? String(row.masterImageUrl).trim() : "";
      const pcmRow = snap.pcmIn[charId] && typeof snap.pcmIn[charId] === "object" ? { ...snap.pcmIn[charId] } : {};
      if (!url) url = String(pcmRow.masterImageUrl || "").trim();
      const updatedMs = parseIsoMs(pcmRow.updatedAt || row?.updatedAt);
      const capRow = snap.capIn[charId] && typeof snap.capIn[charId] === "object" ? { ...snap.capIn[charId] } : undefined;
      if (nameTrim && nk) {
        if (!membersByNk.has(nk)) membersByNk.set(nk, []);
        membersByNk.get(nk).push({
          chapterId: snap.chapterId,
          charId,
          nk,
          displayName: nameTrim,
          url,
          pcm: pcmRow,
          filled: row || null,
          updatedMs,
          cap: capRow,
        });
      }
    }
  }

  /** @type {Record<string, string>} */
  const globalNkToPcid = {};
  /** @type {Map<string, string>} */
  const charLocalToPcid = new Map();

  for (const [nk, members] of membersByNk) {
    const pcid = allocatePcid(usedPcids);
    globalNkToPcid[nk] = pcid;
    for (const m of members) {
      charLocalToPcid.set(charLocalKey(m.chapterId, m.charId), pcid);
    }
  }

  /** @type {Record<string, object>} */
  const pcidToCanonicalMaster = {};
  /** @type {Record<string, object|undefined>} */
  const pcidToCanonicalApproval = {};
  /** @type {Record<string, object|undefined>} */
  const pcidToCanonicalVoice = {};
  /** @type {Map<string, boolean>} */
  const nkUrlCollision = new Map();

  for (const [nk, members] of membersByNk) {
    const pcid = globalNkToPcid[nk];
    const pcmRows = members.map((m) => {
      const u = String(m.url || m.pcm?.masterImageUrl || "").trim();
      return {
        ...m.pcm,
        masterImageUrl: u,
        updatedAt: m.pcm.updatedAt || m.filled?.updatedAt || new Date().toISOString(),
      };
    });
    const uniqUrls = [...new Set(pcmRows.map((r) => String(r.masterImageUrl || "").trim()).filter(Boolean))].sort();
    nkUrlCollision.set(nk, uniqUrls.length > 1);
    const mergedPcm = mergePcmSnapshotRows(pcmRows.length ? pcmRows : [{}]);
    if (uniqUrls.length > 1) {
      const cand = members.map((m) => `${m.chapterId}/${m.charId}=${m.url || "∅"}`).join(" | ");
      const chosenUrl = String(mergedPcm.masterImageUrl || "").trim() || "∅";
      console.warn(
        `[PCID MIGRATION · MASTER URL COLLISION] nameKey=${nk} pcid=${pcid} candidates=[${cand}] chosenUrl=${chosenUrl}`,
      );
    }
    let mergedCap;
    for (const m of members) {
      if (m.cap) mergedCap = mergeCharacterApproval(mergedCap, m.cap);
    }
    const rep = members[0];
    pcidToCanonicalMaster[pcid] = {
      ...mergedPcm,
      pcid,
      characterId: rep.charId,
      characterName: rep.displayName,
      masterImageUrl: String(mergedPcm.masterImageUrl || "").trim(),
      approved: mergedPcm.approved === true || mergedCap?.approved === true,
    };
    if (mergedCap) pcidToCanonicalApproval[pcid] = mergedCap;
  }

  for (const [nk, members] of membersByNk) {
    const pcid = globalNkToPcid[nk];
    const cands = [];
    for (const m of members) {
      const s = snapByChapterId.get(m.chapterId);
      const v = s?.data?.characterVoiceMasters?.[m.charId];
      if (v && typeof v === "object") {
        cands.push({
          chapterId: m.chapterId,
          charId: m.charId,
          locKey: `${m.chapterId}/${m.charId}`,
          val: { ...v },
        });
      }
    }
    if (!cands.length) continue;
    if (cands.length === 1) {
      pcidToCanonicalVoice[pcid] = cands[0].val;
      continue;
    }
    voiceBucketsCollapsedCount += 1;
    const sig = new Set(
      cands.map((c) =>
        JSON.stringify({
          voiceId: String(c.val?.voiceId || "").trim(),
          voiceLabel: String(c.val?.voiceLabel || "").trim(),
        }),
      ),
    );
    const sortedV = [...cands].sort(compareVoiceLocationCandidates);
    const pick = sortedV[0];
    if (sig.size > 1) {
      const candStr = cands
        .map(
          (x) =>
            `${x.locKey}:voiceId=${String(x.val?.voiceId || "").trim() || "∅"};lock=${voiceHasCanonicalLock(x.val) ? "1" : "0"};updatedAt=${voiceUpdatedMs(x.val)}`,
        )
        .join(" | ");
      const chosenStr = `${pick.locKey}:voiceId=${String(pick.val?.voiceId || "").trim() || "∅"}`;
      console.warn(
        `[PCID MIGRATION · VOICE COLLISION] pcid=${pcid} name=${JSON.stringify(members[0].displayName)} candidates=[${candStr}] chosen=${chosenStr}`,
      );
    }
    pcidToCanonicalVoice[pcid] = pick.val;
  }

  for (const snap of chapterSnaps) {
    for (const c of snap.plan.characters) {
      if (!c?.id) continue;
      const charId = String(c.id).trim();
      const lk = charLocalKey(snap.chapterId, charId);
      if (charLocalToPcid.has(lk)) continue;
      const pcid = allocatePcid(usedPcids);
      charLocalToPcid.set(lk, pcid);
      const row = snap.filled[charId];
      const pcmRow = snap.pcmIn[charId] && typeof snap.pcmIn[charId] === "object" ? { ...snap.pcmIn[charId] } : {};
      let url = row?.masterImageUrl ? String(row.masterImageUrl).trim() : "";
      if (!url) url = String(pcmRow.masterImageUrl || "").trim();
      const merged = mergePcmSnapshotRows([{ ...pcmRow, masterImageUrl: url, updatedAt: pcmRow.updatedAt || row?.updatedAt || new Date().toISOString() }]);
      let unnamedCap;
      if (snap.capIn[charId]) unnamedCap = mergeCharacterApproval(unnamedCap, snap.capIn[charId]);
      pcidToCanonicalMaster[pcid] = {
        ...merged,
        pcid,
        characterId: charId,
        characterName: c.name,
        masterImageUrl: String(merged.masterImageUrl || "").trim(),
        approved: merged.approved === true || unnamedCap?.approved === true,
      };
      if (unnamedCap) pcidToCanonicalApproval[pcid] = unnamedCap;
      const v = snap.data.characterVoiceMasters?.[charId];
      if (v && typeof v === "object") pcidToCanonicalVoice[pcid] = { ...v };
    }
  }

  applyPcidMigrationPendingAndSourcePolicy(
    pcidToCanonicalMaster,
    membersByNk,
    globalNkToPcid,
    snapByChapterId,
    nkUrlCollision,
  );
  const pendingPolicyTally = tallyPcidMigrationPendingPolicyLog(pcidToCanonicalMaster);

  for (const snap of chapterSnaps) {
    const { chapterId, data, plan } = snap;

    /** @type {Record<string, string>} */
    const idToPcid = {};
    for (const c of plan.characters) {
      if (!c?.id) continue;
      const rid = String(c.id).trim();
      idToPcid[rid] = charLocalToPcid.get(charLocalKey(chapterId, rid)) || "";
    }

    const pcidsInChapter = new Set(Object.values(idToPcid).filter(Boolean));

    const nextMi = {};
    const nextMbn = {};
    const nextPcm = {};
    const nextCap = {};

    for (const pcid of pcidsInChapter) {
      const canon = pcidToCanonicalMaster[pcid];
      if (!canon) continue;
      nextPcm[pcid] = { ...canon, pcid };
      const u = String(canon.masterImageUrl || "").trim();
      if (u) nextMi[pcid] = u;
      if (pcidToCanonicalApproval[pcid]) nextCap[pcid] = { ...pcidToCanonicalApproval[pcid] };
    }

    for (const c of plan.characters) {
      const nt = String(c.name ?? "").trim();
      const nk = normCharNameForMasterPool(c.name);
      if (nt && nk && globalNkToPcid[nk]) nextMbn[nk] = globalNkToPcid[nk];
    }

    for (const c of plan.characters) {
      if (!c?.id) continue;
      const rid = String(c.id).trim();
      const pc = idToPcid[rid];
      if (pc) c.pcid = pc;
    }

    const remapId = (x) => {
      const s = String(x || "").trim();
      if (!s) return s;
      return idToPcid[s] || s;
    };

    for (const sc of plan.scenes || []) {
      if (!sc || typeof sc !== "object") continue;
      const pres = Array.isArray(sc.characters_present) ? sc.characters_present : [];
      sc.characters_present = pres.map((id) => remapId(id)).filter(Boolean);
    }

    const clips = Array.isArray(data.sceneVideoClips) ? data.sceneVideoClips : [];
    for (const clip of clips) {
      if (!clip || typeof clip !== "object") continue;
      const lines = Array.isArray(clip.dialogLines) ? clip.dialogLines : [];
      for (const line of lines) {
        if (!line || typeof line !== "object") continue;
        const oldC = String(line.characterId || "").trim();
        if (!oldC) continue;
        const nextC = remapId(oldC);
        if (nextC && nextC !== oldC) {
          line.characterId = nextC;
          dialogLineRemapCount += 1;
        }
      }
      const ord = Array.isArray(clip.dialogLineOrder) ? clip.dialogLineOrder : [];
      clip.dialogLineOrder = ord.map((id) => remapId(String(id || "").trim())).filter(Boolean);
      const dfs = String(clip.dialogFirstSpeakerId || "").trim();
      if (dfs) {
        const n = remapId(dfs);
        if (n && n !== dfs) clip.dialogFirstSpeakerId = n;
      }
    }

    const vm = data.characterVoiceMasters && typeof data.characterVoiceMasters === "object" ? { ...data.characterVoiceMasters } : {};
    for (const k of Object.keys(vm)) {
      const mapped = remapId(k) || k;
      if (mapped && mapped !== k) voiceRemapCount += 1;
    }

    const nextVm = {};
    for (const pcid of pcidsInChapter) {
      if (pcidToCanonicalVoice[pcid]) nextVm[pcid] = { ...pcidToCanonicalVoice[pcid] };
    }

    data.characterVoiceMasters = nextVm;
    data.masterImages = nextMi;
    data.masterByCharName = nextMbn;
    data.projectCharacterMasters = nextPcm;
    data.characterApprovalMap = nextCap;
  }

  const mergedPcm = {};
  for (const [pcid, row] of Object.entries(pcidToCanonicalMaster)) {
    mergedPcm[pcid] = row && typeof row === "object" ? { ...row, pcid } : {};
  }

  function poolMergePutString(map, mapName, pcid, nextVal) {
    if (!looksLikePcidKey(pcid)) {
      map[pcid] = nextVal;
      return;
    }
    if (Object.prototype.hasOwnProperty.call(map, pcid)) {
      const prev = map[pcid];
      if (String(prev ?? "") !== String(nextVal ?? "")) {
        console.warn(
          `[PCID MIGRATION · POOL MERGE CONFLICT] map=${mapName} pcid=${pcid} prev=${JSON.stringify(prev)} next=${JSON.stringify(nextVal)}`,
        );
      }
    }
    map[pcid] = nextVal;
  }

  function poolMergePutObject(map, mapName, pcid, nextVal) {
    if (!looksLikePcidKey(pcid)) {
      map[pcid] = nextVal;
      return;
    }
    if (Object.prototype.hasOwnProperty.call(map, pcid)) {
      const prev = map[pcid];
      if (JSON.stringify(prev) !== JSON.stringify(nextVal)) {
        console.warn(
          `[PCID MIGRATION · POOL MERGE CONFLICT] map=${mapName} pcid=${pcid} prev=${JSON.stringify(prev)} next=${JSON.stringify(nextVal)}`,
        );
      }
    }
    map[pcid] = nextVal;
  }

  const mergedPm = {};
  for (const [pcid, row] of Object.entries(mergedPcm)) {
    const u = String(row.masterImageUrl || "").trim();
    if (u) poolMergePutString(mergedPm, "projectMasterImages", pcid, u);
  }
  const mergedPam = {};
  for (const [pcid, cap] of Object.entries(pcidToCanonicalApproval)) {
    if (cap && typeof cap === "object") poolMergePutObject(mergedPam, "projectCharacterApprovalMap", pcid, { ...cap });
  }

  for (const key of Object.keys(oldPoolPm)) {
    if (!looksLikePcidKey(key) || allPlanCharIds.has(key)) continue;
    const next = String(oldPoolPm[key] ?? "").trim();
    if (!next || !Object.prototype.hasOwnProperty.call(mergedPm, key)) continue;
    poolMergePutString(mergedPm, "projectMasterImages", key, next);
  }
  for (const key of Object.keys(oldPoolPam)) {
    if (!looksLikePcidKey(key) || allPlanCharIds.has(key)) continue;
    const next = oldPoolPam[key];
    if (!next || typeof next !== "object" || !Object.prototype.hasOwnProperty.call(mergedPam, key)) continue;
    poolMergePutObject(mergedPam, "projectCharacterApprovalMap", key, { ...next });
  }

  const mergedPbn = { ...globalNkToPcid };

  function logOrphanPool(mapName, oldMap) {
    if (!oldMap || typeof oldMap !== "object") return;
    for (const key of Object.keys(oldMap)) {
      if (looksLikePcidKey(key)) continue;
      if (!allPlanCharIds.has(key)) {
        console.warn(`[PCID MIGRATION · ORPHAN POOL KEY] ${mapName}.${key}`);
      }
    }
  }

  logOrphanPool("projectCharacterMasters", oldPoolPcm);
  logOrphanPool("projectMasterImages", oldPoolPm);
  logOrphanPool("projectCharacterApprovalMap", oldPoolPam);

  for (const key of Object.keys(oldPoolPcm)) {
    if (looksLikePcidKey(key)) continue;
    if (!allPlanCharIds.has(key)) mergedPcm[key] = oldPoolPcm[key];
  }
  for (const key of Object.keys(oldPoolPm)) {
    if (looksLikePcidKey(key)) continue;
    if (!allPlanCharIds.has(key)) mergedPm[key] = oldPoolPm[key];
  }
  for (const key of Object.keys(oldPoolPam)) {
    if (looksLikePcidKey(key)) continue;
    if (!allPlanCharIds.has(key)) mergedPam[key] = oldPoolPam[key];
  }

  out.projectMasterImages = mergedPm;
  out.projectMasterByCharName = mergedPbn;
  out.projectCharacterApprovalMap = mergedPam;
  out.projectCharacterMasters = mergedPcm;
  out.chapters = chapters;
  out.projectSchemaVersion = SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID;

  console.info(`[PCID MIGRATION · VOICE REMAP] ${voiceRemapCount}`);
  console.info(`[PCID MIGRATION · DIALOG LINES REMAP] ${dialogLineRemapCount}`);
  console.info(
    `[PCID MIGRATION] done chapters=${chapters.length} voiceRemap=${voiceRemapCount} voiceBucketsCollapsed=${voiceBucketsCollapsedCount} dialogLineRemap=${dialogLineRemapCount}`,
  );
  console.info(
    `[PCID MIGRATION · PENDING REVIEW POLICY] nonPending=${pendingPolicyTally.nonPending} pending=${pendingPolicyTally.pending} reasons=${JSON.stringify(pendingPolicyTally.reasons)}`,
  );

  return out;
}

/**
 * Allinea `masterImages` con `masterByCharName[nome]` per il cast del piano.
 * Legacy: chiavi `char_N` e valori URL. Schema ≥2 / layout pcid: chiavi `pcid_*` in `masterImages`, valori `pcid_*` in `masterByCharName`, URL da `projectCharacterMasters[pcid].masterImageUrl` o da `masterImages[pcid]` se HTTP.
 * In conflitto (legacy URL) vince il pool per nome; in layout pcid vince il `pcid` del pool su mismatch nome↔pcid.
 * @returns {{ masterImages: Record<string,string>, masterByCharName: Record<string,string>, mismatches: object[] }}
 */
export function reconcileCharacterMasterMaps(plan, masterImages, masterByCharName, projectCharacterMasters = {}, opts = {}) {
  const pcm = projectCharacterMasters && typeof projectCharacterMasters === "object" ? projectCharacterMasters : {};
  const mi = { ...(masterImages && typeof masterImages === "object" ? masterImages : {}) };
  const mbn = { ...(masterByCharName && typeof masterByCharName === "object" ? masterByCharName : {}) };
  const mismatches = [];
  const forcePcid = opts.forcePcidMode === true;
  const pcidMode =
    forcePcid ||
    inferPcidMasterLayout(plan, mi, mbn) ||
    (plan?.characters || []).some((c) => looksLikePcidKey(c?.pcid));

  if (!pcidMode) {
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

  for (const [k, v] of Object.entries(mi)) {
    if (!looksLikePcidKey(k)) continue;
    const vs = String(v ?? "").trim();
    if (vs && !isHttpMasterUrl(vs)) {
      delete mi[k];
      mismatches.push({ fix: "removed_invalid_masterImages_value", key: k, value: vs });
    }
  }

  for (const c of plan?.characters || []) {
    if (!c?.id) continue;
    const nk = normCharNameForMasterPool(c.name);
    const rawPoolRef = nk ? String(mbn[nk] ?? "").trim() : "";
    let poolPcid = looksLikePcidKey(rawPoolRef) ? rawPoolRef : "";
    if (nk && rawPoolRef && !poolPcid && isHttpMasterUrl(rawPoolRef)) {
      const guess = (plan?.characters || []).find((x) => normCharNameForMasterPool(x?.name) === nk);
      const gp = guess?.pcid && looksLikePcidKey(guess.pcid) ? String(guess.pcid).trim() : "";
      if (gp) {
        poolPcid = gp;
        mbn[nk] = gp;
      }
    }
    let charPcid = looksLikePcidKey(c.pcid) ? String(c.pcid).trim() : "";
    if (poolPcid && charPcid && poolPcid !== charPcid) {
      mismatches.push({
        characterId: c.id,
        characterName: c.name,
        chapterPcid: charPcid,
        poolPcid,
        fix: "pcid_realigned_from_name_pool",
      });
      charPcid = poolPcid;
      c.pcid = poolPcid;
    } else if (!charPcid && poolPcid) {
      c.pcid = poolPcid;
      charPcid = poolPcid;
    }
    const effPcid = charPcid || poolPcid;
    if (!effPcid) continue;

    const url = masterUrlFromMiOrPcm(effPcid, c.id, mi, pcm);
    if (nk) {
      mbn[nk] = effPcid;
    }
    if (url && isHttpMasterUrl(url)) {
      mi[effPcid] = url;
    }
    const id = String(c.id).trim();
    if (id && id !== effPcid && mi[id] != null) {
      const uid = String(mi[id]).trim();
      if (isHttpMasterUrl(uid) && (!mi[effPcid] || !String(mi[effPcid]).trim())) {
        mi[effPcid] = uid;
      }
      delete mi[id];
    }
  }

  return { masterImages: mi, masterByCharName: mbn, mismatches };
}

/**
 * Sorgente canonica per personaggio: legacy con chiavi `char_N`, schema pcid con chiavi `pcid_*`.
 * `pendingManualReview` = true quando id e nome concordavano sullo stesso URL (possibile errore condiviso) o solo id (solo ramo legacy).
 * @returns {Record<string, { characterId: string, characterName: string, masterImageUrl: string, approved: boolean, updatedAt: string, source: string, pendingManualReview: boolean, characterMasterPrompt?: string, lastCharacterRegenerationPrompt?: string, characterPromptHistory?: { prompt: string, at: string }[], priorMasterImageUrls?: string[] }>}
 */
export function migrateLegacyToProjectCharacterMasters(
  plan,
  masterImages,
  masterByCharName,
  characterApprovalMap,
  projectCharacterMasters = {},
  opts = {},
) {
  const out = {};
  const mi = masterImages && typeof masterImages === "object" ? masterImages : {};
  const mbn = masterByCharName && typeof masterByCharName === "object" ? masterByCharName : {};
  const cap = characterApprovalMap && typeof characterApprovalMap === "object" ? characterApprovalMap : {};
  const pcm = projectCharacterMasters && typeof projectCharacterMasters === "object" ? projectCharacterMasters : {};
  const now = new Date().toISOString();
  const forcePcid = opts.forcePcidMode === true;
  const pcidMode =
    forcePcid ||
    inferPcidMasterLayout(plan, mi, mbn) ||
    (plan?.characters || []).some((c) => looksLikePcidKey(c?.pcid));

  if (!pcidMode) {
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
          pendingManualReview = false;
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

  for (const c of plan?.characters || []) {
    if (!c?.id) continue;
    const p = String(c.pcid ?? "").trim();
    if (!looksLikePcidKey(p)) {
      console.warn(
        `[SCENOGRAFIE migrateLegacyToPCM] personaggio senza pcid valido, skip characterId=${c.id} name=${c.name ?? ""}`,
      );
      continue;
    }
    const url = masterUrlFromMiOrPcm(p, c.id, mi, pcm);
    if (!url || !isHttpMasterUrl(url)) continue;
    const ap = cap[p] || cap[c.id];
    out[p] = {
      characterId: c.id,
      characterName: c.name,
      masterImageUrl: url,
      approved: ap?.approved === true,
      updatedAt: now,
      source: "migrated_pcid_layout",
      pendingManualReview: false,
    };
  }
  return out;
}

/**
 * Aggiorna `projectCharacterMasters` dopo riconciliazione delle mappe legacy o pcid.
 * Preserva righe con `source === user_canonical_lock` (URL scelto dall'utente).
 */
export function mergeProjectCharacterMastersFromLegacy(
  plan,
  prevPcm,
  masterImages,
  masterByCharName,
  characterApprovalMap,
  opts = {},
) {
  const filled = migrateLegacyToProjectCharacterMasters(
    plan,
    masterImages,
    masterByCharName,
    characterApprovalMap,
    prevPcm && typeof prevPcm === "object" ? prevPcm : {},
    opts,
  );
  const next = { ...(prevPcm && typeof prevPcm === "object" ? prevPcm : {}) };
  const forcePcid = opts.forcePcidMode === true;
  const pcidMode =
    forcePcid ||
    inferPcidMasterLayout(plan, masterImages, masterByCharName) ||
    (plan?.characters || []).some((c) => looksLikePcidKey(c?.pcid));

  if (!pcidMode) {
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

  const allowedPcids = new Set(
    (plan?.characters || [])
      .map((c) => (looksLikePcidKey(c?.pcid) ? String(c.pcid).trim() : ""))
      .filter(Boolean),
  );
  const planCharIds = new Set((plan?.characters || []).map((c) => c.id).filter(Boolean));
  for (const k of Object.keys(next)) {
    if (looksLikePcidKey(k)) {
      if (!allowedPcids.has(k)) delete next[k];
    } else if (!planCharIds.has(k)) {
      delete next[k];
    }
  }
  for (const c of plan?.characters || []) {
    const p = looksLikePcidKey(c?.pcid) ? String(c.pcid).trim() : "";
    if (!p) continue;
    const cur = next[p];
    if (cur?.source === PCM_SOURCE_USER_CANONICAL_LOCK) {
      if (cur.characterName !== c.name) {
        next[p] = { ...cur, characterName: c.name, updatedAt: new Date().toISOString() };
      }
      continue;
    }
    if (filled[p]) {
      const merged = { ...filled[p] };
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
      next[p] = merged;
    } else {
      delete next[p];
    }
  }
  return next;
}

/**
 * Deriva `masterImages` / `masterByCharName` dalla mappa canonica (cache salvabile, non fonte di verità).
 * In layout pcid: `masterImages[pcid]` = URL HTTP, `masterByCharName[normName]` = `pcid`.
 */
export function syncLegacyMapsFromCanonicalPlan(plan, projectCharacterMasters) {
  const pcm = projectCharacterMasters && typeof projectCharacterMasters === "object" ? projectCharacterMasters : {};
  const mi = {};
  const mbn = {};
  const pcidMode =
    inferPcidMasterLayout(plan, {}, {}) || (plan?.characters || []).some((c) => looksLikePcidKey(c?.pcid));
  for (const c of plan?.characters || []) {
    if (!c?.id) continue;
    if (pcidMode && looksLikePcidKey(c.pcid)) {
      const p = String(c.pcid).trim();
      const row = pcm[p];
      const u = row?.masterImageUrl ? String(row.masterImageUrl).trim() : "";
      if (!u || !isHttpMasterUrl(u)) continue;
      mi[p] = u;
      const nk = normCharNameForMasterPool(c.name);
      if (nk) mbn[nk] = p;
      continue;
    }
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
  const usePcidMerge =
    schemaAtLeastPcidWorkspace(workspace) ||
    inferPcidMasterLayout(d.plan, { ...(d.masterImages || {}), ...pm }, { ...(d.masterByCharName || {}), ...pbn });

  const merged = {
    ...d,
    masterImages: { ...(d.masterImages || {}), ...pm },
    masterByCharName: { ...(d.masterByCharName || {}), ...pbn },
    characterApprovalMap: { ...(d.characterApprovalMap || {}), ...pam },
    projectCharacterMasters: usePcidMerge
      ? { ...pcmPool, ...pcmChapter }
      : { ...pcmChapter, ...pcmPool },
  };
  if (merged.plan?.characters?.length) {
    if (usePcidMerge) {
      assignPcidsFromPoolToPlanCharacters(merged.plan, merged.masterByCharName);
      rekeyChapterMasterMapsCharIdToPcid(merged);
      merged.projectCharacterMasters = mergePcmChapterAndPoolForPlan(merged.plan, pcmChapter, pcmPool);
    }
    const r = reconcileCharacterMasterMaps(
      merged.plan,
      merged.masterImages,
      merged.masterByCharName,
      merged.projectCharacterMasters || {},
      { forcePcidMode: usePcidMerge },
    );
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
      merged.projectCharacterMasters || {},
      { forcePcidMode: usePcidMerge },
    );
    const mergedPcm = { ...(merged.projectCharacterMasters || {}) };
    if (usePcidMerge) {
      for (const c of merged.plan.characters) {
        if (!c?.id) continue;
        const p = looksLikePcidKey(c?.pcid) ? String(c.pcid).trim() : "";
        if (!p) continue;
        const cur = mergedPcm[p];
        const hasUrl = cur && String(cur.masterImageUrl || "").trim();
        if (!hasUrl && filled[p]) mergedPcm[p] = filled[p];
      }
    } else {
      for (const c of merged.plan.characters) {
        if (!c?.id) continue;
        const cur = mergedPcm[c.id];
        const hasUrl = cur && String(cur.masterImageUrl || "").trim();
        if (!hasUrl && filled[c.id]) mergedPcm[c.id] = filled[c.id];
      }
    }
    merged.projectCharacterMasters = mergedPcm;
    const cacheFromCanonical = syncLegacyMapsFromCanonicalPlan(merged.plan, merged.projectCharacterMasters || {});
    merged.masterImages = cacheFromCanonical.masterImages;
    merged.masterByCharName = cacheFromCanonical.masterByCharName;
    console.info("[CANONICAL_PCM] merge_chapter+pool: masterImages/masterByCharName rigenerati da projectCharacterMasters");
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
    const r = reconcileCharacterMasterMaps(inner.plan, inner.masterImages || {}, inner.masterByCharName || {}, {});
    inner.masterImages = r.masterImages;
    inner.masterByCharName = r.masterByCharName;
    inner.projectCharacterMasters = migrateLegacyToProjectCharacterMasters(
      inner.plan,
      inner.masterImages,
      inner.masterByCharName,
      inner.characterApprovalMap || {},
      {},
      {},
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
            {},
            {},
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
    const wsPcid = schemaAtLeastPcidWorkspace(loaded);
    for (const ch of loaded.chapters || []) {
      const data = ch?.data;
      const plan = data?.plan;
      if (!data || !plan?.characters?.length) continue;
      if (wsPcid) {
        assignPcidsFromPoolToPlanCharacters(plan, loaded.projectMasterByCharName || {});
        rekeyChapterMasterMapsCharIdToPcid({
          plan,
          masterImages: data.masterImages,
          characterApprovalMap: data.characterApprovalMap,
          projectCharacterMasters: data.projectCharacterMasters,
        });
      }
      const pcmPre = data.projectCharacterMasters && typeof data.projectCharacterMasters === "object" ? data.projectCharacterMasters : {};
      const r = reconcileCharacterMasterMaps(
        plan,
        data.masterImages || {},
        data.masterByCharName || {},
        pcmPre,
        { forcePcidMode: wsPcid },
      );
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
        pcmPre,
        { forcePcidMode: wsPcid },
      );
      const existingPcm = data.projectCharacterMasters && typeof data.projectCharacterMasters === "object" ? data.projectCharacterMasters : {};
      const nextPcm = { ...existingPcm };
      if (wsPcid) {
        for (const c of plan.characters) {
          if (!c?.id) continue;
          const p = looksLikePcidKey(c?.pcid) ? String(c.pcid).trim() : "";
          if (!p) continue;
          if (!nextPcm[p]?.masterImageUrl?.trim() && filled[p]) nextPcm[p] = filled[p];
        }
      } else {
        for (const c of plan.characters) {
          if (!c?.id) continue;
          if (!nextPcm[c.id]?.masterImageUrl?.trim() && filled[c.id]) nextPcm[c.id] = filled[c.id];
        }
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
/**
 * Workspace da wizard story-driven (piano già validato + meta traccia).
 * @param {{
 *   title: string,
 *   description: string,
 *   projectStyle: object|null,
 *   storyPrompt: string,
 *   targetFilmDurationSec?: number,
 *   plan: object,
 *   storyAnalysis?: object|null,
 *   storyPreproductionBundle?: object|null,
 *   selectedSceneIds?: string[],
 *   runtimeHints?: object|null,
 * }} opts
 */
export function buildScenografiaWorkspaceFromStoryWizard(opts) {
  const now = new Date().toISOString();
  const t = String(opts.title || "").trim();
  const d = String(opts.description || "").trim();
  const story = String(opts.storyPrompt || "").trim();
  const ps = opts.projectStyle && typeof opts.projectStyle === "object" ? { ...opts.projectStyle } : null;
  const plan = opts.plan && typeof opts.plan === "object" ? opts.plan : null;
  const targetSec =
    typeof opts.targetFilmDurationSec === "number" && Number.isFinite(opts.targetFilmDurationSec)
      ? opts.targetFilmDurationSec
      : null;

  /** Commit completo: [] (nessuna pre-selezione). Avvio mirato: passare es. [firstSceneId]. */
  const selected = Array.isArray(opts.selectedSceneIds) ? [...opts.selectedSceneIds] : [];

  const baseHints = { sceneExecuteMode: "ALL", reuseMastersNext: false };
  const hints =
    opts.runtimeHints && typeof opts.runtimeHints === "object" ? { ...baseHints, ...opts.runtimeHints } : baseHints;

  const chapterPayload = {
    ...emptyScenografiaProjectPayload(),
    prompt: story || d,
    scenografiaProjectTitle: t,
    projectStyle: ps,
    projectStyleLocked: true,
    plan,
    selectedSceneIds: selected,
    runtimeHints: hints,
    scenografiaPhase: "plan",
    storyDrivenPreproduction:
      opts.storyPreproductionBundle && typeof opts.storyPreproductionBundle === "object"
        ? opts.storyPreproductionBundle
        : {
            version: 1,
            storyPrompt: story,
            targetFilmDurationSec: targetSec,
            storyAnalysis: opts.storyAnalysis || null,
            committedAt: now,
          },
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
    storyDrivenMeta: {
      storyPrompt: story,
      targetFilmDurationSec: targetSec,
      storyAnalysisSnapshot: opts.storyAnalysis || null,
      projectAutoPlanningStatus: "committed",
      committedAt: now,
    },
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
    /** Narratori di progetto (entità distinte dai personaggi). */
    projectNarrators: [],
    /** none → assembly (auto-montaggio avviato) → done */
    finalMontagePhase: "none",
    /** Ordine clip + note narrative per il montatore automatico (placeholder). */
    finalMontagePlan: { orderedClipIds: [], orderedTimelineEntryIds: [], narrativeBeatNotes: "" },
    finalFilmMontage: emptyFinalFilmMontage(),
    timelinePlan: { approved: false, approvedAt: null, entries: [] },
    runtimeHints: { sceneExecuteMode: "ALL", reuseMastersNext: false },
    /** Piano pre-produzione story-driven (opzionale). */
    storyDrivenPreproduction: null,
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

/**
 * Legge JSON progetto da disco/localStorage **senza** `ensureWorkspace` (per baseline heal / test).
 * @returns {Promise<object|null>}
 */
export async function loadScenografiaProjectParsedFromStorage(projectId) {
  if (!projectId) return null;
  if (hasElectronJsonStorage()) {
    try {
      const res = await window.electronAPI.loadJson(scenografiaProjectFilePath(projectId));
      const data = normalizeLoadResult(res);
      if (data && (data.workspaceVersion === SCENOGRAFIA_WORKSPACE_VERSION || data.version === SCENOGRAFIA_PROJECT_VERSION)) {
        return data;
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
    return data;
  } catch {
    return null;
  }
}

/**
 * Legge il workspace da disco/localStorage **senza** hook migrazione PCID (usato da save e internamente).
 * @returns {Promise<ScenografiaPersistedProject|null>}
 */
export async function loadScenografiaProjectByIdFromStorage(projectId) {
  const parsed = await loadScenografiaProjectParsedFromStorage(projectId);
  return parsed ? ensureWorkspace(parsed) : null;
}

/** Serializza load+migrazione per progetto (STEP 2 concorrenza in memoria). */
const scenografiaPcidLoadInflight = new Map();

/** @type {((p: object) => object) | null} — solo harness test (es. migrazione lenta per concorrenza). */
let pcidMigrateImplForTests = null;

/** @internal harness */
export function __setPcidMigrateImplForTests(fn) {
  pcidMigrateImplForTests = typeof fn === "function" ? fn : null;
}

/** @internal harness */
export function __clearPcidMigrateImplForTests() {
  pcidMigrateImplForTests = null;
}

function readProjectSchemaVersionForPcid(ws) {
  const v = ws?.projectSchemaVersion;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function sortedStringKeys(obj) {
  if (!obj || typeof obj !== "object") return [];
  return Object.keys(obj)
    .map((k) => String(k))
    .sort((a, b) => a.localeCompare(b));
}

function stableMasterByCharNameEntries(mbn) {
  const o = mbn && typeof mbn === "object" ? mbn : {};
  return sortedStringKeys(o).map((k) => `${k}=${String(o[k] ?? "").trim()}`);
}

/**
 * Rimuove da `deletedSceneIds` gli id che non esistono in `plan.scenes` (orfani / ghost).
 * Non modifica `sceneResults` né aggiunge id a `deletedSceneIds`.
 * @param {object} data — payload capitolo (mutato se serve)
 * @returns {{ wasHealed: boolean, removedCount: number }}
 */
export function healOrphanDeletedSceneIdsInChapterData(data) {
  const d = data && typeof data === "object" ? data : {};
  const plan = d.plan && typeof d.plan === "object" ? d.plan : {};
  const sceneIds = new Set(
    (Array.isArray(plan.scenes) ? plan.scenes : [])
      .map((s) => String(s?.id || "").trim())
      .filter(Boolean),
  );
  const raw = Array.isArray(d.deletedSceneIds) ? d.deletedSceneIds : [];
  const beforeNorm = raw.map((id) => String(id || "").trim()).filter(Boolean);
  const filtered = beforeNorm.filter((sid) => sceneIds.has(sid));
  if (filtered.length === beforeNorm.length && filtered.every((v, i) => v === beforeNorm[i])) {
    return { wasHealed: false, removedCount: 0 };
  }
  d.deletedSceneIds = filtered;
  return { wasHealed: true, removedCount: beforeNorm.length - filtered.length };
}

function chapterDataHealFingerprint(data) {
  const d = data && typeof data === "object" ? data : {};
  const plan = d.plan || {};
  const chars = (plan.characters || []).map((c) => `${String(c?.id || "").trim()}/${String(c?.pcid || "").trim()}`);
  chars.sort();
  const delSrc = Array.isArray(d.deletedSceneIds) ? d.deletedSceneIds : [];
  const delSorted = delSrc
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return [
    chars.join(";"),
    sortedStringKeys(d.masterImages || {}).join(","),
    stableMasterByCharNameEntries(d.masterByCharName || {}).join(";"),
    sortedStringKeys(d.projectCharacterMasters || {}).join(","),
    sortedStringKeys(d.characterApprovalMap || {}).join(","),
    delSorted.join(","),
  ].join("|");
}

/**
 * Fingerprint campi rilevanti per heal/self-persist (pool + capitoli), stabile rispetto all'ordine chiavi oggetto.
 * @param {object} ws
 */
export function fingerprintWorkspaceHealBaseline(ws) {
  if (!ws || typeof ws !== "object") return "";
  const parts = [];
  parts.push(`v:${readProjectSchemaVersionForPcid(ws)}`);
  parts.push(`pbn:${stableMasterByCharNameEntries(ws.projectMasterByCharName || {}).join(";")}`);
  parts.push(`pmk:${sortedStringKeys(ws.projectMasterImages || {}).join(",")}`);
  parts.push(`ppmk:${sortedStringKeys(ws.projectCharacterMasters || {}).join(",")}`);
  const chap = Array.isArray(ws.chapters) ? [...ws.chapters] : [];
  chap.sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
  for (const ch of chap) {
    const d = ch?.data && typeof ch.data === "object" ? ch.data : {};
    parts.push(`chid:${String(ch?.id || "")}|${chapterDataHealFingerprint(d)}`);
  }
  return parts.join("\x1f");
}

/**
 * STEP 3 — dopo migrazione: merge capitolo+pool su ogni capitolo; se serve, persiste workspace (stesso pattern STEP 2).
 * @param {string} projectId
 * @param {object} workspace — già `ensureWorkspace` + eventuale migrazione schema
 * @param {{ saveScenografiaProjectById?: (id: string, d: object) => Promise<boolean>, diskBaselineFingerprint?: string, diskProjectSchemaVersion?: number }} [deps]
 *   `diskBaselineFingerprint` / `diskProjectSchemaVersion`: snapshot pre-`ensureWorkspace` dal load (solo confronto se schema disco ≥ 2).
 */
export async function applyScenografiaPcidPostMergeHealOnLoad(projectId, workspace, deps = {}) {
  const saveFn = deps.saveScenografiaProjectById ?? saveScenografiaProjectById;
  const diskFp = typeof deps.diskBaselineFingerprint === "string" ? deps.diskBaselineFingerprint : null;
  const diskSchema =
    typeof deps.diskProjectSchemaVersion === "number" && Number.isFinite(deps.diskProjectSchemaVersion)
      ? deps.diskProjectSchemaVersion
      : null;

  if (!projectId || !workspace || typeof workspace !== "object" || !isWorkspacePayload(workspace)) {
    console.info(`[PCID HEAL ON LOAD] projectId=${String(projectId || "")} healedChapters=0 saved=false (no workspace)`);
    return workspace;
  }
  if (!schemaAtLeastPcidWorkspace(workspace)) {
    console.info(`[PCID HEAL ON LOAD] projectId=${projectId} healedChapters=0 saved=false (schema<2)`);
    return workspace;
  }

  const preMergeFp = fingerprintWorkspaceHealBaseline(workspace);
  let healedChapters = 0;
  for (const ch of workspace.chapters || []) {
    if (!ch?.data || typeof ch.data !== "object") continue;
    const sliceBefore = chapterDataHealFingerprint(ch.data);
    ch.data = mergeChapterDataWithProjectCharacterPool(ch.data, workspace);
    const delHeal = healOrphanDeletedSceneIdsInChapterData(ch.data);
    if (delHeal.wasHealed) {
      console.info(
        `[PCID HEAL · DELETED SCENES] chapterId=${String(ch?.id || "")} removedOrphans=${delHeal.removedCount}`,
      );
    }
    if (sliceBefore !== chapterDataHealFingerprint(ch.data)) healedChapters++;
  }
  const postMergeFp = fingerprintWorkspaceHealBaseline(workspace);

  const mergeChanged = preMergeFp !== postMergeFp;
  const diskDriftPersists =
    diskFp != null &&
    diskSchema != null &&
    diskSchema >= SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID &&
    postMergeFp !== diskFp;

  let saved = false;
  if (mergeChanged || diskDriftPersists) {
    try {
      saved = (await saveFn(projectId, workspace)) === true;
      if (!saved) {
        console.warn(`[PCID HEAL · SAVE FAILED] projectId=${projectId}`);
      }
    } catch (e) {
      console.warn(`[PCID HEAL · SAVE FAILED] projectId=${projectId} message=${e?.message || String(e)}`);
    }
  }

  console.info(`[PCID HEAL ON LOAD] projectId=${projectId} healedChapters=${healedChapters} saved=${saved}`);
  return workspace;
}

/**
 * Migrazione PCID al load (STEP 2). `workspace` deve essere già `ensureWorkspace`.
 * @param {string} projectId
 * @param {object} workspace
 * @param {{ migrateProjectToPcidSchema?: (p: object) => object | Promise<object>, saveScenografiaProjectById?: (id: string, d: object) => Promise<boolean>, onHookMeta?: (m: { schemaBefore: number, schemaAfter: number, wasMigrated: boolean }) => void }} [deps]
 * @returns {Promise<object>}
 */
export async function applyScenografiaPcidMigrationOnLoad(projectId, workspace, deps = {}) {
  const migrateFn =
    deps.migrateProjectToPcidSchema ?? pcidMigrateImplForTests ?? migrateProjectToPcidSchema;
  const saveFn = deps.saveScenografiaProjectById ?? saveScenografiaProjectById;

  const schemaBefore = readProjectSchemaVersionForPcid(workspace);
  const needsMigrate = schemaBefore < SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID;

  let out = workspace;
  let schemaAfter = schemaBefore;
  let wasMigrated = false;

  if (needsMigrate) {
    try {
      const migratedRaw = migrateFn(JSON.parse(JSON.stringify(workspace)));
      out =
        migratedRaw && typeof migratedRaw.then === "function" ? await migratedRaw : migratedRaw;
      schemaAfter = readProjectSchemaVersionForPcid(out);
      wasMigrated = true;
      const saveOk = await saveFn(projectId, out);
      if (!saveOk) {
        console.warn(`[PCID MIGRATION · SAVE FAILED] projectId=${projectId}`);
      }
    } catch (e) {
      console.error(
        `[PCID MIGRATION · FATAL] projectId=${projectId} message=${e?.message || String(e)} stack=${e?.stack || ""}`,
      );
      out = workspace;
      schemaAfter = schemaBefore;
      wasMigrated = false;
    }
  } else {
    schemaAfter = readProjectSchemaVersionForPcid(workspace);
  }

  if (typeof deps.onHookMeta === "function") {
    deps.onHookMeta({ schemaBefore, schemaAfter, wasMigrated });
  }
  console.info(
    `[PCID MIGRATION · LOAD HOOK] projectId=${projectId} schemaBefore=${schemaBefore} schemaAfter=${schemaAfter} wasMigrated=${wasMigrated}`,
  );
  return out;
}

/**
 * @param {string} projectId
 * @param {{ migrateProjectToPcidSchema?: function, saveScenografiaProjectById?: (id: string, d: object) => Promise<boolean>, onHookMeta?: function }} [deps]
 * @returns {Promise<ScenografiaPersistedProject|null>}
 */
export async function loadScenografiaProjectById(projectId, deps = {}) {
  if (!projectId) return null;
  if (scenografiaPcidLoadInflight.has(projectId)) {
    return await scenografiaPcidLoadInflight.get(projectId);
  }
  const p = (async () => {
    try {
      const parsed = await loadScenografiaProjectParsedFromStorage(projectId);
      if (!parsed) return null;
      const diskClone = JSON.parse(JSON.stringify(parsed));
      const diskHealFp = fingerprintWorkspaceHealBaseline(diskClone);
      const diskSchema = readProjectSchemaVersionForPcid(diskClone);
      ensureWorkspace(parsed);
      let ws = parsed;
      ws = await applyScenografiaPcidMigrationOnLoad(projectId, ws, deps);
      if (schemaAtLeastPcidWorkspace(ws)) {
        ws = await applyScenografiaPcidPostMergeHealOnLoad(projectId, ws, {
          ...deps,
          diskBaselineFingerprint: diskHealFp,
          diskProjectSchemaVersion: diskSchema,
        });
      } else {
        console.info(`[PCID HEAL ON LOAD] projectId=${projectId} healedChapters=0 saved=false (schema<2 skip)`);
      }
      return ws;
    } finally {
      scenografiaPcidLoadInflight.delete(projectId);
    }
  })();
  scenografiaPcidLoadInflight.set(projectId, p);
  return await p;
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
  const v2 = schemaAtLeastPcidWorkspace(w);
  const plan = chapterPayload.plan;
  const byCharId = Object.fromEntries((plan?.characters || []).filter((c) => c?.id).map((c) => [c.id, c]));
  if (chapterPayload.masterImages && typeof chapterPayload.masterImages === "object") {
    if (v2) {
      for (const [k, v] of Object.entries(chapterPayload.masterImages)) {
        let pk = k;
        if (!looksLikePcidKey(k)) {
          const c = byCharId[k];
          const p = c?.pcid && looksLikePcidKey(c.pcid) ? String(c.pcid).trim() : "";
          if (p) pk = p;
          else {
            console.warn(`[SCENOGRAFIE upsert chapter] masterImages key non-pcid senza pcid sul personaggio, skip key=${k}`);
            continue;
          }
        }
        w.projectMasterImages[pk] = v;
      }
    } else {
      w.projectMasterImages = { ...(w.projectMasterImages || {}), ...chapterPayload.masterImages };
    }
  }
  if (chapterPayload.masterByCharName && typeof chapterPayload.masterByCharName === "object") {
    if (v2) {
      for (const [nk, val] of Object.entries(chapterPayload.masterByCharName)) {
        const s = String(val ?? "").trim();
        if (looksLikePcidKey(s)) {
          w.projectMasterByCharName[nk] = s;
        } else if (isHttpMasterUrl(s)) {
          const c = (plan?.characters || []).find((x) => normCharNameForMasterPool(x?.name) === nk);
          const p = c?.pcid && looksLikePcidKey(c.pcid) ? String(c.pcid).trim() : "";
          if (p) {
            w.projectMasterByCharName[nk] = p;
            if (s) w.projectMasterImages[p] = w.projectMasterImages[p] ?? s;
          } else {
            console.warn(
              `[SCENOGRAFIE upsert chapter] masterByCharName URL senza pcid sul personaggio, skip nk=${nk}`,
            );
          }
        } else if (s) {
          console.warn(`[SCENOGRAFIE upsert chapter] masterByCharName valore non riconosciuto, skip nk=${nk}`);
        }
      }
    } else {
      w.projectMasterByCharName = { ...(w.projectMasterByCharName || {}), ...chapterPayload.masterByCharName };
    }
  }
  if (chapterPayload.characterApprovalMap && typeof chapterPayload.characterApprovalMap === "object") {
    if (v2) {
      const nextPam = { ...(w.projectCharacterApprovalMap || {}) };
      for (const [k, v] of Object.entries(chapterPayload.characterApprovalMap)) {
        let pk = k;
        if (!looksLikePcidKey(k)) {
          const c = byCharId[k];
          const p = c?.pcid && looksLikePcidKey(c.pcid) ? String(c.pcid).trim() : "";
          if (p) pk = p;
          else {
            console.warn(`[SCENOGRAFIE upsert chapter] approval key non-pcid senza pcid sul personaggio, skip key=${k}`);
            continue;
          }
        }
        nextPam[pk] = mergeCharacterApprovalState(nextPam[pk], v);
      }
      w.projectCharacterApprovalMap = nextPam;
    } else {
      w.projectCharacterApprovalMap = {
        ...(w.projectCharacterApprovalMap || {}),
        ...chapterPayload.characterApprovalMap,
      };
    }
  }
  if (chapterPayload.projectCharacterMasters && typeof chapterPayload.projectCharacterMasters === "object") {
    if (v2) {
      for (const [k, row] of Object.entries(chapterPayload.projectCharacterMasters)) {
        let pk = k;
        if (!looksLikePcidKey(k)) {
          const c = byCharId[k];
          const p = c?.pcid && looksLikePcidKey(c.pcid) ? String(c.pcid).trim() : "";
          if (p) pk = p;
          else {
            console.warn(
              `[SCENOGRAFIE upsert chapter] projectCharacterMasters key char_N senza pcid sul personaggio, skip key=${k}`,
            );
            continue;
          }
        }
        const prev = w.projectCharacterMasters[pk] && typeof w.projectCharacterMasters[pk] === "object" ? w.projectCharacterMasters[pk] : {};
        w.projectCharacterMasters[pk] = { ...prev, ...row };
      }
    } else {
      w.projectCharacterMasters = { ...(w.projectCharacterMasters || {}), ...chapterPayload.projectCharacterMasters };
    }
  }
  normalizeChapterSortOrders(w);
  return w;
}

export async function saveScenografiaProjectById(projectId, data) {
  if (!projectId) return false;
  const base = isWorkspacePayload(data) ? JSON.parse(JSON.stringify(data)) : migrateFlatToWorkspace(data);
  const existing = await loadScenografiaProjectByIdFromStorage(projectId);
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
