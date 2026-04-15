/**
 * Workflow video Scenografie (clip per scena + montaggio finale).
 * Logica pura: nessuna chiamata API. Il motore di generazione video si collegherà qui in seguito.
 */

import { getCharactersNeedingMaster } from "./scenografiePlanner.js";

/** @typedef {'draft'|'approved'|'needs_changes'|'deleted'|'final'} SceneVideoClipStatus */

export const SCENE_VIDEO_CLIP_STATUS = {
  DRAFT: "draft",
  APPROVED: "approved",
  NEEDS_CHANGES: "needs_changes",
  DELETED: "deleted",
  FINAL: "final",
};

export const SCENE_VIDEO_CLIP_STATUS_LABEL = {
  draft: "Bozza",
  approved: "Approvato",
  needs_changes: "Da rivedere",
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
  return {
    id: c.id,
    sceneId: c.sceneId,
    label: c.label != null ? String(c.label) : "",
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
  if (!need.length) return false;
  return need.every(
    (c) => data.characterApprovalMap?.[c.id]?.approved === true && !!data.masterImages?.[c.id]
  );
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
