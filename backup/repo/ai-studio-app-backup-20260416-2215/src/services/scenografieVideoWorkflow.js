/**
 * Workflow video Scenografie (clip per scena + montaggio finale).
 * Logica pura lato dominio; chiamate HTTP in `videoClipPipeline.js` / servizi dedicati.
 */

import { getCharactersNeedingMaster } from "./scenografiePlanner.js";
import { resolveElevenLabsVoiceId, getElevenLabsApiKey } from "./elevenlabsService.js";
import {
  approvalEntryForCharacter,
  planCharacterDisplayName,
  stableCharacterKey,
  voiceMasterRawForRef,
} from "./scenografiePcidLookup.js";

/** @typedef {'narrated'|'dialogue'} ScenografiaClipType */
/** @typedef {'auto'|'manual'} ScenografiaClipDurationMode */

export const CLIP_TYPE = {
  NARRATED: "narrated",
  DIALOGUE: "dialogue",
};

/** Preset regia / movimento per clip narrato (UX + payload motore). */
export const NARRATED_CAMERA_PRESETS = [
  { id: "slow_zoom", label: "Slow zoom" },
  { id: "pan_light", label: "Pan leggero" },
  { id: "reveal", label: "Reveal" },
  { id: "smooth_camera", label: "Camera move morbido" },
  { id: "static_gentle", label: "Static gentle motion" },
];

/** Comportamento camera / regia per clip dialogato. */
export const DIALOGUE_CAMERA_BEHAVIORS = [
  { id: "over_shoulder", label: "Over the shoulder" },
  { id: "two_shot", label: "Two-shot equilibrato" },
  { id: "close_up_alternato", label: "Close-up alternato" },
  { id: "wide_establishing", label: "Wide establishing" },
  { id: "handheld_soft", label: "Handheld morbido" },
];

/** Voci placeholder ElevenLabs (id sintetici fino a integrazione API). */
export const ELEVENLABS_VOICE_PRESETS = [
  { voiceId: "eleven_it_neutral_01", label: "Narratore neutro (IT)", provider: "elevenlabs" },
  { voiceId: "eleven_it_warm_01", label: "Narratore caldo (IT)", provider: "elevenlabs" },
  { voiceId: "eleven_it_cinematic_01", label: "Narratore cinematico", provider: "elevenlabs" },
  { voiceId: "eleven_it_female_young", label: "Voce femminile giovane", provider: "elevenlabs" },
  { voiceId: "eleven_it_male_mature", label: "Voce maschile matura", provider: "elevenlabs" },
];

const MIN_CLIP_SECONDS = 3;
const PAUSE_PER_LINE_SEC = 0.35;
/** Stima euristica parole/min per TTS italiano. */
const CHARS_PER_SEC = 14;

/**
 * @param {string} text
 * @returns {number}
 */
export function estimateSpeechSecondsFromText(text) {
  const t = String(text || "").trim();
  if (!t.length) return 0;
  return Math.max(MIN_CLIP_SECONDS, Math.round((t.length / CHARS_PER_SEC + Number.EPSILON) * 10) / 10);
}

/**
 * Durata automatica stimata dal contenuto del clip (testo narratore + battute + pause).
 * @param {object} clip
 * @returns {number}
 */
export function estimateClipDurationAuto(clip) {
  if (!clip || typeof clip !== "object") return MIN_CLIP_SECONDS;
  const type = clip.clipType === CLIP_TYPE.DIALOGUE ? CLIP_TYPE.DIALOGUE : CLIP_TYPE.NARRATED;
  let sec = 0;
  if (type === CLIP_TYPE.NARRATED) {
    sec += estimateSpeechSecondsFromText(clip.narratorText);
  } else {
    const lines = Array.isArray(clip.dialogLines) ? clip.dialogLines : [];
    if (!lines.length) return 0;
    for (const line of lines) {
      sec += estimateSpeechSecondsFromText(line?.text);
      sec += PAUSE_PER_LINE_SEC;
    }
    sec = Math.max(MIN_CLIP_SECONDS, sec - PAUSE_PER_LINE_SEC);
  }
  return Math.round(sec * 10) / 10;
}

/**
 * Secondi effettivi per UI / validazione (manuale o auto).
 * @param {object} clip
 */
export function resolveClipDurationSeconds(clip) {
  if (!clip || typeof clip !== "object") return null;
  if (clip.durationMode === "manual") {
    const n = Number(clip.durationSeconds);
    if (Number.isFinite(n) && n >= MIN_CLIP_SECONDS) return Math.round(n * 10) / 10;
    return null;
  }
  const auto = estimateClipDurationAuto(clip);
  return auto > 0 ? auto : null;
}

/**
 * @param {object} line
 */
export function normalizeDialogLine(line) {
  if (!line || typeof line !== "object") return null;
  const characterId = String(line.characterId || "").trim();
  if (!characterId) return null;
  return {
    id: typeof line.id === "string" && line.id ? line.id : `dl_${Math.random().toString(36).slice(2, 10)}`,
    characterId,
    text: String(line.text ?? ""),
    voiceId: String(line.voiceId ?? "").trim(),
    action: String(line.action ?? "").trim(),
    expression: String(line.expression ?? "").trim(),
    bodyMovement: String(line.bodyMovement ?? "").trim(),
  };
}

/**
 * @param {object|null} v
 */
export function normalizeNarratorVoice(v) {
  if (!v || typeof v !== "object") return null;
  const voiceId = String(v.voiceId ?? "").trim();
  if (!voiceId) return null;
  return {
    voiceId,
    voiceLabel: typeof v.voiceLabel === "string" ? v.voiceLabel.trim() : "",
    voiceProvider: String(v.voiceProvider || "elevenlabs").trim() || "elevenlabs",
  };
}

/**
 * Personaggio in piano: voice master persistito sul progetto (non nel JSON LLM del plan).
 * @param {object|null} raw
 * @param {string} characterId
 */
export function normalizeCharacterVoiceMaster(raw, characterId) {
  const id = String(characterId || "").trim();
  if (!id) return null;
  if (!raw || typeof raw !== "object") {
    return {
      characterId: id,
      voiceId: "",
      voiceLabel: "",
      voiceProvider: "elevenlabs",
      isNarratorDefault: false,
      elevenLabs: {},
    };
  }
  const el = raw.elevenLabs && typeof raw.elevenLabs === "object" ? raw.elevenLabs : {};
  return {
    characterId: id,
    voiceId: String(raw.voiceId ?? "").trim(),
    voiceLabel: String(raw.voiceLabel ?? "").trim(),
    voiceProvider: String(raw.voiceProvider || "elevenlabs").trim() || "elevenlabs",
    isNarratorDefault: raw.isNarratorDefault === true,
    elevenLabs: {
      modelId: typeof el.modelId === "string" ? el.modelId.trim() : "",
      stability: typeof el.stability === "number" && Number.isFinite(el.stability) ? el.stability : null,
      similarity: typeof el.similarity === "number" && Number.isFinite(el.similarity) ? el.similarity : null,
    },
  };
}

/**
 * Messaggi UX se mancano dati per «Genera clip».
 * @param {object} clip
 * @param {{ characterVoiceMasters?: Record<string, object>, plan?: object|null, sceneResults?: object[] }} [ctx]
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function getClipGenerationReadiness(clip, ctx = {}) {
  const reasons = [];
  const characterVoiceMasters = ctx.characterVoiceMasters && typeof ctx.characterVoiceMasters === "object" ? ctx.characterVoiceMasters : {};
  const plan = ctx.plan ?? null;
  const sceneResults = Array.isArray(ctx.sceneResults) ? ctx.sceneResults : null;

  if (!clip || typeof clip !== "object") {
    reasons.push("Clip non valido.");
    return { ok: false, reasons };
  }
  if (!String(clip.sceneId || "").trim()) reasons.push("Seleziona una scena sorgente approvata.");
  else if (sceneResults) {
    const row = sceneResults.find((r) => r.sceneId === clip.sceneId);
    if (!row?.imageUrl) reasons.push("La scena selezionata non ha ancora un'immagine generata.");
    else if (row.approved !== true) reasons.push("La scena sorgente deve essere approvata.");
  }

  if (
    clip.status === SCENE_VIDEO_CLIP_STATUS.GENERATING_AUDIO ||
    clip.status === SCENE_VIDEO_CLIP_STATUS.GENERATING_VIDEO
  ) {
    reasons.push("Generazione già in corso per questo clip.");
  }

  if (!getElevenLabsApiKey()) reasons.push("REACT_APP_ELEVENLABS_API_KEY non configurata (.env).");
  if (!String(process.env.REACT_APP_FAL_API_KEY || "").trim()) reasons.push("REACT_APP_FAL_API_KEY non configurata (.env).");

  const type = clip.clipType === CLIP_TYPE.DIALOGUE ? CLIP_TYPE.DIALOGUE : CLIP_TYPE.NARRATED;
  const dur = resolveClipDurationSeconds(clip);
  if (dur == null) reasons.push("Imposta una durata valida (stima automatica o secondi manuali ≥ 3).");

  const charLabel = (characterId) => planCharacterDisplayName(plan, characterId);

  if (type === CLIP_TYPE.NARRATED) {
    if (!String(clip.narratorText || "").trim()) reasons.push("Inserisci il testo del narratore.");
    const nv = normalizeNarratorVoice(clip.narratorVoice);
    if (!nv?.voiceId) reasons.push("Seleziona la voce del narratore.");
    else {
      const { voiceId, error } = resolveElevenLabsVoiceId(nv.voiceId);
      if (!voiceId) reasons.push(error || "Voce narratore ElevenLabs non valida.");
    }
  } else {
    const lines = (Array.isArray(clip.dialogLines) ? clip.dialogLines : []).map(normalizeDialogLine).filter(Boolean);
    if (lines.length === 0) reasons.push("Aggiungi almeno una battuta con personaggio.");
    const resolvedVoiceIds = [];
    for (const line of lines) {
      if (!String(line.text || "").trim()) reasons.push("Ogni battuta deve avere testo.");
      const master = normalizeCharacterVoiceMaster(
        voiceMasterRawForRef(characterVoiceMasters, line.characterId, plan),
        line.characterId,
      );
      if (!String(master.voiceId || "").trim()) {
        reasons.push(`Voice master obbligatoria per «${charLabel(line.characterId)}» (scheda personaggio o step 6).`);
        continue;
      }
      const { voiceId, error } = resolveElevenLabsVoiceId(master.voiceId);
      if (!voiceId) reasons.push(`«${charLabel(line.characterId)}»: ${error || "Voce ElevenLabs non valida."}`);
      else resolvedVoiceIds.push(voiceId);
    }
    const uniq = new Set(resolvedVoiceIds);
    if (uniq.size > 1) {
      reasons.push(
        "V1: tutti i parlanti devono avere lo stesso voice ID ElevenLabs nelle voice master. Il vero multi-speaker sarà aggiunto in seguito."
      );
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/** @typedef {'draft'|'generating_audio'|'generating_video'|'ready_for_review'|'approved'|'needs_changes'|'failed'|'deleted'|'final'} SceneVideoClipStatus */

export const SCENE_VIDEO_CLIP_STATUS = {
  DRAFT: "draft",
  GENERATING_AUDIO: "generating_audio",
  GENERATING_VIDEO: "generating_video",
  READY_FOR_REVIEW: "ready_for_review",
  APPROVED: "approved",
  NEEDS_CHANGES: "needs_changes",
  FAILED: "failed",
  DELETED: "deleted",
  FINAL: "final",
};

/** Etichette UI italiane (AXSTUDIO / produzione). */
export const SCENE_VIDEO_CLIP_STATUS_LABEL = {
  draft: "Bozza",
  generating_audio: "Generazione audio",
  generating_video: "Generazione video",
  ready_for_review: "Pronto da rivedere",
  approved: "Approvato",
  needs_changes: "Da correggere",
  failed: "Errore",
  deleted: "Eliminato",
  final: "Finale",
};

/**
 * @param {object} c
 * @returns {object}
 */
export function normalizeSceneVideoClip(c) {
  if (!c || typeof c !== "object" || !c.id || !c.sceneId) return c;
  const valid = new Set(Object.values(SCENE_VIDEO_CLIP_STATUS));
  const st = valid.has(c.status) ? c.status : SCENE_VIDEO_CLIP_STATUS.DRAFT;
  const titleRaw = typeof c.title === "string" ? c.title.trim() : "";
  const labelLegacy = c.label != null ? String(c.label).trim() : "";
  const title = titleRaw || labelLegacy || "";
  const inferredType =
    c.clipType === CLIP_TYPE.DIALOGUE || c.clipType === CLIP_TYPE.NARRATED
      ? c.clipType
      : Array.isArray(c.dialogLines) && c.dialogLines.length > 0
        ? CLIP_TYPE.DIALOGUE
        : CLIP_TYPE.NARRATED;
  const durationMode = c.durationMode === "manual" ? "manual" : "auto";
  const dialogLines = (Array.isArray(c.dialogLines) ? c.dialogLines : []).map(normalizeDialogLine).filter(Boolean);
  const narratorVoice = normalizeNarratorVoice(c.narratorVoice);
  const durationSeconds =
    typeof c.durationSeconds === "number" && Number.isFinite(c.durationSeconds) && c.durationSeconds > 0
      ? Math.round(c.durationSeconds * 10) / 10
      : null;
  const cameraDirection = String(c.cameraDirection ?? "").trim();
  const clipCameraPreset = String(c.clipCameraPreset ?? "").trim();
  const mood = String(c.mood ?? "").trim();
  const emotionalIntensity = String(c.emotionalIntensity ?? "").trim();
  const dialogFirstSpeakerId = String(c.dialogFirstSpeakerId ?? "").trim();
  const dialogLineOrder = Array.isArray(c.dialogLineOrder)
    ? c.dialogLineOrder.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const genStatRaw = String(c.generationStatus ?? "idle").trim();
  const allowedGen = new Set(["idle", "audio", "video", "complete", "failed"]);
  const generationStatus = allowedGen.has(genStatRaw) ? genStatRaw : "idle";
  const audioDurationSeconds =
    typeof c.audioDurationSeconds === "number" && Number.isFinite(c.audioDurationSeconds) && c.audioDurationSeconds > 0
      ? Math.round(c.audioDurationSeconds * 10) / 10
      : null;
  return {
    id: c.id,
    sceneId: c.sceneId,
    label: title || labelLegacy,
    title: title || labelLegacy,
    clipType: inferredType,
    durationMode,
    durationSeconds,
    narratorText: String(c.narratorText ?? "").trim(),
    narratorVoice,
    dialogLines,
    dialogFirstSpeakerId,
    dialogLineOrder,
    cameraDirection: cameraDirection || (inferredType === CLIP_TYPE.NARRATED ? "slow_zoom" : ""),
    clipCameraPreset: clipCameraPreset || (inferredType === CLIP_TYPE.NARRATED ? "slow_zoom" : ""),
    mood,
    emotionalIntensity,
    backgroundMusicEnabled: c.backgroundMusicEnabled === true,
    ambientSoundEnabled: c.ambientSoundEnabled === true,
    effectsEnabled: c.effectsEnabled === true,
    audioUrl: c.audioUrl != null && String(c.audioUrl).trim() ? String(c.audioUrl).trim() : null,
    audioDurationSeconds,
    providerVideo: String(c.providerVideo ?? "").trim(),
    providerVoice: String(c.providerVoice ?? "").trim(),
    generationModel: String(c.generationModel ?? "").trim(),
    generationStatus,
    lastGenerationError:
      c.lastGenerationError != null && String(c.lastGenerationError).trim()
        ? String(c.lastGenerationError).trim()
        : null,
    videoUrl: c.videoUrl != null ? String(c.videoUrl) : null,
    status: st,
    sortOrder: typeof c.sortOrder === "number" ? c.sortOrder : 0,
    lastEditPrompt: c.lastEditPrompt ?? null,
    editHistory: Array.isArray(c.editHistory) ? c.editHistory.slice(-12) : [],
    createdAt: c.createdAt ?? null,
    updatedAt: c.updatedAt ?? null,
    includeInFinal: c.includeInFinal !== false,
  };
}

export function newSceneVideoClipId() {
  return `vc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Clip vuoto collegato a una scena (bozza) con default sensati per il builder.
 * @param {string} sceneId
 * @param {number} sortOrder
 */
export function createEmptySceneVideoClip(sceneId, sortOrder = 0) {
  const now = new Date().toISOString();
  const id = newSceneVideoClipId();
  return normalizeSceneVideoClip({
    id,
    sceneId,
    title: "",
    label: "",
    clipType: CLIP_TYPE.NARRATED,
    durationMode: "auto",
    durationSeconds: null,
    narratorText: "",
    narratorVoice: null,
    dialogLines: [],
    dialogFirstSpeakerId: "",
    dialogLineOrder: [],
    clipCameraPreset: "slow_zoom",
    cameraDirection: "over_shoulder",
    mood: "",
    emotionalIntensity: "medium",
    backgroundMusicEnabled: false,
    ambientSoundEnabled: true,
    effectsEnabled: false,
    audioUrl: null,
    audioDurationSeconds: null,
    providerVideo: "",
    providerVoice: "",
    generationModel: "",
    generationStatus: "idle",
    lastGenerationError: null,
    videoUrl: null,
    status: SCENE_VIDEO_CLIP_STATUS.DRAFT,
    sortOrder,
    lastEditPrompt: null,
    editHistory: [],
    createdAt: now,
    updatedAt: now,
    includeInFinal: true,
  });
}

export function newTimelineEntryId() {
  return `tl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Voce timeline / storyboard (ordine narrativo).
 * @typedef {{ id: string, kind: 'scene'|'clip', sceneId: string, clipId?: string|null, durationSec?: number|null }} TimelineEntry
 */

/**
 * @param {object} e
 * @returns {TimelineEntry|null}
 */
export function normalizeTimelineEntry(e) {
  if (!e || typeof e !== "object" || !e.id || !e.sceneId) return null;
  const kind = e.kind === "clip" ? "clip" : "scene";
  const durationSec =
    typeof e.durationSec === "number" && Number.isFinite(e.durationSec) && e.durationSec >= 0 ? e.durationSec : null;
  return {
    id: e.id,
    kind,
    sceneId: e.sceneId,
    clipId: kind === "clip" && e.clipId ? String(e.clipId) : null,
    durationSec,
  };
}

/**
 * @param {object} raw
 * @returns {{ approved: boolean, approvedAt: string|null, entries: TimelineEntry[] }}
 */
export function normalizeTimelinePlan(raw) {
  if (!raw || typeof raw !== "object") {
    return { approved: false, approvedAt: null, entries: [] };
  }
  const entries = Array.isArray(raw.entries)
    ? raw.entries.map((x) => normalizeTimelineEntry(x)).filter(Boolean)
    : [];
  return {
    approved: raw.approved === true,
    approvedAt: raw.approvedAt ?? null,
    entries,
  };
}

/**
 * Timeline suggerita: per ogni scena approvata (ordine piano) una riga scena + righe clip approvate/finali della scena.
 * @param {object} data
 * @returns {TimelineEntry[]}
 */
export function buildSuggestedTimelineEntries(data) {
  const scenes = getApprovedActiveScenes(data);
  const clips = (data.sceneVideoClips || []).map((c) => normalizeSceneVideoClip(c)).filter(Boolean);
  const approvedClips = clips.filter(
    (c) => c.status === SCENE_VIDEO_CLIP_STATUS.APPROVED || c.status === SCENE_VIDEO_CLIP_STATUS.FINAL
  );
  const entries = [];
  for (const s of scenes) {
    entries.push({
      id: newTimelineEntryId(),
      kind: "scene",
      sceneId: s.id,
      clipId: null,
      durationSec: null,
    });
    const forScene = approvedClips
      .filter((c) => c.sceneId === s.id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (const c of forScene) {
      entries.push({
        id: newTimelineEntryId(),
        kind: "clip",
        sceneId: s.id,
        clipId: c.id,
        durationSec: null,
      });
    }
  }
  return entries;
}

/**
 * @param {object} data
 */
export function timelineNarrativeApproved(data) {
  const tp = normalizeTimelinePlan(data.timelinePlan);
  return tp.approved === true && tp.entries.length > 0;
}

/**
 * Piano montaggio da timeline approvata (ordine narrativo = ordine voci).
 * @param {object} data
 */
export function buildMontagePlanFromTimeline(data) {
  const tp = normalizeTimelinePlan(data.timelinePlan);
  const entries = tp.entries;
  return {
    orderedTimelineEntryIds: entries.map((e) => e.id),
    orderedClipIds: entries.filter((e) => e.kind === "clip" && e.clipId).map((e) => e.clipId),
    narrativeBeatNotes:
      data.finalMontagePlan && typeof data.finalMontagePlan.narrativeBeatNotes === "string"
        ? data.finalMontagePlan.narrativeBeatNotes
        : "",
  };
}

/**
 * Scene attive del piano con immagine generata e approvata.
 * @param {object} data — progetto persistito
 */
export function getApprovedActiveScenes(data) {
  const plan = data.plan;
  if (!plan?.scenes?.length) return [];
  const del = new Set(data.deletedSceneIds || []);
  const byId = Object.fromEntries((data.sceneResults || []).map((r) => [r.sceneId, r]));
  return plan.scenes
    .filter((s) => !del.has(s.id))
    .filter((s) => {
      const r = byId[s.id];
      return r?.imageUrl && r.approved === true;
    });
}

/**
 * Regola: ogni scena approvata deve avere almeno un clip non eliminato in stato `approved` o `final`;
 * tutti i clip non eliminati devono essere solo `approved` o `final` (niente bozze o needs_changes).
 *
 * @param {object} data
 * @returns {boolean}
 */
export function clipsReadyForFinalMontage(data) {
  const approvedScenes = getApprovedActiveScenes(data);
  if (approvedScenes.length === 0) return false;
  const clips = (data.sceneVideoClips || []).map((c) => normalizeSceneVideoClip(c)).filter(Boolean);
  const active = clips.filter((c) => c.status !== SCENE_VIDEO_CLIP_STATUS.DELETED);

  for (const s of approvedScenes) {
    const forScene = active.filter((c) => c.sceneId === s.id);
    const hasApproved = forScene.some(
      (c) => c.status === SCENE_VIDEO_CLIP_STATUS.APPROVED || c.status === SCENE_VIDEO_CLIP_STATUS.FINAL
    );
    if (!hasApproved) return false;
  }
  return active.every(
    (c) => c.status === SCENE_VIDEO_CLIP_STATUS.APPROVED || c.status === SCENE_VIDEO_CLIP_STATUS.FINAL
  );
}

/**
 * Tutti i personaggi che richiedono master hanno master approvato (allineato a pipeline scene).
 */
export function allCharacterMastersApprovedForVideo(data) {
  const plan = data.plan;
  if (!plan) return false;
  const need = getCharactersNeedingMaster(plan);
  if (!need.length) return true;
  const pcm = data.projectCharacterMasters && typeof data.projectCharacterMasters === "object" ? data.projectCharacterMasters : {};
  return need.every((c) => {
    if (!approvalEntryForCharacter(data.characterApprovalMap, c)?.approved) return false;
    const k = stableCharacterKey(c);
    const row = (k && pcm[k]) || (c.id != null ? pcm[c.id] : null);
    const url = row?.masterImageUrl ? String(row.masterImageUrl).trim() : "";
    if (!url) return false;
    if (row.pendingManualReview === true) return false;
    if (row.source !== "user_canonical_lock") return false;
    return true;
  });
}

/** @deprecated Usare allCharacterMastersApprovedForVideo */
export const allProtagonistsApprovedForVideo = allCharacterMastersApprovedForVideo;

/**
 * Tutte le scene attive hanno immagine e approvazione.
 */
export function allActiveScenesApproved(data) {
  const plan = data.plan;
  if (!plan?.scenes?.length) return false;
  const del = new Set(data.deletedSceneIds || []);
  const active = plan.scenes.filter((s) => !del.has(s.id));
  if (active.length === 0) return false;
  const byId = Object.fromEntries((data.sceneResults || []).map((r) => [r.sceneId, r]));
  return active.every((s) => {
    const r = byId[s.id];
    return r?.imageUrl && r.approved === true;
  });
}

/**
 * Ordine clip per auto-montaggio (placeholder: ordine creazione, filtrato per includeInFinal).
 * @param {object} data
 * @returns {string[]} clip ids
 */
export function buildDefaultMontageOrder(data) {
  if (timelineNarrativeApproved(data)) {
    return buildMontagePlanFromTimeline(data).orderedClipIds;
  }
  const clips = (data.sceneVideoClips || [])
    .map((c) => normalizeSceneVideoClip(c))
    .filter((c) => c && c.status !== SCENE_VIDEO_CLIP_STATUS.DELETED && c.includeInFinal !== false);
  const plan = data.plan;
  if (!plan?.scenes?.length) return clips.map((c) => c.id);
  const order = new Map(plan.scenes.map((s, i) => [s.id, i]));
  return [...clips].sort((a, b) => (order.get(a.sceneId) ?? 999) - (order.get(b.sceneId) ?? 999)).map((c) => c.id);
}

/**
 * Id scene del piano nell'ordine narrativo (esclude soft-delete).
 */
export function computeActiveSceneIdsInPlanOrder(plan, deletedSceneIds) {
  const del = new Set(deletedSceneIds || []);
  return (plan?.scenes || []).map((s) => s?.id).filter((id) => id && !del.has(id));
}

/**
 * Riordina immutabilmente `plan.scenes` (indici da lista UI).
 */
export function reorderPlanScenesImmutable(plan, fromIdx, toIdx) {
  if (!plan || !Array.isArray(plan.scenes) || plan.scenes.length < 2) return plan;
  if (fromIdx == null || toIdx == null || fromIdx === toIdx) return plan;
  if (fromIdx < 0 || toIdx < 0 || fromIdx >= plan.scenes.length || toIdx >= plan.scenes.length) return plan;
  const scenes = [...plan.scenes];
  const [item] = scenes.splice(fromIdx, 1);
  let insertAt = toIdx;
  if (fromIdx < toIdx) insertAt = toIdx - 1;
  scenes.splice(insertAt, 0, item);
  return { ...plan, scenes };
}

/**
 * Allinea `sceneResults` all'ordine delle scene nel piano (poi eventuali orfani).
 */
export function reorderSceneResultsArray(sceneResults, plan, deletedSceneIds) {
  const order = computeActiveSceneIdsInPlanOrder(plan, deletedSceneIds);
  const byId = Object.fromEntries((sceneResults || []).map((r) => [r.sceneId, r]));
  const seen = new Set();
  const out = [];
  for (const sid of order) {
    const row = byId[sid];
    if (row) {
      out.push(row);
      seen.add(sid);
    }
  }
  for (const r of sceneResults || []) {
    if (r && !seen.has(r.sceneId)) out.push(r);
  }
  return out;
}

/**
 * Partizione timeline in gruppi per scena (riga scena + clip della stessa scena, oppure solo clip).
 */
function partitionTimelineEntriesIntoSceneGroups(entries) {
  const groups = [];
  let current = null;
  for (const e of entries || []) {
    if (!e) continue;
    if (e.kind === "scene") {
      if (current && current.entries.length) groups.push(current);
      current = { sceneId: e.sceneId, entries: [e] };
    } else if (e.kind === "clip") {
      if (current && current.sceneId === e.sceneId) {
        current.entries.push(e);
      } else {
        if (current && current.entries.length) groups.push(current);
        current = { sceneId: e.sceneId, entries: [e] };
      }
    }
  }
  if (current && current.entries.length) groups.push(current);
  return groups;
}

/**
 * Dopo un drag&drop sulle scene del piano: rinumerazione `sortOrder` clip per scena,
 * riordino blocchi timeline e piano montaggio coerente con il nuovo ordine narrativo.
 */
export function syncAfterScenePlanReorder({
  plan,
  sceneVideoClips,
  timelinePlan,
  finalMontagePlan,
  deletedSceneIds,
}) {
  const sceneOrder = computeActiveSceneIdsInPlanOrder(plan, deletedSceneIds);

  const clipsIn = (sceneVideoClips || []).map((c) => normalizeSceneVideoClip(c)).filter(Boolean);
  const byScene = new Map();
  for (const c of clipsIn) {
    if (c.status === SCENE_VIDEO_CLIP_STATUS.DELETED) continue;
    if (!byScene.has(c.sceneId)) byScene.set(c.sceneId, []);
    byScene.get(c.sceneId).push(c);
  }
  const idToSort = new Map();
  for (const sid of sceneOrder) {
    const arr = (byScene.get(sid) || []).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    arr.forEach((c, i) => idToSort.set(c.id, i));
  }
  const nextClips = clipsIn.map((c) => {
    if (idToSort.has(c.id)) return { ...c, sortOrder: idToSort.get(c.id) };
    return c;
  });

  const tp = normalizeTimelinePlan(timelinePlan);
  const rawEntries = tp.entries || [];
  const groups = partitionTimelineEntriesIntoSceneGroups(rawEntries);
  const mergedByScene = new Map();
  for (const g of groups) {
    if (!g.sceneId) continue;
    if (!mergedByScene.has(g.sceneId)) mergedByScene.set(g.sceneId, []);
    mergedByScene.get(g.sceneId).push(...g.entries);
  }

  const nextEntryList = [];
  const used = new Set();
  for (const sid of sceneOrder) {
    const chunk = mergedByScene.get(sid);
    if (chunk && chunk.length) {
      nextEntryList.push(...chunk);
      used.add(sid);
    }
  }
  for (const [sid, chunk] of mergedByScene) {
    if (!used.has(sid)) nextEntryList.push(...chunk);
  }

  const nextTimeline = {
    ...tp,
    entries: nextEntryList,
  };

  const fmp = finalMontagePlan && typeof finalMontagePlan === "object" ? finalMontagePlan : {};
  const montage =
    nextEntryList.length > 0
      ? buildMontagePlanFromTimeline({ timelinePlan: nextTimeline, finalMontagePlan: fmp })
      : { orderedClipIds: [], orderedTimelineEntryIds: [] };
  const nextFinal = {
    orderedClipIds: Array.isArray(montage.orderedClipIds) ? montage.orderedClipIds : [],
    orderedTimelineEntryIds: Array.isArray(montage.orderedTimelineEntryIds) ? montage.orderedTimelineEntryIds : [],
    narrativeBeatNotes: typeof fmp.narrativeBeatNotes === "string" ? fmp.narrativeBeatNotes : "",
  };

  return {
    sceneVideoClips: nextClips,
    timelinePlan: nextTimeline,
    finalMontagePlan: nextFinal,
  };
}
