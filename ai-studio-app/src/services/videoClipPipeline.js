/**
 * Pipeline clip Scenografie: Audio (ElevenLabs + H6 musica provider o fallback + H4 pad ambiente/SFX MVP + H7 mix) →
 * fal storage → video: **Avatar** Kling v2 Pro (immagine+traccia mix) **oppure** **Cinematic** O3 reference-to-video
 * (prompt+frame, generate_audio=false) → mux ffmpeg traccia mix su MP4 → upload. Dialogo **H8**: TTS multi-voice per battuta → WAV unico.
 */

import {
  CLIP_TYPE,
  normalizeDialogLine,
  normalizeCharacterVoiceMaster,
  SCENE_VIDEO_CLIP_STATUS,
  buildClipStructuredPrompts,
  resolveClipDurationSeconds,
} from "./scenografieVideoWorkflow.js";
import {
  resolveElevenLabsVoiceId,
  elevenLabsTextToSpeechMp3,
  measureAudioBlobDurationSeconds,
  getElevenLabsApiKey,
} from "./elevenlabsService.js";
import {
  buildDialogueExecutionStrategy,
  buildDialogueVoiceCastingPlan,
  buildDialogueRenderPlan,
  buildDialogueTimingPlan,
  executeDialogueMultiVoiceRender,
  buildDialogueConstraintReport,
  buildSpeakerVoiceMap,
} from "./dialogueExecutionEngine.js";
import { generateKlingAvatarV2Pro, KLING_AVATAR_V2_PRO_ENDPOINT } from "./klingAvatarService.js";
import {
  buildScenografieCinematicPrompt,
  generateKlingO3ReferenceToVideo,
  pickKlingO3DurationSec,
  KLING_O3_REFERENCE_TO_VIDEO_ENDPOINT,
} from "./scenografieCinematicKlingO3.js";
import { muxVideoUrlWithAudioUrlToMp4Blob } from "./montageFfmpegWasm.js";
import { imageUrlToBase64, uploadToFalStorage, uploadBlobToFalStorage } from "./imagePipeline.js";
import { sanitizeClipPipelineErrorForUser } from "./scenografieClipUserMessages.js";
import {
  buildClipPipelineFailureRecord,
  logConsumerReliabilityEvent,
} from "./scenografieConsumerReliability.js";
import { planCharacterDisplayName, voiceMasterRawForRef } from "./scenografiePcidLookup.js";
import { resolveCompiledSnapshotForPipeline, PIPELINE_PROVIDER_COVERAGE } from "./scenografiePipelineCompiledPolicy.js";
import { compileClipExecutionLayer, buildMixExecutionPlan } from "./executionPromptCompiler.js";
import { resolveAudioDesignForPipeline } from "./audioDesignEngine.js";
import { runClipAudioRenderMvp } from "./audioRenderEngine.js";
import { getSceneClipPipelineImageUrl, logClipSceneSource } from "./scenografieSceneVariants.js";
import {
  computeVideoExecutionStrategy,
  buildVideoRenderPlan,
  finalizeAvatarVideoAssembly,
  finalizeCinematicVideoAssembly,
  markVideoAssemblyFailure,
} from "./videoDirectionEngine.js";
import { buildVideoConstraintReport } from "./videoConstraintReport.js";
import { buildDialogueDirectionPlan, dialogueDirectionSummaryForVideoStrategy } from "./dialogueDirectionEngine.js";
import { resolveNarratedClipNarrator } from "./scenografieProjectNarrators.js";

function charName(plan, characterId) {
  return planCharacterDisplayName(plan, characterId);
}

/**
 * Testo unico per TTS dialogato V1: «Nome: battuta» per ogni riga.
 * Estensione futura: segmenti multi-voce per personaggio.
 */
export function buildDialogueTtsText(clip, plan) {
  const lines = (Array.isArray(clip.dialogLines) ? clip.dialogLines : []).map(normalizeDialogLine).filter(Boolean);
  return lines
    .map((line) => {
      const name = charName(plan, line.characterId);
      return `${name}: ${String(line.text || "").trim()}`;
    })
    .join("\n\n");
}

/**
 * Risolve voice ID ElevenLabs per flussi che richiedono un solo voiceId (legacy/validazione).
 * La pipeline dialogo principale usa H8 multi-voice (`executeDialogueMultiVoiceRender`).
 * @returns {{ voiceId: string|null, errors: string[] }}
 */
export function resolveDialogueSingleVoiceId(clip, characterVoiceMasters, plan) {
  const errors = [];
  const lines = (Array.isArray(clip.dialogLines) ? clip.dialogLines : []).map(normalizeDialogLine).filter(Boolean);
  const resolved = [];
  for (const line of lines) {
    const master = normalizeCharacterVoiceMaster(
      voiceMasterRawForRef(characterVoiceMasters, line.characterId, plan),
      line.characterId,
    );
    if (!String(master.voiceId || "").trim()) {
      errors.push(`Voice master mancante per «${charName(plan, line.characterId)}».`);
      continue;
    }
    const { voiceId, error } = resolveElevenLabsVoiceId(master.voiceId);
    if (!voiceId) errors.push(`«${charName(plan, line.characterId)}»: ${error || "Voce non valida."}`);
    else resolved.push(voiceId);
  }
  const uniq = [...new Set(resolved)];
  if (uniq.length > 1) {
    errors.push(
      "V1: tutti i parlanti devono avere la stessa voce ElevenLabs (stesso voice ID nelle voice master). Il multi-speaker reale sarà supportato in seguito."
    );
  }
  return { voiceId: uniq[0] || null, errors };
}

/**
 * @param {object} clip
 * @param {object[]} sceneResults
 * @returns {{ row: object }}
 */
export function assertSceneApprovedWithImage(clip, sceneResults) {
  const row = (sceneResults || []).find((r) => r.sceneId === clip.sceneId);
  if (!row) throw new Error("Scena non trovata nei risultati generati.");
  const sceneImageUrl = getSceneClipPipelineImageUrl(row);
  if (!sceneImageUrl) throw new Error("Immagine scena non trovata per questo clip.");
  if (row.approved !== true) throw new Error("La scena sorgente deve essere approvata prima di generare il video.");
  logClipSceneSource(clip, row, sceneImageUrl);
  return { row, sceneImageUrl };
}

async function ensureImageUrlOnFal(imageUrl) {
  const u = String(imageUrl || "").trim();
  if (!u) throw new Error("URL immagine scena vuoto.");
  if (/fal\.media|fal\.cdn/i.test(u)) return u;
  const b64 = await imageUrlToBase64(u);
  return uploadToFalStorage(b64);
}

/**
 * @param {object} opts
 * @param {object} opts.clip
 * @param {object|null} opts.plan
 * @param {object[]} opts.sceneResults
 * @param {Record<string, object>} opts.characterVoiceMasters
 * @param {(partial: object) => void} opts.patchClip — merge sul clip (stato intermedio)
 * @param {(phase: string, detail?: string) => void} [opts.onProgress]
 */
export async function runScenografieClipVideoPipeline(opts) {
  const {
    clip,
    plan,
    sceneResults,
    characterVoiceMasters,
    patchClip,
    onProgress,
    projectMeta,
    chapterMeta,
    projectCharacterMasters = null,
    projectNarrators = null,
  } = opts;
  if (!clip?.id) throw new Error("Clip non valido.");

  if (!String(process.env.REACT_APP_FAL_API_KEY || "").trim()) {
    throw new Error("REACT_APP_FAL_API_KEY non configurata nel .env");
  }
  if (!getElevenLabsApiKey()) {
    throw new Error("REACT_APP_ELEVENLABS_API_KEY non configurata nel .env");
  }

  const { row, sceneImageUrl } = assertSceneApprovedWithImage(clip, sceneResults);
  const now = () => new Date().toISOString();

  let lastAudioFalUrl = clip.audioUrl || null;
  let lastAudioDuration = typeof clip.audioDurationSeconds === "number" ? clip.audioDurationSeconds : null;

  const fail = (errLike, extra = {}) => {
    const userMsg = sanitizeClipPipelineErrorForUser(errLike);
    const lastWorkflowFailure = buildClipPipelineFailureRecord(errLike, userMsg, extra);
    logConsumerReliabilityEvent("clip_pipeline_failed", {
      clipId: clip.id,
      sceneId: clip.sceneId,
      ...lastWorkflowFailure,
    });
    patchClip({
      status: SCENE_VIDEO_CLIP_STATUS.FAILED,
      generationStatus: "failed",
      lastGenerationError: userMsg,
      lastWorkflowFailure,
      clipPipelineLastFailedAt: now(),
      updatedAt: now(),
      ...extra,
    });
  };

  let videoStrategy = null;
  try {
    let videoRenderPlan = null;

    const compiled = resolveCompiledSnapshotForPipeline(clip, plan);
    videoStrategy = computeVideoExecutionStrategy({
      clip,
      plan,
      sceneRow: row,
      compiledVideoDirection: compiled.compiledVideoDirection,
      compiledCreativeIntent: compiled.compiledCreativeIntent,
      sceneImageUrl,
    });
    if (typeof console !== "undefined" && console.info) {
      console.info("[AXSTUDIO · video strategy]", videoStrategy);
      console.info("[AXSTUDIO · video executor selected]", {
        clipId: clip.id,
        sceneId: clip.sceneId,
        clipType: clip.clipType,
        strategyType: videoStrategy.strategyType,
        videoExecutorType: videoStrategy.videoExecutorType,
        videoExecutorProvider: videoStrategy.videoExecutorProvider,
        videoExecutorModel: videoStrategy.videoExecutorModel,
        executorDispatchMode: videoStrategy.executorDispatchMode,
      });
    }

    if (typeof console !== "undefined" && console.info) {
      console.info("[AXSTUDIO · pipeline · compiled input]", {
        clipId: clip.id,
        sceneId: clip.sceneId,
        clipType: clip.clipType,
        policySource: compiled.policySource,
        policyNote:
          compiled.policySource === "persisted-compiled"
            ? "Using Director Engine objects persisted on clip (primary)."
            : "No usable persisted compiled bundle — synthesized at runtime from legacy wizard fields via compileClipDirectorBundle (same engine as wizard).",
        compiledVideoDirection: compiled.compiledVideoDirection,
        compiledAudioDirection: compiled.compiledAudioDirection,
        compiledCreativeIntent: compiled.compiledCreativeIntent,
        compiledPromptBundle: compiled.compiledPromptBundle,
        providerCoverage: PIPELINE_PROVIDER_COVERAGE,
      });
    }

    const briefsForAudio = buildClipStructuredPrompts(clip, plan);
    const audioDesignResolved = resolveAudioDesignForPipeline(clip, compiled, briefsForAudio);
    if (typeof console !== "undefined" && console.info) {
      console.info("[AXSTUDIO · pipeline · audio design input]", {
        clipId: clip.id,
        policySource: audioDesignResolved.policySource,
        policyNote:
          audioDesignResolved.policySource === "persisted-audio-design"
            ? "Using compiledAudioDesignBundle persisted on clip (primary)."
            : "No persisted audio design bundle — compiled at runtime from compiled audio/creative + briefs (or legacy fallback inside engine).",
        directorCompiledAudioUsed: !!compiled.compiledAudioDirection,
        directorCompiledCreativeUsed: !!compiled.compiledCreativeIntent,
        clipAudioDirectionPromptLen: String(briefsForAudio.clipAudioDirectionPrompt || "").length,
        clipCreativeBriefFinalLen: String(briefsForAudio.clipCreativeBriefFinal || "").length,
      });
      const b = audioDesignResolved.bundle;
      console.info("[AXSTUDIO · pipeline · audio design plan]", {
        engineVersion: b?.engineVersion,
        source: b?.source,
        executedInThisPipelinePass: {
          voiceTtsMp3ToFal: true,
          musicStemFile: "h6_provider_fal_or_eleven_then_synth_fallback_if_enabled",
          ambientStemFile: "mvp_procedural_if_enabled_in_plan",
          sfxStemFile: "mvp_procedural_if_effects_on",
          finalMixedStereo: "web_audio_offline_if_any_bed",
        },
        audioDesignStructuralPlans: {
          compiledMusicPlan: b?.compiledMusicPlan,
          compiledAmbientPlan: b?.compiledAmbientPlan,
          compiledSfxPlan: b?.compiledSfxPlan,
          compiledAudioMixIntent: b?.compiledAudioMixIntent,
        },
        placeholderMixLayout: b?.placeholderMixLayout,
        executionSurface: b?.executionSurface,
        distinction:
          "H6/H4/H7: con bed attivi e render riuscito, audioRenderEngine + professional mix producono stem (musica provider o synth, pad ambiente/SFX MVP) e WAV mix su fal; altrimenti resta prevalenza voce (strategy voice_only_no_beds).",
      });
    }

    onProgress?.("audio", "ElevenLabs · sintesi voce…");
    patchClip({
      status: SCENE_VIDEO_CLIP_STATUS.GENERATING_AUDIO,
      generationStatus: "audio",
      lastGenerationError: null,
      providerVoice: "elevenlabs",
      providerVideo: "fal.ai",
      generationModel: videoStrategy.videoExecutorModel,
      updatedAt: now(),
    });

    let ttsText;
    let ttsVoiceId;
    let voiceAudioBlob;
    let audioFalUrl;
    let audioDur;

    let dialogueExecutionStrategy = null;
    let dialogueVoiceCastingPlan = null;
    let dialogueRenderPlan = null;
    let dialogueTimingPlan = null;
    let multiVoiceRenderResult = null;
    let speakerVoiceMapPersist = null;
    let dialogueConstraintReport = null;
    let dialogueStem = null;
    let dialogueFallbackUsed = false;
    let dialogueLineCount = 0;
    let dialogueDirectionPlan = null;

    const pcmCtx = projectCharacterMasters && typeof projectCharacterMasters === "object" ? projectCharacterMasters : null;

    const type = clip.clipType === CLIP_TYPE.DIALOGUE ? CLIP_TYPE.DIALOGUE : CLIP_TYPE.NARRATED;
    /** @type {ReturnType<typeof resolveNarratedClipNarrator>|null} */
    let narratedResolution = null;
    if (type === CLIP_TYPE.NARRATED) {
      ttsText = String(clip.narratorText || "").trim();
      narratedResolution = resolveNarratedClipNarrator(clip, projectNarrators);
      const nv = narratedResolution.narratorVoice;
      const { voiceId, error } = resolveElevenLabsVoiceId(nv?.voiceId);
      if (!voiceId) throw new Error(error || "Voce narratore non valida.");
      ttsVoiceId = voiceId;
      if (typeof console !== "undefined" && console.info) {
        console.info("[AXSTUDIO · narrated narrator resolution]", {
          clipId: clip.id,
          narratorResolutionMode: narratedResolution.narratorResolutionMode,
          resolvedNarratorId: narratedResolution.resolvedNarratorId,
        });
      }
      const mp3Blob = await elevenLabsTextToSpeechMp3({ text: ttsText, voiceId: ttsVoiceId });
      voiceAudioBlob = mp3Blob;
      audioDur = await measureAudioBlobDurationSeconds(mp3Blob);
      audioFalUrl = await uploadBlobToFalStorage(mp3Blob, `sceno_clip_${clip.id}.mp3`, "audio/mpeg");
    } else {
      const lines = (Array.isArray(clip.dialogLines) ? clip.dialogLines : []).map(normalizeDialogLine).filter(Boolean);
      dialogueLineCount = lines.length;
      dialogueExecutionStrategy = buildDialogueExecutionStrategy({
        clip,
        plan,
        compiledAudioDesignBundle: audioDesignResolved.bundle,
        clipDurationSec: resolveClipDurationSeconds(clip),
      });
      if (typeof console !== "undefined" && console.info) {
        console.info("[AXSTUDIO · dialogue strategy]", dialogueExecutionStrategy);
      }

      speakerVoiceMapPersist = buildSpeakerVoiceMap({
        clip,
        plan,
        lines,
        characterVoiceMasters: characterVoiceMasters || {},
        projectCharacterMasters: pcmCtx,
      });
      dialogueVoiceCastingPlan = buildDialogueVoiceCastingPlan(dialogueExecutionStrategy, {
        clip,
        plan,
        lines,
        characterVoiceMasters: characterVoiceMasters || {},
        projectCharacterMasters: pcmCtx,
      });
      if (typeof console !== "undefined" && console.info) {
        console.info("[AXSTUDIO · dialogue casting]", dialogueVoiceCastingPlan);
      }

      dialogueRenderPlan = buildDialogueRenderPlan(dialogueExecutionStrategy, lines, speakerVoiceMapPersist, {});
      if (typeof console !== "undefined" && console.info) {
        console.info("[AXSTUDIO · dialogue render plan]", dialogueRenderPlan);
      }

      dialogueConstraintReport = buildDialogueConstraintReport(dialogueExecutionStrategy, speakerVoiceMapPersist, lines);
      dialogueFallbackUsed = Object.values(speakerVoiceMapPersist).some((v) => v.fallbackUsed);

      onProgress?.("audio", "ElevenLabs · dialogo multi-voice (una battuta alla volta)…");
      const exec = await executeDialogueMultiVoiceRender({
        clip,
        plan,
        lines,
        speakerVoiceMap: speakerVoiceMapPersist,
        pauseMs: dialogueRenderPlan.pauseBetweenLinesMs,
      });
      multiVoiceRenderResult = exec.multiVoiceRenderResult;
      voiceAudioBlob = exec.wavBlob;
      audioDur = exec.finalDurationSec;
      audioFalUrl = await uploadBlobToFalStorage(
        exec.wavBlob,
        `sceno_clip_${clip.id}_dialogue.wav`,
        "audio/wav",
      );

      ttsText = buildDialogueTtsText(clip, plan);
      ttsVoiceId =
        lines.map((l) => speakerVoiceMapPersist[l.characterId]?.chosenVoiceId).find(Boolean) || "";

      const actualDurs = lines.map((l) => {
        const p = multiVoiceRenderResult.perLine.find((x) => x.lineId === l.id);
        return p?.ok && typeof p.durationSec === "number" ? p.durationSec : null;
      });
      dialogueTimingPlan = buildDialogueTimingPlan(
        lines,
        dialogueRenderPlan.pauseBetweenLinesMs,
        null,
        actualDurs,
      );

      dialogueStem = {
        role: "dialogue",
        url: audioFalUrl,
        sourceType: "elevenlabs_multi_turn",
        stemKind: "rendered",
        durationSec: audioDur,
        status: "ok",
        label: `Dialogo (${lines.length} battute)`,
        meta: {
          engine: "dialogueExecutionEngine",
          lineCount: lines.length,
        },
      };

      dialogueDirectionPlan = buildDialogueDirectionPlan({
        clip,
        plan,
        sceneRow: row,
        lines,
        speakerVoiceMap: speakerVoiceMapPersist,
        dialogueTimingPlan,
        multiVoiceRenderResult,
        compiledVideoDirection: compiled.compiledVideoDirection,
        compiledCreativeIntent: compiled.compiledCreativeIntent,
        videoExecutionStrategy: videoStrategy,
        projectCharacterMasters: pcmCtx,
        sceneType: row?.sceneType != null ? String(row.sceneType) : null,
      });
      if (typeof console !== "undefined" && console.info) {
        console.info("[AXSTUDIO · dialogue direction plan]", {
          dialogueSceneType: dialogueDirectionPlan.dialogueSceneType,
          speakerCount: dialogueDirectionPlan.speakerCount,
          presentSubjectIds: dialogueDirectionPlan.presentSubjectIds,
          dialogueFrameMode: dialogueDirectionPlan.dialogueFrameMode,
          multiSubjectPresenceMode: dialogueDirectionPlan.multiSubjectPresenceMode,
        });
        console.info("[AXSTUDIO · dialogue staging]", dialogueDirectionPlan.subjectStagingPlan);
        console.info("[AXSTUDIO · dialogue shot plan]", dialogueDirectionPlan.dialogueShotPlan);
        console.info("[AXSTUDIO · dialogue executor limitation]", {
          honesty: dialogueDirectionPlan.dialogueDirectionConstraintReport?.honestyLabels,
          summary: dialogueDirectionPlan.dialogueDirectionConstraintReport?.summary,
          multiSubjectPresenceSupport:
            dialogueDirectionPlan.dialogueDirectionConstraintReport?.multiSubjectPresenceSupport,
        });
      }
      videoStrategy.dialogueRegia = dialogueDirectionSummaryForVideoStrategy(dialogueDirectionPlan);
    }

    lastAudioFalUrl = audioFalUrl;
    lastAudioDuration = audioDur;

    if (typeof console !== "undefined" && console.info) {
      const preTts = compileClipExecutionLayer({
        clip,
        compiledSnapshot: {
          compiledVideoDirection: compiled.compiledVideoDirection,
          compiledAudioDirection: compiled.compiledAudioDirection,
          compiledCreativeIntent: compiled.compiledCreativeIntent,
          compiledPromptBundle: compiled.compiledPromptBundle,
        },
        audioDesignBundle: audioDesignResolved.bundle,
        tts: { text: ttsText, voiceId: ttsVoiceId },
        urls: { sceneImageUrlSource: sceneImageUrl },
        policySource: compiled.policySource,
      });
      console.info("[AXSTUDIO · execution · audio input]", preTts.audioExecutionInput);
      console.info("[AXSTUDIO · execution · mix plan]", preTts.mixExecutionPlan);
      console.info("[AXSTUDIO · execution · constraint report]", preTts.executionConstraintReport);
      console.info("[AXSTUDIO · execution · video input]", preTts.videoExecutionInput);
      console.info("[AXSTUDIO · execution · elevenlabs dispatch]", {
        enforceableOnly: preTts.audioExecutionInput.enforceableAudioParams,
        advisoryCount: Object.keys(preTts.audioExecutionInput.advisoryAudioParams || {}).length,
        providerCoverage: PIPELINE_PROVIDER_COVERAGE.elevenLabsTextToSpeech,
        dialogueMultiVoice: type === CLIP_TYPE.DIALOGUE,
      });
    }

    onProgress?.("audio", "AXSTUDIO · mix professionale (stem + ducking)…");
    const mixPlanForRender = buildMixExecutionPlan(audioDesignResolved.bundle, null);
    const audioMvp = await runClipAudioRenderMvp({
      clip,
      compiledAudioDesignBundle: audioDesignResolved.bundle,
      voiceMp3Url: audioFalUrl,
      voiceMp3Blob: voiceAudioBlob,
      voiceDurationSec: audioDur,
      clipId: clip.id,
      projectMeta: projectMeta && typeof projectMeta === "object" ? projectMeta : null,
      chapterMeta: chapterMeta && typeof chapterMeta === "object" ? chapterMeta : null,
      mixExecutionPlan: mixPlanForRender,
    });
    const klingAudioUrl = audioMvp.audioUrlForKling || audioFalUrl;
    const bundleForExecution = audioMvp.updatedAudioDesignBundle || audioDesignResolved.bundle;

    const voiceStemForClip =
      type === CLIP_TYPE.DIALOGUE
        ? {
            ...audioMvp.voiceStem,
            sourceType: "elevenlabs_dialogue_multi",
            meta: {
              ...(audioMvp.voiceStem.meta && typeof audioMvp.voiceStem.meta === "object" ? audioMvp.voiceStem.meta : {}),
              multiVoice: true,
              dialogueLineCount,
            },
          }
        : audioMvp.voiceStem;

    const dialoguePatch =
      type === CLIP_TYPE.DIALOGUE
        ? {
            dialogueExecutionStrategy,
            dialogueVoiceCastingPlan,
            dialogueRenderPlan,
            dialogueTimingPlan,
            multiVoiceRenderResult,
            speakerVoiceMap: speakerVoiceMapPersist,
            dialogueConstraintReport,
            dialogueStem,
            dialogueFallbackUsed,
            dialogueDirectionPlan,
            dialogueSceneType: dialogueDirectionPlan?.dialogueSceneType ?? null,
            dialogueShotPlan: dialogueDirectionPlan?.dialogueShotPlan ?? null,
            dialogueStagingPlan: dialogueDirectionPlan?.subjectStagingPlan ?? null,
            dialoguePresencePlan: dialogueDirectionPlan?.dialoguePresencePlan ?? null,
            dialogueDirectionConstraintReport: dialogueDirectionPlan?.dialogueDirectionConstraintReport ?? null,
          }
        : {
            dialogueExecutionStrategy: null,
            dialogueVoiceCastingPlan: null,
            dialogueRenderPlan: null,
            dialogueTimingPlan: null,
            multiVoiceRenderResult: null,
            speakerVoiceMap: null,
            dialogueConstraintReport: null,
            dialogueStem: null,
            dialogueFallbackUsed: false,
            dialogueDirectionPlan: null,
            dialogueSceneType: null,
            dialogueShotPlan: null,
            dialogueStagingPlan: null,
            dialoguePresencePlan: null,
            dialogueDirectionConstraintReport: null,
          };

    const narratorResolutionPatch =
      type === CLIP_TYPE.NARRATED && narratedResolution
        ? {
            resolvedNarratorId: narratedResolution.resolvedNarratorId ?? null,
            resolvedNarratorVoiceId: narratedResolution.resolvedNarratorVoiceId ?? null,
            narratorResolutionMode: narratedResolution.narratorResolutionMode ?? null,
          }
        : {};

    patchClip({
      audioUrl: klingAudioUrl,
      audioDurationSeconds: audioDur,
      providerVoice: "elevenlabs",
      voiceStem: voiceStemForClip,
      musicStem: audioMvp.musicStem,
      ambientStem: audioMvp.ambientStem,
      sfxStem: audioMvp.sfxStem,
      audioRenderResult: audioMvp.audioRenderResult,
      audioMixExecutionResult: audioMvp.audioMixExecutionResult,
      lastAudioRenderAt: audioMvp.audioRenderResult?.at ?? now(),
      compiledAudioDesignBundle: bundleForExecution,
      musicExecutionStrategy: audioMvp.musicExecutionStrategy ?? null,
      musicRenderPlan: audioMvp.musicRenderPlan ?? null,
      musicGenerationResult: audioMvp.musicGenerationResult ?? null,
      musicProvider: audioMvp.musicProvider ?? null,
      musicSourceType: audioMvp.musicSourceType ?? null,
      musicAssetUrl: audioMvp.musicAssetUrl ?? null,
      musicAssetDurationSec: audioMvp.musicAssetDurationSec ?? null,
      musicFallbackUsed: audioMvp.musicFallbackUsed === true,
      musicConstraintReport: audioMvp.musicConstraintReport ?? null,
      professionalMixStrategy: audioMvp.professionalMixStrategy ?? null,
      professionalMixRenderPlan: audioMvp.professionalMixRenderPlan ?? null,
      professionalMixResult: audioMvp.professionalMixResult ?? null,
      finalAudioMixUrl: audioMvp.finalAudioMixUrl ?? null,
      finalAudioMixMetrics: audioMvp.finalAudioMixMetrics ?? null,
      finalAudioMixConstraintReport: audioMvp.finalAudioMixConstraintReport ?? null,
      mixFallbackUsed: audioMvp.mixFallbackUsed === true,
      ...dialoguePatch,
      ...narratorResolutionPatch,
      updatedAt: now(),
    });

    onProgress?.(
      "video",
      videoStrategy.executorDispatchMode === "cinematic_i2v_provider"
        ? "fal.ai · Kling O3 reference-to-video (cinematic)…"
        : "fal.ai · Kling Avatar v2 Pro…",
    );
    patchClip({
      status: SCENE_VIDEO_CLIP_STATUS.GENERATING_VIDEO,
      generationStatus: "video",
      updatedAt: now(),
    });

    const imageFalUrl = await ensureImageUrlOnFal(sceneImageUrl);
    const cinematicPrompt =
      videoStrategy.executorDispatchMode === "cinematic_i2v_provider"
        ? buildScenografieCinematicPrompt(videoStrategy, compiled.compiledCreativeIntent)
        : "";
    const o3DurationSec = pickKlingO3DurationSec(audioDur);

    videoRenderPlan = buildVideoRenderPlan(
      videoStrategy,
      {
        sourceSceneImageUrl: sceneImageUrl,
        falImageUrl: imageFalUrl,
        falAudioUrl: klingAudioUrl,
        cinematicDurationSec: o3DurationSec,
        cinematicAspectRatio: "16:9",
      },
      {
        cinematicPrompt,
        compiledCreativeIntent: compiled.compiledCreativeIntent,
        dialogueDirectionPlan: dialogueDirectionPlan || clip.dialogueDirectionPlan || null,
      },
    );
    if (typeof console !== "undefined" && console.info) {
      console.info("[AXSTUDIO · video render plan]", videoRenderPlan);
      console.info("[AXSTUDIO · video provider dispatch · summary]", {
        strategyType: videoStrategy?.strategyType,
        videoExecutorType: videoStrategy?.videoExecutorType,
        executorDispatchMode: videoStrategy?.executorDispatchMode,
        providerChoice: videoStrategy?.providerChoice,
        renderApproach: videoStrategy?.renderApproach,
        requiresLipSync: videoStrategy?.requiresLipSync,
        canHonorCameraIntent: videoStrategy?.canHonorCameraIntent,
        payloadActuallySent: videoRenderPlan?.providerPayloadActuallySent,
        advisoryKeysKeptOffWire: videoRenderPlan?.providerPayloadDroppedFields?.length,
        rationale: videoStrategy?.rationale,
      });
    }

    let videoUrl;
    if (videoStrategy.executorDispatchMode === "cinematic_i2v_provider") {
      if (typeof console !== "undefined" && console.info) {
        console.info("[AXSTUDIO · cinematic provider dispatch]", {
          endpoint: KLING_O3_REFERENCE_TO_VIDEO_ENDPOINT,
          durationSec: o3DurationSec,
          promptChars: cinematicPrompt.length,
          muxAfterRender: true,
        });
      }
      let cinematicRemoteUrl = null;
      try {
        const o3Res = await generateKlingO3ReferenceToVideo({
          imageUrl: imageFalUrl,
          prompt: cinematicPrompt,
          durationSec: o3DurationSec,
          aspectRatio: "16:9",
          onProgress: (s) => onProgress?.("video", s),
        });
        cinematicRemoteUrl = o3Res.videoUrl;
      } catch (e) {
        const msg = e?.message || String(e);
        if (typeof console !== "undefined" && console.error) {
          console.error("[AXSTUDIO · cinematic provider failure]", {
            clipId: clip.id,
            sceneId: clip.sceneId,
            message: msg,
            endpoint: KLING_O3_REFERENCE_TO_VIDEO_ENDPOINT,
          });
        }
        markVideoAssemblyFailure(videoRenderPlan, { stage: "cinematic_o3_provider" });
        fail(
          { message: msg },
          {
            audioUrl: lastAudioFalUrl || clip.audioUrl,
            audioDurationSeconds: lastAudioDuration ?? clip.audioDurationSeconds,
            videoUrl: null,
            providerVoice: "elevenlabs",
            providerVideo: "fal.ai",
            generationModel: videoStrategy.videoExecutorModel,
            videoExecutionFailureStage: "cinematic_o3_provider",
            videoExecutionFailureReason: msg,
            videoExecutionFailureDetails: {
              name: e?.name,
              endpoint: KLING_O3_REFERENCE_TO_VIDEO_ENDPOINT,
            },
            videoMuxFailure: false,
            videoMuxFailureDetails: null,
            videoProviderOutputUrl: null,
            muxedFinalVideoUrl: null,
            videoRenderPlan: { ...videoRenderPlan },
            videoConstraintReport: buildVideoConstraintReport(
              videoStrategy,
              videoRenderPlan,
              dialogueDirectionPlan || clip.dialogueDirectionPlan || null,
            ),
          },
        );
        e.axstudioScenografieClipFailureHandled = true;
        throw e;
      }

      let muxedBlob;
      try {
        onProgress?.("video", "AXSTUDIO · mux audio + video (ffmpeg)…");
        muxedBlob = await muxVideoUrlWithAudioUrlToMp4Blob({
          videoUrl: cinematicRemoteUrl,
          audioUrl: klingAudioUrl,
          onProgress: (m) => onProgress?.("video", m),
        });
      } catch (e) {
        const msg = e?.message || String(e);
        if (typeof console !== "undefined" && console.error) {
          console.error("[AXSTUDIO · cinematic mux failure]", {
            clipId: clip.id,
            sceneId: clip.sceneId,
            message: msg,
            videoProviderOutputUrl: cinematicRemoteUrl?.slice?.(0, 96),
          });
        }
        markVideoAssemblyFailure(videoRenderPlan, { stage: "cinematic_mux" });
        videoRenderPlan.videoProviderOutputUrl = cinematicRemoteUrl;
        fail(
          { message: `Mux cinematic: ${msg}` },
          {
            audioUrl: lastAudioFalUrl || clip.audioUrl,
            audioDurationSeconds: lastAudioDuration ?? clip.audioDurationSeconds,
            videoUrl: null,
            providerVoice: "elevenlabs",
            providerVideo: "fal.ai",
            generationModel: videoStrategy.videoExecutorModel,
            videoExecutionFailureStage: "cinematic_mux",
            videoExecutionFailureReason: msg,
            videoExecutionFailureDetails: {
              name: e?.name,
              hadProviderVideoUrl: !!cinematicRemoteUrl,
            },
            videoMuxFailure: true,
            videoMuxFailureDetails: msg,
            videoProviderOutputUrl: cinematicRemoteUrl,
            muxedFinalVideoUrl: null,
            videoRenderPlan: { ...videoRenderPlan },
            videoConstraintReport: buildVideoConstraintReport(
              videoStrategy,
              videoRenderPlan,
              dialogueDirectionPlan || clip.dialogueDirectionPlan || null,
            ),
          },
        );
        e.axstudioScenografieClipFailureHandled = true;
        throw e;
      }

      try {
        videoUrl = await uploadBlobToFalStorage(
          muxedBlob,
          `sceno_clip_${clip.id}_cinematic_muxed.mp4`,
          "video/mp4",
        );
      } catch (e) {
        const msg = e?.message || String(e);
        if (typeof console !== "undefined" && console.error) {
          console.error("[AXSTUDIO · cinematic mux upload failure]", {
            clipId: clip.id,
            message: msg,
          });
        }
        markVideoAssemblyFailure(videoRenderPlan, { stage: "cinematic_muxed_upload" });
        videoRenderPlan.videoProviderOutputUrl = cinematicRemoteUrl;
        fail(
          { message: `Upload video muxato: ${msg}` },
          {
            audioUrl: lastAudioFalUrl || clip.audioUrl,
            audioDurationSeconds: lastAudioDuration ?? clip.audioDurationSeconds,
            videoUrl: null,
            providerVoice: "elevenlabs",
            providerVideo: "fal.ai",
            generationModel: videoStrategy.videoExecutorModel,
            videoExecutionFailureStage: "cinematic_muxed_upload",
            videoExecutionFailureReason: msg,
            videoExecutionFailureDetails: { name: e?.name },
            videoMuxFailure: true,
            videoMuxFailureDetails: msg,
            videoProviderOutputUrl: cinematicRemoteUrl,
            muxedFinalVideoUrl: null,
            videoRenderPlan: { ...videoRenderPlan },
            videoConstraintReport: buildVideoConstraintReport(
              videoStrategy,
              videoRenderPlan,
              dialogueDirectionPlan || clip.dialogueDirectionPlan || null,
            ),
          },
        );
        e.axstudioScenografieClipFailureHandled = true;
        throw e;
      }

      finalizeCinematicVideoAssembly(videoRenderPlan, {
        videoProviderOutputUrl: cinematicRemoteUrl,
        muxedFinalVideoUrl: videoUrl,
        audioMuxSourceUrl: klingAudioUrl,
        muxBlobBytes: muxedBlob.size,
      });
    } else {
      if (typeof console !== "undefined" && console.info) {
        console.info("[AXSTUDIO · avatar provider dispatch]", {
          endpoint: KLING_AVATAR_V2_PRO_ENDPOINT,
          lipSyncExpected: !!videoStrategy.requiresLipSync,
        });
      }
      const avatarRes = await generateKlingAvatarV2Pro({
        imageUrl: imageFalUrl,
        audioUrl: klingAudioUrl,
        onProgress: (s) => onProgress?.("video", s),
      });
      videoUrl = avatarRes.videoUrl;
      finalizeAvatarVideoAssembly(videoRenderPlan, { finalVideoUrl: videoUrl });
    }

    const clipForExecutionSnapshot =
      dialogueDirectionPlan && typeof dialogueDirectionPlan === "object"
        ? {
            ...clip,
            dialogueDirectionPlan,
            dialogueSceneType: dialogueDirectionPlan.dialogueSceneType ?? null,
            dialogueDirectionConstraintReport: dialogueDirectionPlan.dialogueDirectionConstraintReport ?? null,
          }
        : clip;
    const executionSnapshot = compileClipExecutionLayer({
      clip: clipForExecutionSnapshot,
      compiledSnapshot: {
        compiledVideoDirection: compiled.compiledVideoDirection,
        compiledAudioDirection: compiled.compiledAudioDirection,
        compiledCreativeIntent: compiled.compiledCreativeIntent,
        compiledPromptBundle: compiled.compiledPromptBundle,
      },
      audioDesignBundle: bundleForExecution,
      tts: { text: ttsText, voiceId: ttsVoiceId },
      urls: {
        sceneImageUrlSource: sceneImageUrl,
        sceneImageUrlForVideoProvider: imageFalUrl,
        audioUrlForVideoProvider: klingAudioUrl,
      },
      policySource: compiled.policySource,
      postAudioRender: audioMvp.postAudioRenderForMixPlan,
      videoDirection: videoStrategy && videoRenderPlan ? { strategy: videoStrategy, renderPlan: videoRenderPlan } : null,
    });
    videoRenderPlan.videoConstraintReport = executionSnapshot.videoConstraintReport;
    if (typeof console !== "undefined" && console.info) {
      console.info("[AXSTUDIO · execution · video input · post-assembly]", executionSnapshot.videoExecutionInput);
      if (videoStrategy.executorDispatchMode !== "cinematic_i2v_provider") {
        console.info("[AXSTUDIO · execution · kling avatar dispatch]", {
          enforceableOnly: executionSnapshot.videoExecutionInput.enforceableVideoParams,
          advisoryKeys: Object.keys(executionSnapshot.videoExecutionInput.advisoryVideoParams || {}),
          providerCoverage: PIPELINE_PROVIDER_COVERAGE.klingAvatarV2Pro,
        });
      }
    }

    const finalDur =
      typeof audioDur === "number" && Number.isFinite(audioDur) && audioDur > 0
        ? Math.round(audioDur * 10) / 10
        : clip.durationSeconds;

    patchClip({
      videoUrl,
      audioUrl: klingAudioUrl,
      audioDurationSeconds: audioDur,
      providerVideo: "fal.ai",
      providerVoice: "elevenlabs",
      generationModel: videoStrategy.videoExecutorModel,
      generationStatus: "complete",
      status: SCENE_VIDEO_CLIP_STATUS.READY_FOR_REVIEW,
      lastGenerationError: null,
      lastWorkflowFailure: null,
      clipPipelineLastSuccessAt: now(),
      videoExecutionFailureStage: null,
      videoExecutionFailureReason: null,
      videoExecutionFailureDetails: null,
      videoMuxFailure: false,
      videoMuxFailureDetails: null,
      videoProviderOutputUrl: videoRenderPlan.videoProviderOutputUrl ?? null,
      muxedFinalVideoUrl: videoRenderPlan.muxedFinalVideoUrl ?? videoUrl,
      videoConstraintReport: executionSnapshot.videoConstraintReport ?? null,
      durationSeconds: finalDur != null ? finalDur : clip.durationSeconds,
      durationMode: typeof audioDur === "number" && audioDur > 0 ? "auto" : clip.durationMode,
      voiceStem: voiceStemForClip,
      musicStem: audioMvp.musicStem,
      ambientStem: audioMvp.ambientStem,
      sfxStem: audioMvp.sfxStem,
      audioRenderResult: audioMvp.audioRenderResult,
      audioMixExecutionResult: audioMvp.audioMixExecutionResult,
      lastAudioRenderAt: audioMvp.audioRenderResult?.at ?? now(),
      compiledAudioDesignBundle: bundleForExecution,
      musicExecutionStrategy: audioMvp.musicExecutionStrategy ?? null,
      musicRenderPlan: audioMvp.musicRenderPlan ?? null,
      musicGenerationResult: audioMvp.musicGenerationResult ?? null,
      musicProvider: audioMvp.musicProvider ?? null,
      musicSourceType: audioMvp.musicSourceType ?? null,
      musicAssetUrl: audioMvp.musicAssetUrl ?? null,
      musicAssetDurationSec: audioMvp.musicAssetDurationSec ?? null,
      musicFallbackUsed: audioMvp.musicFallbackUsed === true,
      musicConstraintReport: audioMvp.musicConstraintReport ?? null,
      professionalMixStrategy: audioMvp.professionalMixStrategy ?? null,
      professionalMixRenderPlan: audioMvp.professionalMixRenderPlan ?? null,
      professionalMixResult: audioMvp.professionalMixResult ?? null,
      finalAudioMixUrl: audioMvp.finalAudioMixUrl ?? null,
      finalAudioMixMetrics: audioMvp.finalAudioMixMetrics ?? null,
      finalAudioMixConstraintReport: audioMvp.finalAudioMixConstraintReport ?? null,
      mixFallbackUsed: audioMvp.mixFallbackUsed === true,
      ...dialoguePatch,
      ...narratorResolutionPatch,
      videoExecutionStrategy: videoStrategy,
      videoRenderPlan,
      lastExecutionSnapshot: {
        ...executionSnapshot,
        assemblyPhase: "post_mux_complete",
        montageVideoUrl: videoUrl,
      },
      updatedAt: now(),
    });

    onProgress?.("done", "Clip video pronto.");
  } catch (e) {
    const raw = e?.message || String(e);
    if (e?.axstudioScenografieClipFailureHandled) {
      throw e;
    }
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[Scenografie clip pipeline]", raw);
    }
    const hadAudio = !!lastAudioFalUrl;
    fail({ message: raw }, {
      audioUrl: hadAudio ? lastAudioFalUrl : clip.audioUrl,
      audioDurationSeconds: lastAudioDuration ?? clip.audioDurationSeconds,
      videoUrl: null,
      providerVoice: "elevenlabs",
      providerVideo: "fal.ai",
      generationModel: videoStrategy?.videoExecutorModel || KLING_AVATAR_V2_PRO_ENDPOINT,
      videoExecutionFailureStage: "pipeline_uncaught",
      videoExecutionFailureReason: raw,
      videoExecutionFailureDetails: { name: e?.name },
      videoMuxFailure: false,
      videoMuxFailureDetails: null,
    });
    throw e;
  }
}
