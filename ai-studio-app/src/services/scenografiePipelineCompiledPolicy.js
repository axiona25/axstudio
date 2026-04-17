/**
 * Policy unica AXSTUDIO: precedenza Director Engine (compiled) vs campi legacy nella pipeline clip.
 *
 * REGOLA
 * ─────
 * 1) Se sul clip esiste un bundle compiled persistito valido (tre oggetti compiled + coerenza clipRef),
 *    la pipeline usa QUELLI come fonte primaria per logica, costruzione input intermedi e fallback testuale.
 * 2) Se manca o non è valido, la pipeline sintetizza al volo gli stessi oggetti con compileClipDirectorBundle
 *    + buildClipStructuredPrompts (stesso Director Engine del wizard) e usa quelli — con log esplicito di fallback.
 * 3) I campi legacy sul clip restano la base dei dati quando si sintetizza; quando il compiled è persistito,
 *    i testi operativi (es. directionPromptResolved, audioPromptResolved) vincono sui duplicati legacy per intent.
 *
 * ElevenLabs / Kling: solo i parametri realmente supportati dall’API vengono inviati; il resto è metadata
 * (vedi PIPELINE_PROVIDER_COVERAGE).
 */

import { buildClipStructuredPrompts } from "./scenografieVideoWorkflow.js";
import { compileClipDirectorBundle } from "./directorEngine.js";

export const PIPELINE_PROVIDER_COVERAGE = {
  elevenLabsTextToSpeech: {
    sentToApi: ["text", "voiceId"],
    metadataOnly: [
      "narrationTone",
      "narrationPace",
      "narratorPauseStyle (clip)",
      "audioGoal",
      "audioPromptResolved",
      "clipAudioDirection",
      "dialogueDeliveryTone",
      "musicMood",
      "ambientPreset",
      "effectsEnabled",
      "energyLevel",
      "clipExternalNarratorNote",
    ],
  },
  klingAvatarV2Pro: {
    sentToApi: ["imageUrl", "audioUrl"],
    metadataOnly: [
      "visualGoal",
      "shotType",
      "openingStyle",
      "closingStyle",
      "cameraMotion",
      "cameraIntensity",
      "focusSubject",
      "emotionalTone",
      "progressionNote",
      "directionPromptResolved",
      "sceneId",
    ],
  },
  /** Clip narrati / cinematic in Scenografie — regia veicolata nel prompt; nessun lip-sync lato provider. */
  klingO3ReferenceToVideo: {
    sentToApi: [
      "prompt",
      "start_image_url",
      "duration",
      "aspect_ratio",
      "cfg_scale",
      "character_orientation",
      "generate_audio",
      "negative_prompt",
    ],
    metadataOnly: [
      "shotType (solo se ripreso nel prompt)",
      "cameraMotion (solo se ripreso nel prompt)",
      "progressionNote (solo se ripreso nel prompt)",
      "sceneId",
    ],
  },
};

function sceneFromPlan(plan, sceneId) {
  const sid = sceneId != null ? String(sceneId).trim() : "";
  if (!sid) return null;
  return (plan?.scenes || []).find((s) => s?.id === sid) || null;
}

/**
 * @param {object|null} clip
 * @returns {boolean}
 */
export function isPersistedCompiledBundleUsable(clip) {
  if (!clip || typeof clip !== "object") return false;
  const v = clip.compiledVideoDirection;
  const a = clip.compiledAudioDirection;
  const c = clip.compiledCreativeIntent;
  if (!v || typeof v !== "object" || !a || typeof a !== "object" || !c || typeof c !== "object") return false;
  const b = clip.compiledPromptBundle;
  if (b?.clipRef?.id != null && String(b.clipRef.id) !== String(clip.id)) return false;
  return true;
}

/**
 * Risolve snapshot compiled per la pipeline: persistito o sintetizzato da legacy (stesso motore del wizard).
 * @param {object} clip
 * @param {object|null} plan
 * @returns {{
 *   policySource: 'persisted-compiled' | 'runtime-synthesized',
 *   compiledVideoDirection: object,
 *   compiledAudioDirection: object,
 *   compiledCreativeIntent: object,
 *   compiledPromptBundle: object,
 * }}
 */
export function resolveCompiledSnapshotForPipeline(clip, plan) {
  const scene = sceneFromPlan(plan, clip?.sceneId);
  const briefs = buildClipStructuredPrompts(clip, plan);
  const bundleRef = clip?.compiledPromptBundle && typeof clip.compiledPromptBundle === "object" ? clip.compiledPromptBundle : null;
  const project = bundleRef?.projectRef || null;
  const chapter = bundleRef?.chapterRef || null;

  const synthesized = compileClipDirectorBundle({
    project,
    chapter,
    plan,
    scene,
    clip,
    clipDirectionPromptFinal: briefs.clipDirectionPromptFinal,
    clipAudioDirectionPrompt: briefs.clipAudioDirectionPrompt,
    clipCreativeBriefFinal: briefs.clipCreativeBriefFinal,
  });

  if (isPersistedCompiledBundleUsable(clip)) {
    return {
      policySource: "persisted-compiled",
      compiledVideoDirection: clip.compiledVideoDirection,
      compiledAudioDirection: clip.compiledAudioDirection,
      compiledCreativeIntent: clip.compiledCreativeIntent,
      compiledPromptBundle: bundleRef || synthesized.compiledPromptBundle,
    };
  }

  return {
    policySource: "runtime-synthesized",
    compiledVideoDirection: synthesized.compiledVideoDirection,
    compiledAudioDirection: synthesized.compiledAudioDirection,
    compiledCreativeIntent: synthesized.compiledCreativeIntent,
    compiledPromptBundle: synthesized.compiledPromptBundle,
  };
}

/**
 * @param {object} compiledAudio — compiledAudioDirection
 * @param {object} clip
 * @param {string} voiceId
 * @param {string} plainText — testo effettivo inviato a ElevenLabs
 */
export function buildNarratedTtsExecutionInput(compiledAudio, clip, voiceId, plainText) {
  const a = compiledAudio && typeof compiledAudio === "object" ? compiledAudio : {};
  const c = clip && typeof clip === "object" ? clip : {};
  return {
    clipMode: "narrated",
    textSentToElevenLabs: plainText,
    voiceIdSentToElevenLabs: voiceId,
    directionMetadataConsumedButNotEnforceable: {
      narrationTone: a.narrationTone ?? null,
      narrationPace: a.narrationPace ?? null,
      audioGoal: a.audioGoal ?? null,
      audioPromptResolved: a.audioPromptResolved ?? null,
      clipAudioDirection: String(c.clipAudioDirection || "").trim() || null,
      narratorDeliveryTone: String(c.narratorDeliveryTone || "").trim() || null,
      narratorPace: String(c.narratorPace || "").trim() || null,
      narratorPauseStyle: String(c.narratorPauseStyle || "").trim() || null,
      clipExternalNarratorNote: String(c.clipExternalNarratorNote || "").trim() || null,
    },
  };
}

/**
 * @param {object} compiledAudio
 * @param {object} clip
 * @param {string} voiceId
 * @param {string} plainText
 */
export function buildDialogueTtsExecutionInput(compiledAudio, clip, voiceId, plainText) {
  const a = compiledAudio && typeof compiledAudio === "object" ? compiledAudio : {};
  const c = clip && typeof clip === "object" ? clip : {};
  return {
    clipMode: "dialogue",
    textSentToElevenLabs: plainText,
    voiceIdSentToElevenLabs: voiceId,
    directionMetadataConsumedButNotEnforceable: {
      dialogueDeliveryTone: String(c.dialogueDeliveryTone || "").trim() || null,
      narrationTone: a.narrationTone ?? null,
      narrationPace: a.narrationPace ?? null,
      audioGoal: a.audioGoal ?? null,
      audioPromptResolved: a.audioPromptResolved ?? null,
      clipAudioDirection: String(c.clipAudioDirection || "").trim() || null,
    },
  };
}

/**
 * Oggetto intermedio per regia compilata vs URL effettivi. In API: Avatar = image+audio; O3 cinematic = start_image+prompt (audio al mux).
 * @param {object} compiledVideo — compiledVideoDirection
 * @param {{ sceneImageUrl: string, audioUrl: string|null }} urls
 */
export function buildCompiledVideoExecutionInput(compiledVideo, { sceneImageUrl, audioUrl }) {
  const v = compiledVideo && typeof compiledVideo === "object" ? compiledVideo : {};
  return {
    sceneImageUrl,
    audioUrl,
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
}
