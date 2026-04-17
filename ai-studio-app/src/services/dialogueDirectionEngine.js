/**
 * AXSTUDIO — Regia dialogica multi-soggetto (piano, classificazione, onestà esecutiva).
 * Non sostituisce H8 (audio multi-voice); arricchisce clip dialogici con intenti visivo/regia
 * e limiti reali rispetto ad avatar vs cinematic.
 */

import { CLIP_TYPE } from "./scenografieVideoWorkflow.js";

export const DIALOGUE_DIRECTION_ENGINE_VERSION = 1;

function trim(v) {
  return v != null ? String(v).trim() : "";
}

function uniqSorted(ids) {
  return [...new Set((ids || []).map((x) => trim(x)).filter(Boolean))].sort();
}

/**
 * @param {object} ctx
 * @param {object} ctx.clip
 * @param {object|null} ctx.plan
 * @param {object|null} ctx.sceneRow
 * @param {object[]} ctx.lines — normalizeDialogLine
 * @param {object|null} ctx.speakerVoiceMap
 * @param {object|null} ctx.dialogueTimingPlan
 * @param {object|null} ctx.multiVoiceRenderResult
 * @param {object|null} ctx.compiledVideoDirection
 * @param {object|null} ctx.compiledCreativeIntent
 * @param {object|null} ctx.videoExecutionStrategy
 * @param {object|null} ctx.projectCharacterMasters
 * @param {string|null} ctx.sceneType — opzionale (esterno)
 */
export function buildDialogueDirectionPlan(ctx) {
  const clip = ctx?.clip && typeof ctx.clip === "object" ? ctx.clip : {};
  const plan = ctx?.plan && typeof ctx.plan === "object" ? ctx.plan : null;
  const sceneId = clip.sceneId != null ? String(clip.sceneId) : null;
  const scene =
    sceneId && Array.isArray(plan?.scenes) ? plan.scenes.find((s) => s?.id === sceneId) : null;
  const sceneCastIds = uniqSorted(scene?.characters_present || []);
  const clipPresentIds = uniqSorted(clip.clipPresentCharacterIds || []);
  const lines = Array.isArray(ctx?.lines) ? ctx.lines : [];

  const speakerOrder = [];
  const speakerIds = new Set();
  for (const line of lines) {
    const cid = line?.characterId != null ? String(line.characterId).trim() : "";
    if (cid) {
      speakerIds.add(cid);
      speakerOrder.push(cid);
    }
  }
  const speakerCount = speakerIds.size;
  const presentSubjectIds = uniqSorted([...sceneCastIds, ...clipPresentIds, ...speakerIds]);

  const focusRaw = trim(clip.clipFocusSubject);
  const v = ctx?.compiledVideoDirection && typeof ctx.compiledVideoDirection === "object" ? ctx.compiledVideoDirection : {};
  const cr = ctx?.compiledCreativeIntent && typeof ctx.compiledCreativeIntent === "object" ? ctx.compiledCreativeIntent : {};
  const compiledFocus = trim(v.focusSubject || v.shotType || "");

  const listenersNotSpeaking = presentSubjectIds.filter((id) => !speakerIds.has(id));
  const speakersNotInPresent = [...speakerIds].filter((id) => !presentSubjectIds.includes(id));

  /** @type {string} */
  let dialogueSceneType = "unresolved_dialogue_presence";
  if (lines.length === 0 || speakerCount === 0) {
    dialogueSceneType = "unresolved_dialogue_presence";
  } else if (speakerCount === 1) {
    dialogueSceneType =
      listenersNotSpeaking.length >= 1 || presentSubjectIds.length >= 2
        ? "speaker_with_listener_presence"
        : "single_subject_monologue";
  } else if (speakerCount === 2) {
    const sharedIntent =
      focusRaw === "pair" ||
      compiledFocus === "pair" ||
      /\b(due|two|pair|coppia|insieme|shared)\b/i.test(trim(cr.whatMustBeSeen || ""));
    dialogueSceneType = sharedIntent ? "shared_frame_dialogue" : "two_subject_dialogue";
  } else {
    dialogueSceneType = "multi_subject_dialogue";
  }
  if (speakersNotInPresent.length > 0 && dialogueSceneType === "single_subject_monologue") {
    dialogueSceneType = "speaker_with_listener_presence";
  }

  const activeSpeakerSequence = lines.map((l, i) => ({
    turnIndex: i,
    lineId: l.id,
    characterId: l.characterId,
  }));

  const videoStrategy = ctx?.videoExecutionStrategy && typeof ctx.videoExecutionStrategy === "object" ? ctx.videoExecutionStrategy : {};
  const executorType = videoStrategy.videoExecutorType || null;
  const isAvatarPath = executorType === "avatar_lipsync" || videoStrategy.executorDispatchMode === "avatar_provider";

  /** @type {'single_face_reference'|'shared_frame_intent'|'group_staging_advisory'} */
  let dialogueFrameMode = "single_face_reference";
  if (speakerCount >= 2 || presentSubjectIds.length >= 2) {
    dialogueFrameMode = focusRaw === "pair" || dialogueSceneType === "shared_frame_dialogue" ? "shared_frame_intent" : "group_staging_advisory";
  }

  /** @type {'co_presence_implied'|'sequential_turns_only'|'offscreen_allowed'} */
  let multiSubjectPresenceMode = "sequential_turns_only";
  if (presentSubjectIds.length >= 2) multiSubjectPresenceMode = "co_presence_implied";
  if (listenersNotSpeaking.length > 0) multiSubjectPresenceMode = "co_presence_implied";

  const actualDurs = ctx?.dialogueTimingPlan?.actualLineDurations || [];
  const speakerVoiceMap = ctx?.speakerVoiceMap && typeof ctx.speakerVoiceMap === "object" ? ctx.speakerVoiceMap : {};

  /** @param {number} i */
  function lineDurationSec(i) {
    const d = actualDurs[i];
    return typeof d === "number" && Number.isFinite(d) ? Math.round(d * 1000) / 1000 : null;
  }

  /** @type {object[]} */
  const speakerFocusPlan = [];
  /** @type {object[]} */
  const speakerTurnVisualIntent = [];
  /** @type {object[]} */
  const speakerTurnAudioIntent = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sid = line?.characterId != null ? String(line.characterId).trim() : "";
    const otherSpeakers = [...speakerIds].filter((x) => x !== sid);
    const listenerIds =
      otherSpeakers.length > 0
        ? otherSpeakers
        : listenersNotSpeaking.length > 0
          ? listenersNotSpeaking
          : [];

    let preferredShotType = "single_dialogue_close";
    if (speakerCount >= 2 && dialogueSceneType === "shared_frame_dialogue") preferredShotType = "two_shot_medium_shared";
    else if (speakerCount >= 2) preferredShotType = "single_dialogue_close_with_listener_implied";
    else if (dialogueSceneType === "speaker_with_listener_presence") preferredShotType = "over_shoulder_intent";

    const preferredFrameFocus = sid ? `active_speaker:${sid}` : "unknown";
    const visualPriority = sid ? [sid, ...listenerIds.filter((id) => id !== sid)] : presentSubjectIds.slice();
    const audioPriority = [...visualPriority];

    speakerFocusPlan.push({
      turnIndex: i,
      speakerId: sid || null,
      listenerIds,
      presentIds: presentSubjectIds.slice(),
      preferredShotType,
      preferredFrameFocus,
      visualPriority,
      audioPriority,
      notes:
        listenerIds.length > 0
          ? "Focus parlante; ascoltatori in campo o impliciti dal cast."
          : "Monologo o unico soggetto in scena.",
    });

    speakerTurnVisualIntent.push({
      turnIndex: i,
      intent: speakerCount > 1 ? "speaker_emphasis_with_listener_context" : "single_speaker_emphasis",
      coverage: isAvatarPath ? "static_reference_frame_only" : "prompt_only_i2v",
      reactionCutawayDesired: speakerCount > 1 && i > 0,
    });

    const vm = sid ? speakerVoiceMap[sid] : null;
    speakerTurnAudioIntent.push({
      turnIndex: i,
      speakerId: sid || null,
      activeSpeaker: sid,
      voiceId: vm?.chosenVoiceId || null,
      emphasis: "turn_primary",
      duckOthers: false,
      offscreenAudibleIds: listenersNotSpeaking.filter((id) => id !== sid),
      timingHintSec: lineDurationSec(i),
      notes: "Allineato a H8: segmento TTS dedicato nel mix unico.",
    });
  }

  const shotArchetype =
    speakerCount >= 2
      ? dialogueSceneType === "shared_frame_dialogue"
        ? "shared_medium_shot"
        : "alternating_close_dialogue"
      : dialogueSceneType === "speaker_with_listener_presence"
        ? "over_shoulder"
        : "close_dialogue_focus";

  const dialogueShotPlan = {
    shotArchetype,
    turnCoverageMode: isAvatarPath ? "single_continuous_take_avatar" : "prompt_arc_scene",
    reactionShotNeeded: speakerCount > 1,
    sharedFramePreferred: dialogueSceneType === "shared_frame_dialogue" || focusRaw === "pair",
    speakerIsolationPreferred: speakerCount > 1 && dialogueSceneType !== "shared_frame_dialogue",
    notes: isAvatarPath
      ? "Nessun taglio reazione o two-shot: un solo stream video da immagine scena + lip-sync su traccia mista."
      : "O3: intenti shot/coverage solo nel prompt; nessun controllo camera nativo.",
  };

  const foregroundSubjects = [...speakerIds].filter((id) => presentSubjectIds.includes(id));
  const foregroundOffscreenSpeakers = speakersNotInPresent.slice();
  const backgroundSubjects = listenersNotSpeaking.slice();
  const sharedFrameSubjects =
    dialogueSceneType === "shared_frame_dialogue" || focusRaw === "pair" ? [...speakerIds] : [];
  const offscreenButAudibleSubjects = uniqSorted([...speakersNotInPresent, ...listenersNotSpeaking.filter((id) => !foregroundSubjects.includes(id))]);

  const subjectStagingPlan = {
    foregroundSubjects,
    backgroundSubjects,
    sharedFrameSubjects,
    offscreenButAudibleSubjects,
    subjectPresenceNotes: [
      sceneCastIds.length ? `Cast scena (characters_present): ${sceneCastIds.join(", ")}` : "Nessun cast scena dichiarato.",
      clipPresentIds.length ? `Presenti clip: ${clipPresentIds.join(", ")}` : "Nessun clipPresentCharacterIds.",
      isAvatarPath
        ? "Avatar: la composizione è quella dell’immagine scena; staging testuale è advisory."
        : "Cinematic: staging veicolabile nel prompt; esecuzione non garantita.",
      foregroundOffscreenSpeakers.length > 0
        ? `Speaker in battute ma non in present/cast visivo: ${foregroundOffscreenSpeakers.join(", ")} (udibili / fuori campo).`
        : null,
    ].filter(Boolean),
  };

  const dialoguePresencePlan = {
    presentSubjectIds: presentSubjectIds.slice(),
    speakerIds: [...speakerIds].sort(),
    listenersInFrame: listenersNotSpeaking.slice(),
    offscreenButAudible: offscreenButAudibleSubjects.slice(),
    coPresenceMode: multiSubjectPresenceMode,
  };

  const audioExecuted = lines.length > 0 && speakerCount > 0 && ctx?.multiVoiceRenderResult != null;

  const dialogueDirectionConstraintReport = buildDialogueDirectionConstraintReport({
    clip,
    dialogueSceneType,
    speakerCount,
    presentSubjectIds,
    executorType,
    isAvatarPath,
    audioExecuted,
  });

  const visualLimitations = [
    isAvatarPath
      ? "Kling Avatar: un’immagine sorgente + lip-sync su audio completo; nessun re-frame per turno."
      : "Kling O3: un prompt + frame; copertura dialogica multi-shot non è API nativa.",
    speakerCount > 1
      ? "Presenza multi-soggetto nel video non è diarizzata per volto: lip-sync globale sulla scena."
      : null,
    listenersNotSpeaking.length > 0
      ? "Ascoltatori in cast non ricevono turni visivi dedicati senza executor futuro o editing."
      : null,
  ].filter(Boolean);

  const executionLimitations = [
    "Il piano shot/staging è preparatorio: verifica sempre videoRenderPlan.compiledProviderPayloadIntent.",
    isAvatarPath && speakerCount > 1
      ? "Esecutore attuale: lip-sync single-face su immagine condivisa; turni multipli solo in audio."
      : null,
  ].filter(Boolean);

  const rationale = [
    `Classificazione: ${dialogueSceneType} (${speakerCount} speaker, ${presentSubjectIds.length} soggetti presenti).`,
    isAvatarPath
      ? "Video: talking-head / scena fissata; regia dialogica multi-soggetto resta intento + H8 onora le voci."
      : "Video: I2V da frame; dialogo in questo flusso produrrebbe comunque piano advisory se usato fuori avatar.",
  ].join(" ");

  return {
    engineVersion: DIALOGUE_DIRECTION_ENGINE_VERSION,
    computedAt: new Date().toISOString(),
    clipType: clip.clipType === CLIP_TYPE.DIALOGUE ? CLIP_TYPE.DIALOGUE : CLIP_TYPE.NARRATED,
    sceneType: ctx?.sceneType != null ? String(ctx.sceneType) : null,
    sceneId,
    dialogueSceneType,
    speakerCount,
    presentSubjectIds,
    activeSpeakerSequence,
    speakerFocusPlan,
    subjectStagingPlan,
    dialogueShotPlan,
    dialogueFrameMode,
    multiSubjectPresenceMode,
    speakerTurnVisualIntent,
    speakerTurnAudioIntent,
    dialoguePresencePlan,
    visualLimitations,
    executionLimitations,
    rationale,
    dialogueDirectionConstraintReport,
    _meta: {
      sceneCastIds,
      clipPresentIds,
      listenersNotSpeaking,
      speakersNotInPresent,
    },
  };
}

function buildDialogueDirectionConstraintReport({
  clip,
  dialogueSceneType,
  speakerCount,
  presentSubjectIds,
  executorType,
  isAvatarPath,
  audioExecuted,
}) {
  const presentCount = presentSubjectIds.length;
  const hasMultiPresenceInFrame = presentCount > 1 || speakerCount > 1;

  /** @type {'executed_now'|'partially_honored'|'advisory_only'|'future_executor_needed'} */
  let dialogueRegiaVideoTier = "advisory_only";
  if (dialogueSceneType === "unresolved_dialogue_presence") {
    dialogueRegiaVideoTier = "future_executor_needed";
  } else if (isAvatarPath && clip?.clipType === CLIP_TYPE.DIALOGUE) {
    dialogueRegiaVideoTier = hasMultiPresenceInFrame ? "partially_honored" : "executed_now";
  } else if (!isAvatarPath && clip?.clipType === CLIP_TYPE.DIALOGUE) {
    dialogueRegiaVideoTier = "advisory_only";
  }

  /** @type {'executed_now'|'partially_honored'|'advisory_only'|'future_executor_needed'} */
  let multiPresenceSupport = "advisory_only";
  if (audioExecuted && speakerCount > 1) {
    multiPresenceSupport = "partially_honored";
  } else if (audioExecuted && speakerCount === 1 && presentCount <= 1) {
    multiPresenceSupport = "executed_now";
  } else if (audioExecuted && speakerCount === 1 && presentCount > 1) {
    multiPresenceSupport = "partially_honored";
  }

  const multiSubjectVideoSupportTier =
    dialogueSceneType === "unresolved_dialogue_presence"
      ? "future_executor_needed"
      : isAvatarPath && hasMultiPresenceInFrame
        ? "partially_honored"
        : isAvatarPath && !hasMultiPresenceInFrame
          ? "executed_now"
          : "advisory_only";

  return {
    reportVersion: 1,
    builtAt: new Date().toISOString(),
    executorType,
    isAvatarPath,
    dialogueSceneType,
    speakerCount,
    presentSubjectCount: presentSubjectIds.length,
    audioMultiVoice: audioExecuted ? "executed_now" : "advisory_only",
    dialogueRegiaVideoTier,
    multiSubjectPresenceSupport: multiPresenceSupport,
    honestyLabels: {
      videoRegiaPlan: dialogueRegiaVideoTier,
      stagingAndShotIntent: "advisory_only",
      shotCoverageIntent: "advisory_only",
      executorSingleFaceLipSync: isAvatarPath ? "executed_now" : "not_applicable",
      cinematicPromptRegia: !isAvatarPath ? "partially_honored" : "advisory_only",
    },
    summary: {
      multiSubjectVideoSupportTier,
      avatarDegradesToSingleFaceLipSync: isAvatarPath === true && hasMultiPresenceInFrame,
      cinematicCarriesRegiaAsTextOnly: !isAvatarPath,
    },
    notes: [
      isAvatarPath && hasMultiPresenceInFrame
        ? "Multi-presenza in scena o multi-speaker: H8 onora le voci; Avatar = lip-sync su quadro unico (nessun taglio reazione / two-shot reale)."
        : null,
      !isAvatarPath
        ? "Percorso cinematic: ogni intento dialogico multi-soggetto va nel prompt, senza shot editing."
        : null,
    ].filter(Boolean),
  };
}

/**
 * Riepilogo compatto da fondere in videoExecutionStrategy.
 * @param {object|null} plan — output buildDialogueDirectionPlan
 */
export function dialogueDirectionSummaryForVideoStrategy(plan) {
  if (!plan || typeof plan !== "object") return null;
  return {
    engineVersion: plan.engineVersion ?? DIALOGUE_DIRECTION_ENGINE_VERSION,
    dialogueSceneType: plan.dialogueSceneType ?? null,
    speakerCount: plan.speakerCount ?? 0,
    presentSubjectIds: Array.isArray(plan.presentSubjectIds) ? plan.presentSubjectIds : [],
    dialogueFrameMode: plan.dialogueFrameMode ?? null,
    multiSubjectPresenceMode: plan.multiSubjectPresenceMode ?? null,
    dialogueRegiaVideoTier: plan.dialogueDirectionConstraintReport?.dialogueRegiaVideoTier ?? null,
    multiSubjectPresenceSupport: plan.dialogueDirectionConstraintReport?.multiSubjectPresenceSupport ?? null,
    avatarSingleFaceLipSyncOnly: plan.dialogueDirectionConstraintReport?.summary?.avatarDegradesToSingleFaceLipSync === true,
    cinematicRegiaAsPromptTextOnly: plan.dialogueDirectionConstraintReport?.summary?.cinematicCarriesRegiaAsTextOnly === true,
  };
}
