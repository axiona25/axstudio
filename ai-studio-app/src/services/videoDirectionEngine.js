/**
 * AXSTUDIO H5 — Strategia video esecutiva: classifica clip, sceglie executor (avatar vs cinematic I2V),
 * dichiara cosa è onorabile vs degradato rispetto alla regia compilata.
 *
 * Split prodotto:
 * - Dialoghi / lip-sync → Kling Avatar v2 Pro (immagine + audio).
 * - Narrato / establishing / ambiente → Kling O3 reference-to-video (immagine + prompt; audio mix muxato dopo).
 */

import { CLIP_TYPE } from "./scenografieVideoWorkflow.js";
import { KLING_AVATAR_V2_PRO_ENDPOINT } from "./klingAvatarService.js";
import { KLING_O3_REFERENCE_TO_VIDEO_ENDPOINT } from "./scenografieCinematicKlingO3.js";
import { PIPELINE_PROVIDER_COVERAGE } from "./scenografiePipelineCompiledPolicy.js";

export const VIDEO_DIRECTION_ENGINE_VERSION = 2;

/** @typedef {'avatar_lipsync' | 'cinematic_i2v' | 'fallback_avatar' | 'future_executor_unavailable'} VideoExecutorType */
/** @typedef {'avatar_provider' | 'cinematic_i2v_provider' | 'fallback_avatar' | 'blocked'} ExecutorDispatchMode */

function trim(v) {
  return v != null ? String(v).trim() : "";
}

/**
 * @param {object} clip
 */
function dialogueSpeakerCount(clip) {
  const lines = Array.isArray(clip?.dialogLines) ? clip.dialogLines : [];
  const ids = new Set();
  for (const line of lines) {
    const id = line?.characterId != null ? String(line.characterId).trim() : "";
    if (id) ids.add(id);
  }
  return ids.size;
}

/**
 * @param {object} clip
 */
function isCinematicEstablishing(clip) {
  if (!clip || clip.clipType === CLIP_TYPE.DIALOGUE) return false;
  const focus = String(clip.clipFocusSubject || "").trim();
  const open = String(clip.clipOpeningStyle || "").trim();
  const cam = String(clip.clipCameraPreset || "").trim();
  if (focus !== "environment" && focus !== "symbolic_place") return false;
  if (open === "cinematic_open") return true;
  if (cam === "reveal" || cam === "smooth_camera" || cam === "push_in_soft") return true;
  return false;
}

/**
 * Classificazione operativa (bucket richiesto da roadmap H5).
 * @param {object} ctx
 */
export function classifyClipVideoOperationally(ctx) {
  const clip = ctx?.clip && typeof ctx.clip === "object" ? ctx.clip : {};
  const isDialogue = clip.clipType === CLIP_TYPE.DIALOGUE;
  const speakers = dialogueSpeakerCount(clip);

  if (isDialogue) {
    if (speakers > 1) return "dialogue_multi_presence_static";
    return "dialogue_single_speaker";
  }
  if (isCinematicEstablishing(clip)) return "cinematic_establishing_shot";
  const focus = String(clip.clipFocusSubject || "environment").trim();
  if (focus === "single_character" || focus === "pair" || focus === "action_gesture") {
    return "narrated_character_no_dialogue";
  }
  return "narrated_environment";
}

/**
 * @param {object} ctx
 * @param {object} ctx.clip
 * @param {object|null} ctx.compiledVideoDirection
 * @param {object|null} ctx.compiledCreativeIntent
 * @param {object|null} ctx.plan
 * @param {object|null} ctx.sceneRow — riga sceneResults normalizzata
 * @param {string|null} ctx.sceneImageUrl — URL variante attiva (pre-fal)
 */
export function computeVideoExecutionStrategy(ctx) {
  const clip = ctx?.clip && typeof ctx.clip === "object" ? ctx.clip : {};
  const v = ctx?.compiledVideoDirection && typeof ctx.compiledVideoDirection === "object" ? ctx.compiledVideoDirection : {};
  const cr = ctx?.compiledCreativeIntent && typeof ctx.compiledCreativeIntent === "object" ? ctx.compiledCreativeIntent : {};
  const sceneRow = ctx?.sceneRow && typeof ctx.sceneRow === "object" ? ctx.sceneRow : null;
  const plan = ctx?.plan && typeof ctx.plan === "object" ? ctx.plan : null;

  const strategyType = classifyClipVideoOperationally({ clip });
  const isDialogue = clip.clipType === CLIP_TYPE.DIALOGUE;

  /** @type {VideoExecutorType} */
  let videoExecutorType = "cinematic_i2v";
  /** @type {ExecutorDispatchMode} */
  let executorDispatchMode = "cinematic_i2v_provider";
  let videoExecutorProvider = "fal";
  let videoExecutorModel = KLING_O3_REFERENCE_TO_VIDEO_ENDPOINT;

  if (isDialogue) {
    videoExecutorType = "avatar_lipsync";
    executorDispatchMode = "avatar_provider";
    videoExecutorModel = KLING_AVATAR_V2_PRO_ENDPOINT;
  }

  const strategyTags = isDialogue ? [strategyType, "dialogue_talking_avatar"] : [strategyType, "cinematic_i2v"];
  const sceneId = clip.sceneId != null ? String(clip.sceneId) : null;
  const scene = sceneId && Array.isArray(plan?.scenes) ? plan.scenes.find((s) => s?.id === sceneId) : null;
  const sceneTitle = scene?.title_it != null ? String(scene.title_it) : scene?.title != null ? String(scene.title) : null;

  const presentCharIds = Array.isArray(clip.clipPresentCharacterIds)
    ? clip.clipPresentCharacterIds.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const hasCharactersInClip = presentCharIds.length > 0 || dialogueSpeakerCount(clip) > 0;

  const requiresLipSync = isDialogue;
  const requiresTalkingAvatar = isDialogue;

  const narratedEnv = strategyType === "narrated_environment" || strategyType === "cinematic_establishing_shot";
  const usesSceneAsStaticSource = narratedEnv || strategyType === "narrated_character_no_dialogue";
  const usesSceneAsCinematicSource = strategyType === "cinematic_establishing_shot";

  /** Regia: avatar non accetta parametri; O3 accetta prompt (parziale). */
  const cameraIntentHandling = isDialogue
    ? "advisory_only_avatar_accepts_no_camera_params"
    : "partial_honesty_via_prompt_only_no_explicit_camera_api";

  const canHonorCameraIntent = !isDialogue;

  const providerChoice = isDialogue ? "fal_kling_avatar_v2_pro" : "fal_kling_o3_reference_to_video";
  const providerMode = videoExecutorModel;
  const renderApproach = isDialogue
    ? "neural_avatar_image_plus_audio_lipsync"
    : usesSceneAsCinematicSource
      ? "reference_frame_i2v_prompt_driven_establishing"
      : "reference_frame_i2v_prompt_driven_narration_broll";

  const limitations = [];
  if (isDialogue) {
    limitations.push(
      "Kling Avatar v2 Pro accetta solo image_url + audio_url: nessun parametro esplicito shot/camera nel body API.",
      "La regia compilata resta intento; il modello interpreta implicitamente da frame + traccia audio.",
    );
  } else {
    limitations.push(
      "Kling O3 reference-to-video: shot/camera/regia sono veicolate nel prompt testuale, non come parametri camera dedicati.",
      "generate_audio=false sul provider video: musica/voce/narrato provengono dal mix AXSTUDIO e vengono muxate dopo il render (ffmpeg.wasm).",
      "Il modello può non rispettare fedelmente ogni intento di regia presente nel Director Engine se non è reso esplicito nel prompt.",
    );
  }
  if (isDialogue && strategyType === "dialogue_multi_presence_static") {
    limitations.push(
      "H8: TTS ElevenLabs distinto per battuta/voce; un solo WAV verso Kling Avatar. Lip-sync e movimento volto rispondono all’audio misto, non a un modello multi-volto separato.",
    );
  }

  const rationale = isDialogue
    ? "Executor talking-avatar: dialogo → lip-sync e presenza parlante da audio + immagine scena."
    : strategyType === "cinematic_establishing_shot"
      ? "Executor cinematic I2V: establishing / ambiente → motion da frame senza lip-sync forzato."
      : strategyType === "narrated_character_no_dialogue"
        ? "Executor cinematic I2V: narrato con personaggio in quadro ma senza dialogo sincrono — motion da prompt + reference."
        : "Executor cinematic I2V: voiceover / ambiente — reference image + prompt; niente talking-head obbligatorio.";

  const resolvedVisualPlan = {
    visualGoal: v.visualGoal ?? null,
    emotionalTone: v.emotionalTone ?? null,
    directionPromptResolved: v.directionPromptResolved ?? null,
    narrativeGoal: cr.narrativeGoal ?? null,
    whatMustBeSeen: cr.whatMustBeSeen ?? null,
    sceneTitle,
    sceneVariant: sceneRow?.sceneDisplayedVariant ?? null,
  };

  const resolvedShotPlan = {
    shotType: v.shotType ?? null,
    openingStyle: v.openingStyle ?? null,
    closingStyle: v.closingStyle ?? null,
    focusSubject: v.focusSubject ?? null,
  };

  const resolvedMotionPlan = {
    cameraMotion: v.cameraMotion ?? null,
    cameraIntensity: v.cameraIntensity ?? null,
    progressionNote: v.progressionNote ?? null,
  };

  return {
    engineVersion: VIDEO_DIRECTION_ENGINE_VERSION,
    computedAt: new Date().toISOString(),
    strategyType,
    strategyTags,
    /** @type {VideoExecutorType} */
    videoExecutorType,
    videoExecutorProvider,
    videoExecutorModel,
    /** @type {ExecutorDispatchMode} */
    executorDispatchMode,
    /** Famiglia motore legacy UI */
    providerArchetype: isDialogue ? "talking_avatar" : "cinematic_i2v",
    clipType: isDialogue ? CLIP_TYPE.DIALOGUE : CLIP_TYPE.NARRATED,
    providerChoice,
    providerMode,
    renderApproach,
    requiresLipSync,
    requiresTalkingAvatar,
    usesSceneAsStaticSource,
    usesSceneAsCinematicSource,
    canHonorCameraIntent,
    cameraIntentHandling,
    resolvedVisualPlan,
    resolvedMotionPlan,
    resolvedShotPlan,
    limitations,
    rationale,
    sceneContext: {
      sceneId,
      hasCharactersInClip,
      presentCharacterCount: presentCharIds.length,
      dialogueSpeakerCount: dialogueSpeakerCount(clip),
      activeSceneVariant: sceneRow?.sceneDisplayedVariant ?? null,
    },
    futureProviderHooks: {
      cinematicI2V: isDialogue ? "Già usato per narrato." : "Attivo (Kling O3).",
      multiSpeakerDiarization: "Per dialogue con voci distinte e lip-sync per personaggio.",
    },
  };
}

/**
 * @param {object} strategy — da computeVideoExecutionStrategy
 * @param {object} urls
 * @param {string|null} urls.sourceSceneImageUrl — variante attiva originale
 * @param {string|null} urls.falImageUrl — dopo ensureImageUrlOnFal
 * @param {string|null} urls.falAudioUrl — mix o voce (mux dopo per cinematic)
 * @param {object} [options]
 * @param {string|null} [options.cinematicPrompt]
 * @param {object|null} [options.compiledCreativeIntent]
 */
export function buildVideoRenderPlan(strategy, urls, options = {}) {
  const s = strategy && typeof strategy === "object" ? strategy : {};
  const u = urls && typeof urls === "object" ? urls : {};
  const opt = options && typeof options === "object" ? options : {};
  const dd =
    opt.dialogueDirectionPlan && typeof opt.dialogueDirectionPlan === "object"
      ? opt.dialogueDirectionPlan
      : null;
  const advisoryDialogueDirection = dd
    ? {
        dialogueSceneType: dd.dialogueSceneType ?? null,
        speakerCount: dd.speakerCount ?? 0,
        presentSubjectIds: Array.isArray(dd.presentSubjectIds) ? dd.presentSubjectIds : [],
        dialogueFrameMode: dd.dialogueFrameMode ?? null,
        multiSubjectPresenceMode: dd.multiSubjectPresenceMode ?? null,
        dialogueShotPlan: dd.dialogueShotPlan ?? null,
        subjectStagingPlan: dd.subjectStagingPlan ?? null,
        dialoguePresencePlan: dd.dialoguePresencePlan ?? null,
        dialogueDirectionConstraintReport: dd.dialogueDirectionConstraintReport ?? null,
      }
    : null;
  const source = trim(u.sourceSceneImageUrl) || null;
  const falImg = trim(u.falImageUrl) || null;
  const falAud = trim(u.falAudioUrl) || null;

  const isAvatar = s.videoExecutorType === "avatar_lipsync" || s.executorDispatchMode === "avatar_provider";
  const cinematicPrompt = opt.cinematicPrompt != null ? String(opt.cinematicPrompt).trim() : "";

  const advisoryAvatar = PIPELINE_PROVIDER_COVERAGE.klingAvatarV2Pro.metadataOnly;
  const advisoryO3 = PIPELINE_PROVIDER_COVERAGE.klingO3ReferenceToVideo.metadataOnly;

  const lipSyncMode = isAvatar
    ? s.requiresLipSync
      ? "provider_inferred_full_track"
      : "voiceover_minimal_or_ambient_faces"
    : "not_applicable_cinematic_i2v";

  const motionExecutionMode = isAvatar
    ? s.requiresTalkingAvatar
      ? "audio_driven_talking_avatar"
      : s.usesSceneAsCinematicSource
        ? "audio_driven_with_establishing_intent_metadata_only"
        : "audio_driven_scene_motion_broll_style"
    : s.usesSceneAsCinematicSource
      ? "reference_i2v_prompt_establishing"
      : "reference_i2v_prompt_narration";

  const chosenExecutorType = s.videoExecutorType ?? (isAvatar ? "avatar_lipsync" : "cinematic_i2v");
  const chosenProvider = s.videoExecutorProvider ?? "fal";
  const chosenModel = s.videoExecutorModel ?? KLING_AVATAR_V2_PRO_ENDPOINT;

  const usesLipSync = isAvatar && !!s.requiresLipSync;
  const usesNarrationDrivenI2V = !isAvatar;
  const sendsAudioToProvider = isAvatar;
  const sendsPromptToProvider = !isAvatar;
  const promptActuallySent = !isAvatar && cinematicPrompt ? cinematicPrompt : null;
  const promptDropped = isAvatar
    ? [...advisoryAvatar.map((x) => `director_field_not_in_avatar_api:${x}`)]
    : [...advisoryO3.map((x) => `director_field_prompt_only_or_omitted:${x}`)];

  const imageActuallySent = !!falImg;
  const audioActuallySentToVideoProvider = isAvatar && !!falAud;

  const executorLimitations = Array.isArray(s.limitations) ? [...s.limitations] : [];

  const baseAdvisory = {
    shotType: s.resolvedShotPlan?.shotType,
    openingStyle: s.resolvedShotPlan?.openingStyle,
    closingStyle: s.resolvedShotPlan?.closingStyle,
    cameraMotion: s.resolvedMotionPlan?.cameraMotion,
    cameraIntensity: s.resolvedMotionPlan?.cameraIntensity,
    focusSubject: s.resolvedShotPlan?.focusSubject,
    visualGoal: s.resolvedVisualPlan?.visualGoal,
    directionPromptResolved: s.resolvedVisualPlan?.directionPromptResolved,
  };

  const dialogueRegiaSummary = dd
    ? {
        dialogueSceneType: dd.dialogueSceneType ?? null,
        speakerCount: dd.speakerCount ?? 0,
        honestyLabels: dd.dialogueDirectionConstraintReport?.honestyLabels ?? null,
        multiSubjectPresenceSupport: dd.dialogueDirectionConstraintReport?.multiSubjectPresenceSupport ?? null,
      }
    : null;

  if (isAvatar) {
    return {
      engineVersion: VIDEO_DIRECTION_ENGINE_VERSION,
      compiledAt: new Date().toISOString(),
      chosenExecutorType,
      chosenProvider,
      chosenModel,
      usesLipSync,
      usesNarrationDrivenI2V,
      sendsAudioToProvider,
      sendsPromptToProvider,
      promptActuallySent: null,
      promptDropped,
      promptActuallySentLength: 0,
      imageActuallySent,
      audioActuallySent: audioActuallySentToVideoProvider,
      audioActuallySentToVideoProvider,
      muxAudioIntoVideoAfterProvider: false,
      executorLimitations,
      activeSceneImageUrl: falImg || source,
      chosenVisualSource: source ? "scene_displayed_variant_then_fal_normalized" : "unknown",
      motionExecutionMode,
      lipSyncMode,
      cameraExecutionMode: "not_applicable_provider_accepts_no_camera_params",
      shotExecutionMode: "not_applicable_provider_accepts_no_shot_params",
      compiledProviderPayloadIntent: {
        image_url: falImg,
        audio_url: falAud,
        advisoryVideoDirection: baseAdvisory,
        advisoryDialogueDirection,
      },
      providerPayloadActuallySent: {
        image_url: falImg,
        audio_url: falAud,
      },
      providerPayloadDroppedFields: [...advisoryAvatar],
      strategyType: s.strategyType ?? null,
      providerChoice: s.providerChoice ?? null,
      finalVideoAssemblyMode: null,
      videoProviderOutputUrl: null,
      muxedFinalVideoUrl: null,
      audioMuxApplied: false,
      audioMuxSourceUrl: null,
      audioMuxCompletedAt: null,
      finalVideoReadyForMontage: false,
      providerReturnedAudioInContainer: null,
      videoConstraintReport: null,
      dialogueRegiaSummary,
    };
  }

  const durationSec = u.cinematicDurationSec != null ? u.cinematicDurationSec : null;
  const aspectRatio = u.cinematicAspectRatio != null ? String(u.cinematicAspectRatio) : "16:9";

  return {
    engineVersion: VIDEO_DIRECTION_ENGINE_VERSION,
    compiledAt: new Date().toISOString(),
    chosenExecutorType,
    chosenProvider,
    chosenModel,
    usesLipSync,
    usesNarrationDrivenI2V,
    sendsAudioToProvider,
    sendsPromptToProvider,
    promptActuallySent,
    promptDropped,
    promptActuallySentLength: promptActuallySent ? promptActuallySent.length : 0,
    imageActuallySent,
    audioActuallySent: false,
    audioActuallySentToVideoProvider: false,
    muxAudioIntoVideoAfterProvider: true,
    postMuxAudioSourceUrl: falAud || null,
    executorLimitations,
    activeSceneImageUrl: falImg || source,
    chosenVisualSource: source ? "scene_displayed_variant_then_fal_normalized" : "unknown",
    motionExecutionMode,
    lipSyncMode,
    cameraExecutionMode: "honesty_prompt_only_kling_o3",
    shotExecutionMode: "honesty_prompt_only_kling_o3",
    compiledProviderPayloadIntent: {
      start_image_url: falImg,
      prompt: cinematicPrompt || null,
      duration: durationSec != null ? String(durationSec) : null,
      aspect_ratio: aspectRatio,
      generate_audio: false,
      advisoryVideoDirection: baseAdvisory,
      advisoryDialogueDirection,
    },
    providerPayloadActuallySent: {
      start_image_url: falImg,
      prompt: cinematicPrompt || null,
      duration: durationSec != null ? String(durationSec) : null,
      aspect_ratio: aspectRatio,
      cfg_scale: 0.5,
      character_orientation: durationSec != null && durationSec > 10 ? "video" : "image",
      generate_audio: false,
    },
    providerPayloadDroppedFields: [...advisoryO3],
    strategyType: s.strategyType ?? null,
    providerChoice: s.providerChoice ?? null,
    finalVideoAssemblyMode: null,
    videoProviderOutputUrl: null,
    muxedFinalVideoUrl: null,
    audioMuxApplied: false,
    audioMuxSourceUrl: null,
    audioMuxCompletedAt: null,
    finalVideoReadyForMontage: false,
    providerReturnedAudioInContainer: null,
    videoConstraintReport: null,
    dialogueRegiaSummary,
  };
}

/**
 * Dopo Kling Avatar: un solo passo, audio nel container.
 * @param {object} plan
 * @param {{ finalVideoUrl: string }} args
 */
export function finalizeAvatarVideoAssembly(plan, args) {
  const p = plan && typeof plan === "object" ? plan : {};
  const u = String(args?.finalVideoUrl || "").trim();
  p.finalVideoAssemblyMode = "avatar_native_single_pass";
  p.videoProviderOutputUrl = u || null;
  p.muxedFinalVideoUrl = u || null;
  p.audioMuxApplied = false;
  p.audioMuxSourceUrl = null;
  p.audioMuxCompletedAt = null;
  p.finalVideoReadyForMontage = !!u;
  p.providerReturnedAudioInContainer = true;
  return p;
}

/**
 * Dopo O3 + mux + upload: file finale per montaggio è muxedFinalVideoUrl.
 * @param {object} plan
 * @param {{ videoProviderOutputUrl: string, muxedFinalVideoUrl: string, audioMuxSourceUrl: string|null, muxBlobBytes?: number }} args
 */
export function finalizeCinematicVideoAssembly(plan, args) {
  const p = plan && typeof plan === "object" ? plan : {};
  const out = String(args?.videoProviderOutputUrl || "").trim();
  const muxed = String(args?.muxedFinalVideoUrl || "").trim();
  const aud = args?.audioMuxSourceUrl != null ? String(args.audioMuxSourceUrl).trim() : "";
  p.finalVideoAssemblyMode = "cinematic_o3_then_browser_mux_upload";
  p.videoProviderOutputUrl = out || null;
  p.muxedFinalVideoUrl = muxed || null;
  p.audioMuxApplied = true;
  p.audioMuxSourceUrl = aud || null;
  p.audioMuxCompletedAt = new Date().toISOString();
  p.finalVideoReadyForMontage = !!muxed;
  p.providerReturnedAudioInContainer = false;
  if (typeof args?.muxBlobBytes === "number" && Number.isFinite(args.muxBlobBytes)) {
    p.finalMuxedBlobBytes = args.muxBlobBytes;
  }
  return p;
}

/**
 * Annota fallimento assembly senza mascherare lo stage.
 * @param {object} plan
 * @param {{ stage: string, at?: string }} args
 */
export function markVideoAssemblyFailure(plan, args) {
  const p = plan && typeof plan === "object" ? plan : {};
  p.assemblyFailureStage = String(args?.stage || "").trim() || null;
  p.assemblyFailedAt = args?.at || new Date().toISOString();
  p.finalVideoReadyForMontage = false;
  return p;
}
