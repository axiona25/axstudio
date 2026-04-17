/**
 * AXSTUDIO — Execution layer (H2/H6/H7/H8): Director Engine + Audio Design → input esecutivi onesti.
 *
 * - ElevenLabs: enforceable text + voiceId (dialogo H8 = più chiamate lato runner, un WAV finale).
 * - Audio clip: H6 musica (provider o synth fallback), H4 ambiente/SFX MVP se attivi, H7 mix stereo su fal quando i bed esistono.
 * - Video Scenografie: **Avatar** Kling v2 Pro (image+audio mix) **oppure** **Cinematic** O3 (prompt+frame; mix muxato dopo, non nel body O3).
 * - Regia camera/shot: advisory su Avatar; su O3 solo ciò che entra nel prompt (niente parametri camera nativi).
 * - Risoluzione/qualità **preview clip** vs **final montaggio**: profili separati in `videoRenderProfiles.js` (questo modulo non eredita export finale).
 */

import { CLIP_TYPE, buildClipStructuredPrompts } from "./scenografieVideoWorkflow.js";
import { PIPELINE_PROVIDER_COVERAGE, resolveCompiledSnapshotForPipeline } from "./scenografiePipelineCompiledPolicy.js";
import { KLING_AVATAR_V2_PRO_ENDPOINT } from "./klingAvatarService.js";
import { KLING_O3_REFERENCE_TO_VIDEO_ENDPOINT } from "./scenografieCinematicKlingO3.js";
import { buildVideoConstraintReport } from "./videoConstraintReport.js";
import { resolveAudioDesignForPipeline } from "./audioDesignEngine.js";

export const EXECUTION_COMPILER_VERSION = 1;

function trimStr(v) {
  return v != null ? String(v).trim() : "";
}

/**
 * Report strutturato: cosa il sistema può imporre oggi vs cosa resta metadata / futuro.
 * @param {object} [extra]
 */
export function buildExecutionConstraintReport(extra = {}) {
  const reasonByField = {
    text: "Inviato nel body ElevenLabs text-to-speech (narrato o testo dialogo aggregato in anteprima).",
    voiceId: "Inviato nel body ElevenLabs text-to-speech.",
    imageUrl:
      "Avatar: URL immagine su fal → Kling Avatar v2 Pro. Cinematic: stesso URL come start_image verso O3 (path diverso in pipeline).",
    audioUrl:
      "Mix stereo clip su fal (voce + bed quando generati): **inviato** a Kling Avatar con l’immagine; **non** inviato al body O3 — usato nel mux post-I2V.",
  };

  for (const f of PIPELINE_PROVIDER_COVERAGE.elevenLabsTextToSpeech.metadataOnly) {
    const k = String(f).replace(/\s+/g, "_");
    if (!reasonByField[k]) {
      reasonByField[k] =
        "Advisory: nel compiled/brief ma non nel payload minimo ElevenLabs (tono, ritmo, contesto musica/ambiente, ecc.).";
    }
  }
  for (const f of PIPELINE_PROVIDER_COVERAGE.klingAvatarV2Pro.metadataOnly) {
    const k = String(f).replace(/\s+/g, "_");
    if (!reasonByField[k]) {
      reasonByField[k] =
        "Advisory: direzione video/regia nel compiled; API Kling Avatar v2 Pro accetta solo image+audio oggi.";
    }
  }
  for (const f of PIPELINE_PROVIDER_COVERAGE.klingO3ReferenceToVideo?.metadataOnly || []) {
    const k = String(f).replace(/\s+/g, "_");
    if (!reasonByField[k]) {
      reasonByField[k] =
        "Advisory o solo prompt: campo Director non inviato come parametro API dedicato su Kling O3 (solo testo prompt / metadata).";
    }
  }

  return {
    compilerVersion: EXECUTION_COMPILER_VERSION,
    builtAt: extra.builtAt ?? null,
    policySource: extra.policySource ?? null,
    /** Cosa il runtime fa davvero vs cosa resta advisory / premium futuro. */
    executionTruth: {
      clipAudioPipeline:
        "H8 voce/dialogo → ElevenLabs (multi-chiamata per battuta se dialogo). H6 musica: provider reale quando abilitato, altrimenti pad synth fallback. H4 ambiente/SFX: pad MVP sintetico se attivi. H7: mix stereo clip (Web Audio) + upload fal quando ci sono stem da sommare.",
      clipVideoPipeline:
        "Dialoghi → Kling Avatar v2 Pro (image + URL traccia mix). Narrato/cinematic → Kling O3 reference-to-video (prompt + frame, audio non nel payload) poi mux ffmpeg con la stessa traccia mix → `clip.videoUrl` finale.",
      montageFilm:
        "Montaggio MVP: concatena i `clip.videoUrl` (MP4 già con audio incorporato per clip). Nessun remix stereo globale sul film in questo passo.",
      premiumVsMvp:
        "MVP tecnico ma reale: stem musicali da provider/synth, bed ambiente/SFX sintetici, mix per clip. Premium/future: librerie licenziate, mastering film, transizioni oltre il taglio netto.",
    },
    providerSupportsWhat: {
      elevenlabs_tts: {
        enforceable: [...PIPELINE_PROVIDER_COVERAGE.elevenLabsTextToSpeech.sentToApi],
        advisory: [...PIPELINE_PROVIDER_COVERAGE.elevenLabsTextToSpeech.metadataOnly],
      },
      fal_kling_avatar_v2_pro: {
        enforceable: [...PIPELINE_PROVIDER_COVERAGE.klingAvatarV2Pro.sentToApi],
        advisory: [...PIPELINE_PROVIDER_COVERAGE.klingAvatarV2Pro.metadataOnly],
      },
      fal_kling_o3_reference_to_video: {
        enforceable: [...(PIPELINE_PROVIDER_COVERAGE.klingO3ReferenceToVideo?.sentToApi || [])],
        advisory: [...(PIPELINE_PROVIDER_COVERAGE.klingO3ReferenceToVideo?.metadataOnly || [])],
      },
    },
    ignoredFields: [],
    degradedFields: [
      {
        field: "clipEnergyLevel",
        status: "partially_mapped",
        note: "Influenza piano musica/ambiente e livello pad MVP; non è un parametro numerico inviato al provider musicale.",
      },
      {
        field: "effectsEnabled",
        status: "mvp_synthetic_when_on",
        note: "Con effetti attivi il runner può generare SFX MVP procedurali — non libreria SFX premium.",
      },
    ],
    futureOnlyFields: [
      {
        field: "licensed_music_catalog",
        reason: "Catalogo musicale licenziato / cue sheet commerciale non integrato nel runner.",
      },
      {
        field: "film_level_mastering_remix",
        reason: "Secondo passaggio mix/mastering sul film intero dopo concat (sidechain globale, norm loudness inter-clip).",
      },
      {
        field: "native_camera_shot_api",
        reason: "Parametri camera/shot nativi in API video oltre al prompt O3 o alla coppia image+audio Avatar.",
      },
      {
        field: "per_character_lipsync_layers",
        reason: "Lip-sync separato per più volti nello stesso inquadratura quando il provider lo espone.",
      },
    ],
    reasonByField,
    runNotes: extra.runNotes && typeof extra.runNotes === "object" ? extra.runNotes : undefined,
  };
}

function stemOk(stem) {
  return stem && typeof stem === "object" && String(stem.status || "").toLowerCase() === "ok";
}

function anyBedRendered(postAudioRender) {
  if (!postAudioRender || typeof postAudioRender !== "object") return false;
  return stemOk(postAudioRender.musicStem) || stemOk(postAudioRender.ambientStem) || stemOk(postAudioRender.sfxStem);
}

/**
 * @param {object|null} audioDesignBundle
 * @param {object|null} [postAudioRender] — output `postAudioRenderForMixPlan` da audioRenderEngine dopo il render
 */
export function buildMixExecutionPlan(audioDesignBundle, postAudioRender = null) {
  const b = audioDesignBundle && typeof audioDesignBundle === "object" ? audioDesignBundle : {};
  const surf = b.executionSurface && typeof b.executionSurface === "object" ? b.executionSurface : {};
  const musicOn = !!b.compiledMusicPlan?.enabled;
  const ambOn = !!b.compiledAmbientPlan?.enabled;
  const sfxOn = !!b.compiledSfxPlan?.enabled;
  const voiceOn = surf.voiceStemFromElevenLabs !== false;

  const par = postAudioRender && typeof postAudioRender === "object" ? postAudioRender : null;
  const bedsDone = anyBedRendered(par);

  if (!par) {
    const future = [];
    if (musicOn) future.push("music");
    if (ambOn) future.push("ambient");
    if (sfxOn) future.push("sfx");
    future.push("final_mix");
    return {
      version: 1,
      voiceStemPlanned: voiceOn,
      musicStemPlanned: musicOn,
      ambientStemPlanned: ambOn,
      sfxStemPlanned: sfxOn,
      currentExecutableStems: ["voice"],
      futureExecutableStems: future,
      mixPriority: b.compiledAudioMixIntent?.voicePriority || "primaria",
      audioRenderStrategy: "voice_tts_then_optional_procedural_beds_mvp",
      executionSurfaceNote: surf.note || null,
      compiledAudioMixIntent: b.compiledAudioMixIntent || null,
      mixedStereoDelivered: false,
      mixedAudioUrl: null,
    };
  }

  const current = [];
  if (voiceOn) current.push("voice");
  if (stemOk(par.musicStem)) current.push("music");
  if (stemOk(par.ambientStem)) current.push("ambient");
  if (stemOk(par.sfxStem)) current.push("sfx");

  const future = [];
  if (musicOn && !stemOk(par.musicStem)) future.push("music");
  if (ambOn && !stemOk(par.ambientStem)) future.push("ambient");
  if (sfxOn && !stemOk(par.sfxStem)) future.push("sfx");
  future.push("hollywood_mix"); // mastering / sidechain / libreria HD

  return {
    version: 1,
    voiceStemPlanned: voiceOn,
    musicStemPlanned: musicOn,
    ambientStemPlanned: ambOn,
    sfxStemPlanned: sfxOn,
    currentExecutableStems: current.length ? current : ["voice"],
    futureExecutableStems: future,
    mixPriority: b.compiledAudioMixIntent?.voicePriority || "primaria",
    audioRenderStrategy: bedsDone ? "web_audio_mix_mvp_uploaded_wav" : "voice_only_no_beds",
    executionSurfaceNote: surf.note || null,
    compiledAudioMixIntent: b.compiledAudioMixIntent || null,
    mixedStereoDelivered: bedsDone && !!par.mixedAudioUrl,
    mixedAudioUrl: par.mixedAudioUrl || null,
  };
}

/**
 * @param {object} args
 * @param {object} args.clip
 * @param {object|null} [args.compiledAudioDirection]
 * @param {object|null} [args.compiledCreativeIntent]
 * @param {string} args.ttsText
 * @param {string} args.ttsVoiceId
 */
export function buildAudioExecutionInput({ clip, compiledAudioDirection, compiledCreativeIntent, ttsText, ttsVoiceId }) {
  const a = compiledAudioDirection && typeof compiledAudioDirection === "object" ? compiledAudioDirection : {};
  const cr = compiledCreativeIntent && typeof compiledCreativeIntent === "object" ? compiledCreativeIntent : {};
  const c = clip && typeof clip === "object" ? clip : {};
  const type = c.clipType === CLIP_TYPE.DIALOGUE ? CLIP_TYPE.DIALOGUE : CLIP_TYPE.NARRATED;

  const enforceableAudioParams = {
    text: ttsText,
    voiceId: ttsVoiceId,
  };

  const advisoryAudioParams = {
    narrationTone: a.narrationTone ?? null,
    narrationPace: a.narrationPace ?? null,
    musicMood: a.musicMood ?? null,
    ambientPreset: a.ambientPreset ?? null,
    effectsEnabled: a.effectsEnabled === true,
    energyLevel: a.energyLevel ?? null,
    audioGoal: a.audioGoal ?? null,
    audioPromptResolved: a.audioPromptResolved ?? null,
    clipAudioDirection: trimStr(c.clipAudioDirection) || null,
    narratorDeliveryTone: trimStr(c.narratorDeliveryTone) || null,
    narratorPaceWizard: trimStr(c.narratorPace) || null,
    narratorPauseStyle: trimStr(c.narratorPauseStyle) || null,
    dialogueDeliveryTone: trimStr(c.dialogueDeliveryTone) || null,
    clipExternalNarratorNote: trimStr(c.clipExternalNarratorNote) || null,
  };

  const resolvedNarrationDirection =
    type === CLIP_TYPE.NARRATED
      ? `${a.narrationTone || "—"} · ritmo: ${a.narrationPace || "—"}`
      : null;
  const resolvedDialogueDirection =
    type === CLIP_TYPE.DIALOGUE
      ? `${advisoryAudioParams.dialogueDeliveryTone || a.narrationTone || "—"} · ${a.narrationPace || "—"}`
      : null;

  return {
    provider: "elevenlabs",
    providerMode: "text_to_speech_mp3",
    voiceId: ttsVoiceId,
    ttsText,
    enforceableAudioParams,
    advisoryAudioParams,
    resolvedNarrationDirection,
    resolvedDialogueDirection,
    resolvedAudioGoal: a.audioGoal ?? null,
    clipMode: type,
    creativeWhatMustBeHeard: cr.whatMustBeHeard ?? null,
  };
}

/**
 * @param {object} args
 * @param {object|null} [args.compiledVideoDirection]
 * @param {string|null} [args.sceneImageUrlForProvider]
 * @param {string|null} [args.audioUrlForProvider]
 * @param {string|null} [args.sceneImageUrlSource]
 */
export function buildVideoExecutionInput({
  compiledVideoDirection,
  sceneImageUrlForProvider,
  audioUrlForProvider,
  sceneImageUrlSource,
  videoStrategy = null,
  videoRenderPlan = null,
}) {
  const v = compiledVideoDirection && typeof compiledVideoDirection === "object" ? compiledVideoDirection : {};
  const strat = videoStrategy && typeof videoStrategy === "object" ? videoStrategy : null;
  const plan = videoRenderPlan && typeof videoRenderPlan === "object" ? videoRenderPlan : null;
  const cinematic = strat?.videoExecutorType === "cinematic_i2v";

  const advisoryVideoParams = {
    visualGoal: v.visualGoal ?? null,
    shotType: v.shotType ?? null,
    openingStyle: v.openingStyle ?? null,
    closingStyle: v.closingStyle ?? null,
    cameraMotion: v.cameraMotion ?? null,
    cameraIntensity: v.cameraIntensity ?? null,
    focusSubject: v.focusSubject ?? null,
    emotionalTone: v.emotionalTone ?? null,
    progressionNote: v.progressionNote ?? null,
    directionPromptResolved: v.directionPromptResolved ?? null,
    sceneId: v.sceneId ?? null,
  };

  if (cinematic) {
    const promptSent = plan?.promptActuallySent || null;
    return {
      provider: "fal.ai",
      providerMode: KLING_O3_REFERENCE_TO_VIDEO_ENDPOINT,
      sceneImageUrl: sceneImageUrlForProvider || null,
      sceneImageUrlSource: sceneImageUrlSource || null,
      audioUrlSourceStrategy:
        "mix_axstudio_muxed_after_i2v_not_sent_to_kling_o3_generate_audio_false",
      enforceableVideoParams: {
        start_image_url: sceneImageUrlForProvider || null,
        prompt: promptSent,
        generate_audio: false,
      },
      advisoryVideoParams,
      resolvedVisualPrompt: v.directionPromptResolved || v.visualGoal || null,
      resolvedShotIntent: v.shotType ?? null,
      resolvedCameraIntent: [v.cameraMotion, v.cameraIntensity].filter(Boolean).join(" · ") || null,
      resolvedFocusIntent: v.focusSubject ?? null,
      videoExecutorType: strat?.videoExecutorType ?? null,
    };
  }

  const enforceableVideoParams = {
    imageUrl: sceneImageUrlForProvider || null,
    audioUrl: audioUrlForProvider || null,
  };

  return {
    provider: "fal.ai",
    providerMode: KLING_AVATAR_V2_PRO_ENDPOINT,
    sceneImageUrl: sceneImageUrlForProvider || null,
    sceneImageUrlSource: sceneImageUrlSource || null,
    audioUrlSourceStrategy:
      "elevenlabs_tts_mp3_uploaded_to_fal_storage_then_audioUrl_passed_to_kling_avatar_v2_pro",
    enforceableVideoParams,
    advisoryVideoParams,
    resolvedVisualPrompt: v.directionPromptResolved || v.visualGoal || null,
    resolvedShotIntent: v.shotType ?? null,
    resolvedCameraIntent: [v.cameraMotion, v.cameraIntensity].filter(Boolean).join(" · ") || null,
    resolvedFocusIntent: v.focusSubject ?? null,
    videoExecutorType: strat?.videoExecutorType ?? "avatar_lipsync",
  };
}

/**
 * Snapshot completo per pipeline o preview UI.
 * @param {object} args
 * @param {object} args.clip
 * @param {object} args.compiledSnapshot — compiledVideoDirection, compiledAudioDirection, compiledCreativeIntent, compiledPromptBundle (opzionale)
 * @param {object|null} [args.audioDesignBundle]
 * @param {{ text: string, voiceId: string }} args.tts
 * @param {{ sceneImageUrlSource?: string|null, sceneImageUrlForVideoProvider?: string|null, audioUrlForVideoProvider?: string|null }} [args.urls]
 * @param {string} [args.policySource]
 * @param {{ strategy: object, renderPlan: object }|null} [args.videoDirection] — H5 videoDirectionEngine
 */
export function compileClipExecutionLayer({
  clip,
  compiledSnapshot,
  audioDesignBundle,
  tts,
  urls = {},
  policySource = null,
  postAudioRender = null,
  videoDirection = null,
}) {
  const builtAt = new Date().toISOString();
  const v = compiledSnapshot?.compiledVideoDirection;
  const a = compiledSnapshot?.compiledAudioDirection;
  const c = compiledSnapshot?.compiledCreativeIntent;

  const audioExecutionInput = buildAudioExecutionInput({
    clip,
    compiledAudioDirection: a,
    compiledCreativeIntent: c,
    ttsText: tts.text,
    ttsVoiceId: tts.voiceId,
  });

  const mixExecutionPlan = buildMixExecutionPlan(audioDesignBundle, postAudioRender);

  const vd = videoDirection && typeof videoDirection === "object" ? videoDirection : null;
  const strat = vd?.strategy && typeof vd.strategy === "object" ? vd.strategy : null;
  const vPlan = vd?.renderPlan && typeof vd.renderPlan === "object" ? vd.renderPlan : null;

  const videoExecutionInput = buildVideoExecutionInput({
    compiledVideoDirection: v,
    sceneImageUrlForProvider: urls.sceneImageUrlForVideoProvider ?? null,
    audioUrlForProvider: urls.audioUrlForVideoProvider ?? null,
    sceneImageUrlSource: urls.sceneImageUrlSource ?? null,
    videoStrategy: strat,
    videoRenderPlan: vPlan,
  });

  const executionConstraintReport = buildExecutionConstraintReport({
    builtAt,
    policySource,
    runNotes: {
      clipId: clip?.id ?? null,
      sceneId: clip?.sceneId ?? null,
    },
  });

  const videoConstraintReport = strat && vPlan
    ? buildVideoConstraintReport(strat, vPlan, clip?.dialogueDirectionPlan ?? null)
    : null;

  return {
    compilerVersion: EXECUTION_COMPILER_VERSION,
    builtAt,
    policySource,
    videoExecutionInput,
    audioExecutionInput,
    mixExecutionPlan,
    executionConstraintReport,
    postAudioRender: postAudioRender && typeof postAudioRender === "object" ? postAudioRender : null,
    videoExecutionStrategy: vd?.strategy && typeof vd.strategy === "object" ? vd.strategy : null,
    videoRenderPlan: vd?.renderPlan && typeof vd.renderPlan === "object" ? vd.renderPlan : null,
    videoConstraintReport,
  };
}

/**
 * Preview deterministico per UI (stessi input del motore; URL provider null finché non si genera).
 */
export function compileClipExecutionPreview({ clip, compiledSnapshot, audioDesignBundle, tts, policySource = "ui-preview" }) {
  return compileClipExecutionLayer({
    clip,
    compiledSnapshot,
    audioDesignBundle,
    tts,
    urls: {},
    policySource,
  });
}

/**
 * Ricostruzione deterministica dello snapshot esecutivo (stessi input della pipeline, senza chiamate API).
 * @param {object} clip
 * @param {object|null} plan
 * @param {{ text: string, voiceId: string }} tts
 * @param {{ sceneImageUrlSource?: string|null, sceneImageUrlForVideoProvider?: string|null, audioUrlForVideoProvider?: string|null }} [urls]
 */
export function rebuildExecutionSnapshotFromClip(clip, plan, tts, urls = {}) {
  const compiled = resolveCompiledSnapshotForPipeline(clip, plan);
  const briefs = buildClipStructuredPrompts(clip, plan);
  const audioDesign = resolveAudioDesignForPipeline(clip, compiled, briefs);
  const mixRes = clip?.audioMixExecutionResult && typeof clip.audioMixExecutionResult === "object" ? clip.audioMixExecutionResult : null;
  const postAudioRender =
    mixRes && (clip?.voiceStem || clip?.musicStem || clip?.ambientStem || clip?.sfxStem)
      ? {
          voiceStem: clip.voiceStem,
          musicStem: clip.musicStem,
          ambientStem: clip.ambientStem,
          sfxStem: clip.sfxStem,
          mixedAudioUrl: mixRes.mixedAudioUrl || urls.audioUrlForVideoProvider || clip.audioUrl || null,
        }
      : null;
  const videoDirection =
    clip?.videoExecutionStrategy && typeof clip.videoExecutionStrategy === "object" && clip?.videoRenderPlan && typeof clip.videoRenderPlan === "object"
      ? { strategy: clip.videoExecutionStrategy, renderPlan: clip.videoRenderPlan }
      : null;
  return compileClipExecutionLayer({
    clip,
    compiledSnapshot: {
      compiledVideoDirection: compiled.compiledVideoDirection,
      compiledAudioDirection: compiled.compiledAudioDirection,
      compiledCreativeIntent: compiled.compiledCreativeIntent,
      compiledPromptBundle: compiled.compiledPromptBundle,
    },
    audioDesignBundle: audioDesign.bundle,
    tts,
    urls,
    policySource: compiled.policySource,
    postAudioRender,
    videoDirection,
  });
}
