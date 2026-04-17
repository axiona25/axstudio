/**
 * Director Engine — compila campi wizard Scenografie + brief testuali in istruzioni operative strutturate.
 * Intermedio tra wizard e pipeline (Kling / ElevenLabs non toccati qui).
 */

import {
  CLIP_TYPE,
  NARRATED_CAMERA_PRESETS,
  DIALOGUE_CAMERA_BEHAVIORS,
  CLIP_OPENING_STYLES,
  CLIP_CLOSING_STYLES,
  CLIP_CAMERA_INTENSITY,
  CLIP_FOCUS_SUBJECT,
  CLIP_MUSIC_MOOD,
  CLIP_AMBIENT_PRESET,
  CLIP_ENERGY_LEVEL,
  CLIP_NARRATOR_TONE,
  CLIP_NARRATOR_PACE,
  CLIP_NARRATOR_PAUSES,
  CLIP_DIALOGUE_TONE,
} from "./scenografieVideoWorkflow.js";

const ENGINE_VERSION = 1;

function presetLabel(list, id) {
  const x = (list || []).find((o) => o.id === id);
  return x?.label || (id ? String(id) : "");
}

function trimStr(v) {
  return v != null ? String(v).trim() : "";
}

function styleSlot(list, rawId) {
  const id = trimStr(rawId);
  const label = presetLabel(list, id) || "—";
  return { id: id || null, label };
}

/**
 * @param {object} ctx
 * @param {object|null} [ctx.project] — es. { id, title }
 * @param {object|null} [ctx.chapter] — es. { id, ordinal }
 * @param {object|null} [ctx.plan]
 * @param {object|null} [ctx.scene] — scena del piano (o null)
 * @param {object} ctx.clip
 * @param {string} [ctx.clipDirectionPromptFinal]
 * @param {string} [ctx.clipAudioDirectionPrompt]
 * @param {string} [ctx.clipCreativeBriefFinal]
 * @returns {{
 *   compiledVideoDirection: object,
 *   compiledAudioDirection: object,
 *   compiledCreativeIntent: object,
 *   compiledPromptBundle: object,
 * }}
 */
export function compileClipDirectorBundle(ctx) {
  const {
    project = null,
    chapter = null,
    plan: _plan = null,
    scene = null,
    clip,
    clipDirectionPromptFinal = "",
    clipAudioDirectionPrompt = "",
    clipCreativeBriefFinal = "",
  } = ctx || {};

  const c = clip && typeof clip === "object" ? clip : {};
  const type = c.clipType === CLIP_TYPE.DIALOGUE ? CLIP_TYPE.DIALOGUE : CLIP_TYPE.NARRATED;

  const sceneId = trimStr(c.sceneId) || null;
  const opening = styleSlot(CLIP_OPENING_STYLES, c.clipOpeningStyle);
  const closing = styleSlot(CLIP_CLOSING_STYLES, c.clipClosingStyle);

  const camLabelNarrated = presetLabel(NARRATED_CAMERA_PRESETS, c.clipCameraPreset) || trimStr(c.clipCameraPreset) || "—";
  const camLabelDialogue =
    presetLabel(DIALOGUE_CAMERA_BEHAVIORS, c.cameraDirection) || trimStr(c.cameraDirection) || "—";
  const cameraMotion = type === CLIP_TYPE.DIALOGUE ? camLabelDialogue : camLabelNarrated;

  const camIntLabel = presetLabel(CLIP_CAMERA_INTENSITY, c.clipCameraIntensity) || "—";
  const focusLabel = presetLabel(CLIP_FOCUS_SUBJECT, c.clipFocusSubject) || "—";

  const shotType =
    type === CLIP_TYPE.DIALOGUE
      ? `Dialogo · ${camLabelDialogue}`
      : `Narrato · ${focusLabel} · ${camLabelNarrated}`;

  const toneLine = trimStr(c.clipEmotionalTone || c.mood);
  const intLegacy = trimStr(c.emotionalIntensity) || "media";

  const visualGoal =
    trimStr(c.clipVisualActionSummary) ||
    (type === CLIP_TYPE.DIALOGUE ? trimStr(c.clipDialogActionSummary) : "") ||
    trimStr(c.clipNarrativeGoal) ||
    "—";

  const whatMustBeSeen = [
    trimStr(c.clipVisualActionSummary),
    trimStr(c.clipNarrativeGoal),
    type === CLIP_TYPE.DIALOGUE ? trimStr(c.clipDialogActionSummary) : null,
  ]
    .filter(Boolean)
    .join(" · ") || "—";

  const musicLabel = presetLabel(CLIP_MUSIC_MOOD, c.clipMusicMood) || "—";
  const ambientLabel = presetLabel(CLIP_AMBIENT_PRESET, c.clipAmbientSoundPreset) || "—";
  const energyLabel = presetLabel(CLIP_ENERGY_LEVEL, c.clipEnergyLevel) || "—";

  const narrTone = c.narratorDeliveryTone ? presetLabel(CLIP_NARRATOR_TONE, c.narratorDeliveryTone) || trimStr(c.narratorDeliveryTone) : "";
  const narrPace = c.narratorPace ? presetLabel(CLIP_NARRATOR_PACE, c.narratorPace) || trimStr(c.narratorPace) : "";
  const narrPause = c.narratorPauseStyle ? presetLabel(CLIP_NARRATOR_PAUSES, c.narratorPauseStyle) || trimStr(c.narratorPauseStyle) : "";
  const dialTone = c.dialogueDeliveryTone ? presetLabel(CLIP_DIALOGUE_TONE, c.dialogueDeliveryTone) || trimStr(c.dialogueDeliveryTone) : "";

  const narrationToneResolved = type === CLIP_TYPE.DIALOGUE ? dialTone || "—" : narrTone || "—";
  const narrationPaceResolved =
    type === CLIP_TYPE.DIALOGUE ? (narrPace ? `${narrPace} (voce)` : "Sincrono alle battute") : narrPace || narrPause || "—";

  const fxOn = c.effectsEnabled === true;
  const audioGoal = [
    trimStr(c.clipAudioDirection),
    `Colonna: ${musicLabel}; ambiente: ${ambientLabel}; energia: ${energyLabel}; effetti: ${fxOn ? "sì" : "no"}.`,
  ]
    .filter(Boolean)
    .join(" ")
    .trim() || `Mix coerente con tono ${toneLine || "neutro"}.`;

  const hearShort = [
    `Musica: ${musicLabel}`,
    `Ambiente: ${ambientLabel}`,
    fxOn ? "Effetti: sì" : "Effetti: no",
    `Energia: ${energyLabel}`,
  ].join(" · ");

  const priorityFocus =
    [focusLabel, trimStr(c.clipDirectionSummary) || trimStr(c.clipDirectionPrompt).slice(0, 160)].filter(Boolean).join(" · ") || "—";

  const whatMustBeFelt = [toneLine, intLegacy !== "media" ? `intensità dichiarata: ${intLegacy}` : null].filter(Boolean).join(" · ") || "—";

  const directionPromptResolved = trimStr(clipDirectionPromptFinal);
  const audioPromptResolved = trimStr(clipAudioDirectionPrompt);

  const compiledVideoDirection = {
    sceneId,
    shotType,
    openingStyle: opening,
    closingStyle: closing,
    cameraMotion,
    cameraIntensity: camIntLabel,
    focusSubject: focusLabel,
    visualGoal,
    emotionalTone: toneLine || "—",
    progressionNote: trimStr(c.clipProgressionNote) || "—",
    directionPromptResolved,
  };

  const compiledAudioDirection = {
    narrationTone: narrationToneResolved,
    narrationPace: narrationPaceResolved,
    musicMood: musicLabel,
    ambientPreset: ambientLabel,
    effectsEnabled: fxOn,
    energyLevel: energyLabel,
    audioGoal,
    audioPromptResolved,
  };

  const compiledCreativeIntent = {
    narrativeGoal: trimStr(c.clipNarrativeGoal) || "—",
    whatMustBeSeen,
    whatMustBeFelt,
    whatMustBeHeard: hearShort,
    priorityFocus,
  };

  const projectRef =
    project && typeof project === "object" && trimStr(project.id)
      ? { id: trimStr(project.id), title: trimStr(project.title) || null }
      : null;
  const chapterRef =
    chapter && typeof chapter === "object" && trimStr(chapter.id)
      ? { id: trimStr(chapter.id), ordinal: chapter.ordinal != null ? Number(chapter.ordinal) : null }
      : null;
  const sceneRef = scene && typeof scene === "object" && trimStr(scene.id) ? { id: trimStr(scene.id), title_it: trimStr(scene.title_it) || null } : null;
  const clipRef =
    c.id != null
      ? { id: String(c.id), title: trimStr(c.title || c.label) || null, clipType: type }
      : null;

  const prompts = {
    clipDirectionPromptFinal: directionPromptResolved,
    clipAudioDirectionPrompt: audioPromptResolved,
    clipCreativeBriefFinal: trimStr(clipCreativeBriefFinal),
  };

  const compiledPromptBundle = {
    engineVersion: ENGINE_VERSION,
    compiledAt: new Date().toISOString(),
    projectRef,
    chapterRef,
    sceneRef,
    clipRef,
    planId: trimStr(_plan?.id) || null,
    prompts,
    compiledVideoDirection,
    compiledAudioDirection,
    compiledCreativeIntent,
  };

  return {
    compiledVideoDirection,
    compiledAudioDirection,
    compiledCreativeIntent,
    compiledPromptBundle,
  };
}

/**
 * Confronto stabile per evitare patch loop (ignora compiledAt nel bundle).
 * @param {object|null} a
 * @param {object|null} b
 * @returns {boolean}
 */
export function directorCompiledPayloadEqual(a, b) {
  if (!a || !b) return a === b;
  try {
    const strip = (bundle) => {
      if (!bundle || typeof bundle !== "object") return bundle;
      const { compiledAt, ...rest } = bundle;
      return rest;
    };
    const sa = {
      v: a.compiledVideoDirection,
      au: a.compiledAudioDirection,
      cr: a.compiledCreativeIntent,
      bu: strip(a.compiledPromptBundle),
    };
    const sb = {
      v: b.compiledVideoDirection,
      au: b.compiledAudioDirection,
      cr: b.compiledCreativeIntent,
      bu: strip(b.compiledPromptBundle),
    };
    return JSON.stringify(sa) === JSON.stringify(sb);
  } catch {
    return false;
  }
}
