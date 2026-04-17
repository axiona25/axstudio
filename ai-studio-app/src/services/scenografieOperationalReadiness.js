/**
 * AXSTUDIO — Operational readiness (Fase 2): semantica scena/clip, checklist runtime, gap verso film finito.
 */

import { getCharactersNeedingMaster } from "./scenografiePlanner.js";
import {
  characterMasterReadyForScenes,
  deriveScenografiaUiStatus,
} from "./scenografieProjectPersistence.js";
import {
  SCENE_VIDEO_CLIP_STATUS,
  CLIP_TYPE,
  getClipGenerationReadiness,
  clipsReadyForFinalMontage,
  timelineNarrativeApproved,
  normalizeCharacterVoiceMaster,
  normalizeSceneVideoClip,
} from "./scenografieVideoWorkflow.js";
import { voiceMasterRawForRef, approvalEntryForCharacter, pcmRowForCharacter } from "./scenografiePcidLookup.js";
import { resolveElevenLabsVoiceId } from "./elevenlabsService.js";
import {
  deriveFilmOutputReadinessFromChapterData,
  FILM_OUTPUT_READINESS,
} from "./scenografieConsumerReliability.js";

/** Semantica operativa clip (non confondere con SCENE_VIDEO_CLIP_STATUS raw). */
export const CLIP_OPERATIONAL = {
  NOT_STARTED: "not_started",
  BLOCKED: "blocked_dependencies",
  GENERATING: "generating",
  FAILED: "failed",
  FAILED_RECOVERABLE: "failed_recoverable",
  SUCCESS_WARNING: "success_with_warnings",
  READY_REVIEW: "ready_for_review",
  APPROVED_FOR_MONTAGE: "approved_for_montage",
  DELETED: "deleted",
};

/** Semantica operativa scena (aggregato immagine + clip). */
export const SCENE_OPERATIONAL = {
  PENDING_IMAGE: "pending_image",
  IMAGE_UNAPPROVED: "image_unapproved",
  IMAGE_OK: "image_ok",
  BLOCKED_CAST: "blocked_cast",
  CLIPS_MISSING: "clips_missing",
  CLIPS_IN_PROGRESS: "clips_in_progress",
  CLIP_FAILED: "clip_failed",
  CLIP_RECOVERABLE: "clip_recoverable",
  CLIPS_NOT_MONTAGE_READY: "clips_not_montage_ready",
  SCENE_MONTAGE_READY: "scene_montage_ready",
};

const CLIP_OP_LABEL_IT = {
  [CLIP_OPERATIONAL.NOT_STARTED]: "Da generare",
  [CLIP_OPERATIONAL.BLOCKED]: "Bloccato (mancano dati)",
  [CLIP_OPERATIONAL.GENERATING]: "In corso",
  [CLIP_OPERATIONAL.FAILED]: "Fallito",
  [CLIP_OPERATIONAL.FAILED_RECOVERABLE]: "Fallito · recuperabile",
  [CLIP_OPERATIONAL.SUCCESS_WARNING]: "Pronto · con avvisi",
  [CLIP_OPERATIONAL.READY_REVIEW]: "Pronto da rivedere",
  [CLIP_OPERATIONAL.APPROVED_FOR_MONTAGE]: "Approvato per montaggio",
  [CLIP_OPERATIONAL.DELETED]: "Eliminato",
};

const SCENE_OP_LABEL_IT = {
  [SCENE_OPERATIONAL.PENDING_IMAGE]: "Immagine mancante",
  [SCENE_OPERATIONAL.IMAGE_UNAPPROVED]: "Immagine da approvare",
  [SCENE_OPERATIONAL.IMAGE_OK]: "Scena ok",
  [SCENE_OPERATIONAL.BLOCKED_CAST]: "Cast / master incompleti",
  [SCENE_OPERATIONAL.CLIPS_MISSING]: "Senza clip",
  [SCENE_OPERATIONAL.CLIPS_IN_PROGRESS]: "Clip in lavorazione",
  [SCENE_OPERATIONAL.CLIP_FAILED]: "Clip in errore",
  [SCENE_OPERATIONAL.CLIP_RECOVERABLE]: "Clip da rigenerare",
  [SCENE_OPERATIONAL.CLIPS_NOT_MONTAGE_READY]: "Clip non tutti approvati",
  [SCENE_OPERATIONAL.SCENE_MONTAGE_READY]: "Pronta per montaggio",
};

/**
 * @param {string} key
 */
export function clipOperationalLabelIt(key) {
  return CLIP_OP_LABEL_IT[key] || key;
}

export function sceneOperationalLabelIt(key) {
  return SCENE_OP_LABEL_IT[key] || key;
}

/**
 * @param {object} clip
 * @param {object} ctx — plan, characterVoiceMasters, projectCharacterMasters, sceneResults
 */
export function deriveClipOperationalSemantics(clip, ctx) {
  const c = normalizeSceneVideoClip(clip);
  if (!c || c.status === SCENE_VIDEO_CLIP_STATUS.DELETED) {
    return { key: CLIP_OPERATIONAL.DELETED, labelIt: clipOperationalLabelIt(CLIP_OPERATIONAL.DELETED), recoverable: false };
  }
  if (c.status === SCENE_VIDEO_CLIP_STATUS.GENERATING_AUDIO || c.status === SCENE_VIDEO_CLIP_STATUS.GENERATING_VIDEO) {
    return { key: CLIP_OPERATIONAL.GENERATING, labelIt: clipOperationalLabelIt(CLIP_OPERATIONAL.GENERATING), recoverable: false };
  }
  if (c.status === SCENE_VIDEO_CLIP_STATUS.FAILED) {
    const rec = c.lastWorkflowFailure?.isRecoverable !== false;
    const key = rec ? CLIP_OPERATIONAL.FAILED_RECOVERABLE : CLIP_OPERATIONAL.FAILED;
    return { key, labelIt: clipOperationalLabelIt(key), recoverable: rec };
  }
  const readiness = getClipGenerationReadiness(c, {
    characterVoiceMasters: ctx.characterVoiceMasters,
    projectCharacterMasters: ctx.projectCharacterMasters,
    plan: ctx.plan,
    sceneResults: ctx.sceneResults,
  });
  if (!readiness.ok && !c.videoUrl) {
    return {
      key: CLIP_OPERATIONAL.BLOCKED,
      labelIt: clipOperationalLabelIt(CLIP_OPERATIONAL.BLOCKED),
      recoverable: true,
      reasons: readiness.reasons || [],
    };
  }
  if (
    c.status === SCENE_VIDEO_CLIP_STATUS.READY_FOR_REVIEW &&
    c.videoUrl &&
    (c.videoConstraintReport?.issues?.length || c.videoMuxFailure)
  ) {
    return { key: CLIP_OPERATIONAL.SUCCESS_WARNING, labelIt: clipOperationalLabelIt(CLIP_OPERATIONAL.SUCCESS_WARNING), recoverable: true };
  }
  if (c.status === SCENE_VIDEO_CLIP_STATUS.READY_FOR_REVIEW && c.videoUrl) {
    return { key: CLIP_OPERATIONAL.READY_REVIEW, labelIt: clipOperationalLabelIt(CLIP_OPERATIONAL.READY_REVIEW), recoverable: false };
  }
  if (c.status === SCENE_VIDEO_CLIP_STATUS.APPROVED || c.status === SCENE_VIDEO_CLIP_STATUS.FINAL) {
    return {
      key: CLIP_OPERATIONAL.APPROVED_FOR_MONTAGE,
      labelIt: clipOperationalLabelIt(CLIP_OPERATIONAL.APPROVED_FOR_MONTAGE),
      recoverable: false,
    };
  }
  return { key: CLIP_OPERATIONAL.NOT_STARTED, labelIt: clipOperationalLabelIt(CLIP_OPERATIONAL.NOT_STARTED), recoverable: true };
}

/**
 * @param {object} scene
 * @param {object} chapter — plan, sceneResults, sceneVideoClips, deletedSceneIds, projectCharacterMasters, characterApprovalMap, characterVoiceMasters
 */
export function deriveSceneOperationalSemantics(scene, chapter) {
  const del = new Set(chapter.deletedSceneIds || []);
  if (!scene?.id || del.has(scene.id)) {
    return {
      key: SCENE_OPERATIONAL.PENDING_IMAGE,
      labelIt: "—",
      sceneId: scene?.id,
    };
  }
  const plan = chapter.plan;
  const need = getCharactersNeedingMaster(plan);
  const allCast =
    need.length === 0 || need.every((ch) => characterMasterReadyForScenes(ch, chapter));
  if (!allCast) {
    return {
      key: SCENE_OPERATIONAL.BLOCKED_CAST,
      labelIt: sceneOperationalLabelIt(SCENE_OPERATIONAL.BLOCKED_CAST),
      sceneId: scene.id,
    };
  }
  const row = (chapter.sceneResults || []).find((r) => r.sceneId === scene.id);
  if (!row?.imageUrl) {
    return {
      key: SCENE_OPERATIONAL.PENDING_IMAGE,
      labelIt: sceneOperationalLabelIt(SCENE_OPERATIONAL.PENDING_IMAGE),
      sceneId: scene.id,
    };
  }
  if (row.approved !== true) {
    return {
      key: SCENE_OPERATIONAL.IMAGE_UNAPPROVED,
      labelIt: sceneOperationalLabelIt(SCENE_OPERATIONAL.IMAGE_UNAPPROVED),
      sceneId: scene.id,
    };
  }
  const ctx = {
    plan,
    characterVoiceMasters: chapter.characterVoiceMasters,
    projectCharacterMasters: chapter.projectCharacterMasters,
    sceneResults: chapter.sceneResults,
  };
  const clipsHere = (chapter.sceneVideoClips || []).filter(
    (c) => c && c.sceneId === scene.id && c.status !== SCENE_VIDEO_CLIP_STATUS.DELETED,
  );
  if (clipsHere.length === 0) {
    return {
      key: SCENE_OPERATIONAL.CLIPS_MISSING,
      labelIt: sceneOperationalLabelIt(SCENE_OPERATIONAL.CLIPS_MISSING),
      sceneId: scene.id,
    };
  }
  let anyGen = false;
  let anyFail = false;
  let anyFailRec = false;
  let allMontage = true;
  for (const cl of clipsHere) {
    const sem = deriveClipOperationalSemantics(cl, ctx);
    if (sem.key === CLIP_OPERATIONAL.GENERATING) anyGen = true;
    if (sem.key === CLIP_OPERATIONAL.FAILED) anyFail = true;
    if (sem.key === CLIP_OPERATIONAL.FAILED_RECOVERABLE) anyFailRec = true;
    if (
      sem.key !== CLIP_OPERATIONAL.APPROVED_FOR_MONTAGE &&
      cl.status !== SCENE_VIDEO_CLIP_STATUS.APPROVED &&
      cl.status !== SCENE_VIDEO_CLIP_STATUS.FINAL
    ) {
      allMontage = false;
    }
  }
  if (anyGen) {
    return {
      key: SCENE_OPERATIONAL.CLIPS_IN_PROGRESS,
      labelIt: sceneOperationalLabelIt(SCENE_OPERATIONAL.CLIPS_IN_PROGRESS),
      sceneId: scene.id,
    };
  }
  if (anyFail) {
    return { key: SCENE_OPERATIONAL.CLIP_FAILED, labelIt: sceneOperationalLabelIt(SCENE_OPERATIONAL.CLIP_FAILED), sceneId: scene.id };
  }
  if (anyFailRec) {
    return {
      key: SCENE_OPERATIONAL.CLIP_RECOVERABLE,
      labelIt: sceneOperationalLabelIt(SCENE_OPERATIONAL.CLIP_RECOVERABLE),
      sceneId: scene.id,
    };
  }
  if (!allMontage) {
    return {
      key: SCENE_OPERATIONAL.CLIPS_NOT_MONTAGE_READY,
      labelIt: sceneOperationalLabelIt(SCENE_OPERATIONAL.CLIPS_NOT_MONTAGE_READY),
      sceneId: scene.id,
    };
  }
  return {
    key: SCENE_OPERATIONAL.SCENE_MONTAGE_READY,
    labelIt: sceneOperationalLabelIt(SCENE_OPERATIONAL.SCENE_MONTAGE_READY),
    sceneId: scene.id,
  };
}

/**
 * Checklist runtime per una scena nell’editor (voci con stato reale).
 * @param {object} scene
 * @param {object} chapterPayload — stessi campi di deriveSceneOperationalSemantics + projectNarrators opzionale
 */
export function buildSceneChecklistRuntimeItems(scene, chapterPayload) {
  const items = [];
  const sceneId = scene?.id;
  const plan = chapterPayload.plan;
  const row = (chapterPayload.sceneResults || []).find((r) => r.sceneId === sceneId);
  const clipsHere = (chapterPayload.sceneVideoClips || []).filter(
    (c) => c && c.sceneId === sceneId && c.status !== SCENE_VIDEO_CLIP_STATUS.DELETED,
  );
  const ctx = {
    plan,
    characterVoiceMasters: chapterPayload.characterVoiceMasters,
    projectCharacterMasters: chapterPayload.projectCharacterMasters,
    sceneResults: chapterPayload.sceneResults,
  };

  const need = getCharactersNeedingMaster(plan);
  const castOk = need.length === 0 || need.every((ch) => characterMasterReadyForScenes(ch, chapterPayload));
  items.push({
    id: `rt_cast_${sceneId}`,
    label: "Master personaggi necessari approvati",
    state: castOk ? "done" : "blocked",
    hint: castOk ? null : "Completa i volti in Fase 2 prima delle scene.",
    deepLink: { focus: "characters" },
  });

  items.push({
    id: `rt_img_${sceneId}`,
    label: "Immagine scena generata e approvata",
    state: !row?.imageUrl ? "open" : row.approved === true ? "done" : "warn",
    hint: !row?.imageUrl ? "Genera l’immagine in Fase 3." : row.approved !== true ? "Approva o modifica la scena." : null,
    deepLink: { focus: "scenes", sceneId },
  });

  const presentIds = new Set(scene?.characters_present || []);
  for (const cid of presentIds) {
    const ch = (plan?.characters || []).find((c) => c.id === cid);
    if (!ch) continue;
    const pcm = chapterPayload.projectCharacterMasters && typeof chapterPayload.projectCharacterMasters === "object"
      ? chapterPayload.projectCharacterMasters
      : {};
    const pcmRow = pcmRowForCharacter(pcm, ch);
    const hasUrl = pcmRow?.masterImageUrl && String(pcmRow.masterImageUrl).trim();
    const appr = approvalEntryForCharacter(chapterPayload.characterApprovalMap, ch)?.approved === true;
    const ok = hasUrl && appr;
    items.push({
      id: `rt_master_${sceneId}_${cid}`,
      label: `Master volto: ${ch.name || cid}`,
      state: ok ? "done" : "open",
      hint: ok ? null : "Genera e approva il master in Fase 2.",
      deepLink: { focus: "characters" },
    });
  }

  const voiceIssues = [];
  for (const cid of presentIds) {
    const ch = (plan?.characters || []).find((c) => c.id === cid);
    if (!ch) continue;
    const master = normalizeCharacterVoiceMaster(
      voiceMasterRawForRef(chapterPayload.characterVoiceMasters, cid, plan),
      cid,
    );
    const { voiceId } = resolveElevenLabsVoiceId(master.voiceId);
    if (!voiceId) voiceIssues.push(ch.name || cid);
  }
  items.push({
    id: `rt_voices_${sceneId}`,
    label: "Voci ElevenLabs assegnate (cast in scena)",
    state: voiceIssues.length === 0 ? "done" : "blocked",
    hint: voiceIssues.length ? `Manca voice ID valido per: ${voiceIssues.slice(0, 4).join(", ")}` : null,
    deepLink: { focus: "characters" },
  });

  const narrators = chapterPayload.projectNarrators;
  const hasNarrators = Array.isArray(narrators) && narrators.length > 0;
  const needsNarrator = clipsHere.some(
    (c) => c.clipType !== CLIP_TYPE.DIALOGUE && (!c.dialogLines || c.dialogLines.length === 0),
  );
  items.push({
    id: `rt_narr_${sceneId}`,
    label: "Narratori di progetto (per clip narrati)",
    state: !needsNarrator || hasNarrators ? "done" : "warn",
    hint: needsNarrator && !hasNarrators ? "Aggiungi almeno un narratore con voce ElevenLabs valida." : null,
    deepLink: { focus: "narrators" },
  });

  items.push({
    id: `rt_clips_${sceneId}`,
    label: "Almeno una clip per questa scena",
    state: clipsHere.length > 0 ? "done" : "open",
    hint: clipsHere.length === 0 ? "Crea una clip in Fase 4." : null,
    deepLink: { focus: "clips", sceneId },
  });

  let clipDetailState = "done";
  let clipHint = null;
  for (const cl of clipsHere) {
    const sem = deriveClipOperationalSemantics(cl, ctx);
    if (sem.key === CLIP_OPERATIONAL.FAILED || sem.key === CLIP_OPERATIONAL.FAILED_RECOVERABLE) {
      clipDetailState = "blocked";
      clipHint = "Una o più clip sono fallite: apri il Clip Builder e rigenera.";
      break;
    }
    if (sem.key === CLIP_OPERATIONAL.BLOCKED) {
      clipDetailState = "warn";
      clipHint = "Completa testo/voce prima di generare.";
    }
    if (sem.key === CLIP_OPERATIONAL.GENERATING) clipDetailState = "warn";
  }
  items.push({
    id: `rt_clip_health_${sceneId}`,
    label: "Clip generate senza errori bloccanti",
    state: clipDetailState,
    hint: clipHint,
    deepLink: { focus: "clips", sceneId },
  });

  const allClipMontage = clipsHere.length > 0 && clipsHere.every(
    (c) => c.status === SCENE_VIDEO_CLIP_STATUS.APPROVED || c.status === SCENE_VIDEO_CLIP_STATUS.FINAL,
  );
  items.push({
    id: `rt_clip_appr_${sceneId}`,
    label: "Clip approvate per la timeline",
    state: allClipMontage ? "done" : clipsHere.length ? "open" : "open",
    hint: allClipMontage ? null : "Approva ogni clip quando il video è ok.",
    deepLink: { focus: "clips", sceneId },
  });

  return items;
}

/**
 * Segnali pre-commit per il wizard (da piano + charGraphics). Non sostituisce l’editor.
 * @param {object} task — da sceneProductionChecklist
 * @param {object} scene
 * @param {object} plan
 * @param {object} charGraphics
 */
export function enrichWizardChecklistTaskRuntime(task, scene, plan, charGraphics) {
  const cg = charGraphics && typeof charGraphics === "object" ? charGraphics : {};
  const id = String(task.id || "");
  let runtimeKind = "advisory";
  let runtimeHint = "Da completare in Scenografie dopo la conferma.";
  let statusLabel = "Da fare in editor";

  if (id.startsWith("master_") && scene?.id) {
    const suffix = id.slice(`master_${scene.id}_`.length);
    if (suffix) {
      const g = cg[suffix];
      const hasPrompt = g?.graphicPrompt && String(g.graphicPrompt).trim();
      if (hasPrompt) {
        runtimeKind = "preview_ok";
        runtimeHint = "Prompt grafico compilato nel wizard: in editor andrà confermato sul master.";
        statusLabel = "Prompt pronto (preview)";
      } else {
        runtimeKind = "likely_open";
        runtimeHint = "Nessun prompt grafico salvato per questo personaggio nel wizard.";
        statusLabel = "Da compilare (wizard)";
      }
    }
  } else if (id.startsWith("clips_")) {
    const n = (plan?.clips || []).filter((c) => (c.scene_id || c.sceneId) === scene?.id).length;
    if (n > 0) {
      runtimeKind = "preview_ok";
      runtimeHint = `${n} clip previste nel piano: la generazione reale è in editor.`;
      statusLabel = `${n} in piano`;
    }
  } else if (id.startsWith("scene_img_")) {
    runtimeKind = "likely_open";
    runtimeHint = "L’immagine scena si genera in Scenografie (Fase 3).";
    statusLabel = "Post-conferma";
  } else if (id.startsWith("voices_") || id.startsWith("music_") || id.startsWith("amb_")) {
    runtimeKind = "advisory";
    runtimeHint = id.startsWith("voices_")
      ? "Le voci si assegnano in editor (Fase 2–4)."
      : "Musica/ambiente: controlli in Clip Builder / mix quando disponibili.";
    statusLabel = "Dopo conferma";
  } else if (id.startsWith("cast_")) {
    runtimeKind = "preview_ok";
    runtimeHint = "Cast definito nel piano attuale.";
    statusLabel = "Nel piano";
  }

  return { ...task, runtimeKind, runtimeHint, statusLabel };
}

/**
 * Riepilogo consumer-safe: cosa manca e prossimo passo.
 * @param {object} data — payload capitolo + meta fasi (come in editor)
 */
export function computeChapterCompletionGaps(data) {
  const d = data && typeof data === "object" ? data : {};
  const plan = d.plan;
  const items = [];
  const add = (ok, label, nextHint, deepLink) => {
    items.push({ ok, label, nextHint: ok ? null : nextHint, deepLink: ok ? null : deepLink });
  };

  if (!plan?.scenes?.length) {
    return {
      headline: "Piano assente",
      nextStep: "Completa o importa un piano narrativo.",
      items: [],
      uiStatus: "planning",
    };
  }

  const gatePayload = {
    plan: d.plan,
    characterApprovalMap: d.characterApprovalMap,
    masterImages: d.masterImages,
    projectCharacterMasters: d.projectCharacterMasters,
    sceneResults: d.sceneResults,
    deletedSceneIds: d.deletedSceneIds,
    sceneVideoClips: d.sceneVideoClips,
    timelinePlan: d.timelinePlan,
  };

  const ui = deriveScenografiaUiStatus({
    plan: d.plan,
    scenografiaPhase: d.scenografiaPhase,
    characterApprovalMap: d.characterApprovalMap,
    masterImages: d.masterImages,
    projectCharacterMasters: d.projectCharacterMasters,
    sceneResults: d.sceneResults,
    deletedSceneIds: d.deletedSceneIds,
    scenografiaVideoPhase: d.scenografiaVideoPhase,
    sceneVideoClips: d.sceneVideoClips,
    finalMontagePhase: d.finalMontagePhase,
    timelinePlan: d.timelinePlan,
  });

  const need = getCharactersNeedingMaster(plan);
  const castDone = need.length === 0 || need.every((ch) => characterMasterReadyForScenes(ch, gatePayload));
  add(castDone, "Master personaggi pronti", "Vai a Fase 2: genera e approva i volti del cast.", { focus: "characters" });

  const del = new Set(d.deletedSceneIds || []);
  const activeScenes = (plan.scenes || []).filter((s) => s?.id && !del.has(s.id));
  const byId = Object.fromEntries((d.sceneResults || []).map((r) => [r.sceneId, r]));
  const scenesApproved = activeScenes.filter((s) => byId[s.id]?.approved === true).length;
  const scenesNeedGen = activeScenes.some((s) => !byId[s.id]?.imageUrl);
  add(
    !scenesNeedGen,
    "Immagini per tutte le scene",
    "In Fase 3 genera le scene mancanti e approvale.",
    { focus: "scenes" },
  );

  add(
    scenesApproved === activeScenes.length && activeScenes.length > 0,
    "Tutte le scene approvate",
    "Approva le immagini scene in Fase 3.",
    { focus: "scenes" },
  );

  const narrators = d.projectNarrators;
  const hasNarrators = Array.isArray(narrators) && narrators.length > 0;
  const hasNarratedClips = (d.sceneVideoClips || []).some(
    (c) =>
      c &&
      c.status !== SCENE_VIDEO_CLIP_STATUS.DELETED &&
      c.clipType !== CLIP_TYPE.DIALOGUE,
  );
  add(
    !hasNarratedClips || hasNarrators,
    "Narratori disponibili (per clip narrati)",
    "In Fase 2 configura almeno un narratore con voce ElevenLabs.",
    { focus: "narrators" },
  );

  const clipsOk = clipsReadyForFinalMontage(gatePayload);
  add(
    clipsOk,
    "Clip pronte e approvate per il montaggio",
    "In Fase 4 genera e approva tutte le clip mancanti.",
    { focus: "clips" },
  );

  const tlOk = timelineNarrativeApproved(d.timelinePlan);
  add(tlOk, "Timeline narrativa confermata", "Conferma l’ordine in Fase 4.", { focus: "timeline" });

  const montageStarted = d.finalMontagePhase === "assembly" || d.finalMontagePhase === "done";
  add(
    montageStarted || ui === "completed",
    "Montaggio finale avviato o completato",
    "Avvia «Filmato finale» dopo la timeline approvata.",
    { focus: "montage" },
  );

  const film = deriveFilmOutputReadinessFromChapterData(d);
  const filmOk =
    film.readiness === FILM_OUTPUT_READINESS.PLAYABLE ||
    film.readiness === FILM_OUTPUT_READINESS.DEGRADED ||
    (film.readiness === FILM_OUTPUT_READINESS.URL_STALE_PHASE && film.outputUrl);
  const needsFilmFile = ui === "completed" || d.finalMontagePhase === "done";
  if (needsFilmFile) {
    add(
      filmOk,
      "File film salvato e riproducibile",
      film.userHint || "Esegui il render del montaggio e verifica l’URL in uscita.",
      { focus: "montage" },
    );
  }

  const pending = items.filter((x) => !x.ok);
  const next = pending[0];
  const headline =
    pending.length === 0
      ? "Percorso verso il film: tutti i controlli principali sono soddisfatti."
      : `${pending.length} area da completare prima di un film finito guardabile.`;

  return {
    headline,
    nextStep: next?.nextHint || "Controlla le voci sotto e usa i collegamenti rapidi.",
    items,
    uiStatus: ui,
    filmReadiness: film.readiness,
  };
}
