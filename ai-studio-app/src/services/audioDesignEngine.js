/**
 * Audio Design Engine MVP (AXSTUDIO Scenografie).
 * Traduce compiled audio + wizard in piani strutturati (musica, ambiente, SFX, mix).
 * La pipeline oggi produce solo lo stem voce (TTS); musica/ambiente/SFX restano pianificati + stub per mix futuro.
 */

import {
  CLIP_MUSIC_MOOD,
  CLIP_AMBIENT_PRESET,
  CLIP_ENERGY_LEVEL,
} from "./scenografieVideoWorkflow.js";

const ENGINE_VERSION = 1;

function presetLabel(list, id) {
  const x = (list || []).find((o) => o.id === id);
  return x?.label || (id ? String(id) : "");
}

function trim(v) {
  return v != null ? String(v).trim() : "";
}

/**
 * Fallback legacy quando mancano compiled (coerente con directorEngine).
 * @param {object} clip
 */
function deriveAudioDirectionFromClip(clip) {
  const c = clip && typeof clip === "object" ? clip : {};
  const musicLabel = presetLabel(CLIP_MUSIC_MOOD, c.clipMusicMood) || "—";
  const ambientLabel = presetLabel(CLIP_AMBIENT_PRESET, c.clipAmbientSoundPreset) || "—";
  const energyLabel = presetLabel(CLIP_ENERGY_LEVEL, c.clipEnergyLevel) || "—";
  return {
    narrationTone: trim(c.narratorDeliveryTone) || trim(c.dialogueDeliveryTone) || "—",
    narrationPace: trim(c.narratorPace) || "—",
    musicMood: musicLabel,
    ambientPreset: ambientLabel,
    effectsEnabled: c.effectsEnabled === true,
    energyLevel: energyLabel,
    audioGoal: trim(c.clipAudioDirection) || `Musica: ${musicLabel}; ambiente: ${ambientLabel}; energia: ${energyLabel}.`,
    audioPromptResolved: trim(c.clipAudioDirectionPrompt) || "",
  };
}

function deriveCreativeFromClip(clip) {
  const c = clip && typeof clip === "object" ? clip : {};
  return {
    narrativeGoal: trim(c.clipNarrativeGoal) || "—",
    whatMustBeSeen: trim(c.clipVisualActionSummary) || "—",
    whatMustBeFelt: trim(c.clipEmotionalTone || c.mood) || "—",
    whatMustBeHeard: "—",
    priorityFocus: trim(c.clipDirectionSummary) || "—",
  };
}

function musicIntensityFromEnergy(energyId, energyLabel) {
  const id = trim(energyId).toLowerCase();
  if (id === "very_calm" || id === "sweet") return { level: "low", label: "Contenuta" };
  if (id === "intense") return { level: "high", label: "Marcata" };
  if (energyLabel && /intenso/i.test(energyLabel)) return { level: "high", label: "Marcata" };
  return { level: "medium", label: "Media" };
}

function ambientTexture(presetId, presetLabelStr) {
  const id = trim(presetId);
  const map = {
    none: "Silenzio di ambiente (solo voce e musica se attiva).",
    village: "Tessitura calda, presenza umana lontana, vita del borgo.",
    wind: "Movimento d’aria continuo, spazio aperto.",
    footsteps: "Ritmo di passi, vicinanza corporea.",
    woodshop: "Legno, attrezzi, lavorazione morbida in fondo.",
    nature: "Paesaggio naturale, lieve e stabile.",
    indoor_home: "Interno domestico, stanza vissuta.",
  };
  return map[id] || `Ambiente «${presetLabelStr}»: letto continuo non invadente.`;
}

function ambientPresenceFromEnergy(energyId) {
  const id = trim(energyId).toLowerCase();
  if (id === "very_calm") return "molto_discreta";
  if (id === "sweet" || id === "medium") return "presente_ma_sotto_voce";
  if (id === "intense") return "più_avanti_nel_mix";
  return "bilanciata";
}

function sfxCategory(compiledCreative, effectsOn) {
  if (!effectsOn) return "nessuno";
  const felt = trim(compiledCreative?.whatMustBeFelt).toLowerCase();
  if (/tens|dram|conflitto/i.test(felt)) return "tensione_lieve";
  if (/dolce|intim|calm/i.test(felt)) return "dettagli_morbidi";
  return "supporto_narrativo";
}

function sfxTimingHint(compiledCreative) {
  const goal = trim(compiledCreative?.narrativeGoal);
  if (goal && goal !== "—") return "Accenti sui punti chiari dell’obiettivo narrativo; niente clutter.";
  return "Pochi eventi, sulle transizioni emotive o di scena.";
}

/**
 * @param {object} args
 * @param {object} args.clip
 * @param {object|null} [args.compiledAudioDirection]
 * @param {object|null} [args.compiledCreativeIntent]
 * @param {string} [args.clipAudioDirectionPrompt]
 * @param {string} [args.clipCreativeBriefFinal]
 * @returns {object}
 */
export function compileAudioDesignBundle(args) {
  const {
    clip,
    compiledAudioDirection = null,
    compiledCreativeIntent = null,
    clipAudioDirectionPrompt = "",
    clipCreativeBriefFinal = "",
  } = args || {};

  const c = clip && typeof clip === "object" ? clip : {};
  const audio =
    compiledAudioDirection && typeof compiledAudioDirection === "object"
      ? compiledAudioDirection
      : deriveAudioDirectionFromClip(c);
  const creative =
    compiledCreativeIntent && typeof compiledCreativeIntent === "object"
      ? compiledCreativeIntent
      : deriveCreativeFromClip(c);

  const source =
    compiledAudioDirection && typeof compiledAudioDirection === "object" ? "compiled-primary" : "legacy-fallback";

  const musicMoodLabel = trim(audio.musicMood) || presetLabel(CLIP_MUSIC_MOOD, c.clipMusicMood) || "Nessuna";
  const musicEnabled = musicMoodLabel !== "Nessuna" && !/^nessuna/i.test(musicMoodLabel);
  const ambientLabel = trim(audio.ambientPreset) || presetLabel(CLIP_AMBIENT_PRESET, c.clipAmbientSoundPreset) || "Nessuno";
  const ambientEnabled = ambientLabel !== "Nessuno" && !/^nessuno/i.test(ambientLabel);
  const effectsOn = audio.effectsEnabled === true;
  const energyLabel = trim(audio.energyLevel) || presetLabel(CLIP_ENERGY_LEVEL, c.clipEnergyLevel) || "—";
  const energyId = trim(c.clipEnergyLevel) || "medium";
  const intensity = musicIntensityFromEnergy(energyId, energyLabel);

  const moodId = trim(c.clipMusicMood) || "none";
  const ambId = trim(c.clipAmbientSoundPreset) || "none";

  const compiledMusicPlan = {
    enabled: musicEnabled,
    mood: musicMoodLabel,
    intensity: intensity.label,
    intensityLevel: intensity.level,
    suggestedStyle: musicEnabled
      ? `Colonna ${musicMoodLabel.toLowerCase()}, dinamica ${intensity.label.toLowerCase()}, senza competere con il parlato.`
      : "Nessuna musica di sottofondo richiesta.",
    suggestedUsage: musicEnabled
      ? "Bed music sotto la voce (−18…−24 LUFS relativo alla voce, da calibrare al mix); ingresso morbido, niente ostinati dominanti in media."
      : "Solo voce (e ambiente se attivo).",
  };

  const compiledAmbientPlan = {
    enabled: ambientEnabled,
    preset: ambientLabel,
    texture: ambientTexture(ambId, ambientLabel),
    backgroundPresence: ambientPresenceFromEnergy(energyId),
  };

  const compiledSfxPlan = {
    enabled: effectsOn,
    effectCategory: sfxCategory(creative, effectsOn),
    timingHint: effectsOn ? sfxTimingHint(creative) : "Nessun effetto richiesto.",
    subtlety: effectsOn ? (intensity.level === "high" ? "moderata" : "alta") : "n/a",
  };

  const compiledAudioMixIntent = {
    voicePriority: "primaria",
    musicUnderVoice: musicEnabled,
    ambientBed: ambientEnabled ? "continuo_basso" : "assente",
    soundEnergy: energyLabel,
    emotionalArc: trim(creative.whatMustBeFelt) || trim(creative.narrativeGoal) || trim(audio.audioGoal) || "—",
  };

  const musicAssetKey = moodId !== "none" ? `axstudio_music_mood_${moodId}` : null;
  const ambientAssetKey = ambId !== "none" ? `axstudio_ambient_${ambId}` : null;

  return {
    engineVersion: ENGINE_VERSION,
    compiledAt: new Date().toISOString(),
    source,
    clipRef: c.id != null ? { id: String(c.id) } : null,
    compiledMusicPlan,
    compiledAmbientPlan,
    compiledSfxPlan,
    compiledAudioMixIntent,
    briefReference: {
      clipAudioDirectionPrompt: trim(clipAudioDirectionPrompt) || trim(audio.audioPromptResolved),
      clipCreativeBriefFinal: trim(clipCreativeBriefFinal),
    },
    executionSurface: {
      voiceStemFromElevenLabs: true,
      musicStemRendered: false,
      ambientStemRendered: false,
      sfxStemRendered: false,
      note:
        "Pre-render: il bundle descrive il piano. Dopo `audioRenderEngine`+`professionalAudioMixEngine` la clip può avere stem reali (H6 musica provider o synth fallback, H4 pad ambiente/SFX MVP) e mix stereo (H7) — vedi `voiceStem`/`musicStem`/… sul clip.",
    },
    placeholderMixLayout: {
      tracks: [
        { role: "dialogue_voice", order: 1, pipelineStatus: "produced", source: "elevenlabs_tts" },
        {
          role: "music_bed",
          order: 2,
          pipelineStatus: musicEnabled ? "planned" : "off",
          source: "local_or_licensed_library",
          assetKey: musicAssetKey,
        },
        {
          role: "ambient_bed",
          order: 3,
          pipelineStatus: ambientEnabled ? "planned" : "off",
          source: "local_or_licensed_library",
          assetKey: ambientAssetKey,
        },
        {
          role: "sfx_spot",
          order: 4,
          pipelineStatus: effectsOn ? "planned" : "off",
          source: "designed_spots",
        },
      ],
    },
  };
}

/**
 * @param {object|null} a
 * @param {object|null} b
 */
export function audioDesignBundleContentEqual(a, b) {
  if (!a || !b) return a === b;
  try {
    const strip = (x) => {
      const o = { ...x };
      delete o.compiledAt;
      return o;
    };
    return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
  } catch {
    return false;
  }
}

export function isPersistedAudioDesignBundleUsable(clip) {
  const b = clip?.compiledAudioDesignBundle;
  if (!b || typeof b !== "object") return false;
  if (b.clipRef?.id != null && String(b.clipRef.id) !== String(clip.id)) return false;
  return !!(
    b.compiledMusicPlan &&
    b.compiledAmbientPlan &&
    b.compiledSfxPlan &&
    b.compiledAudioMixIntent &&
    typeof b.compiledMusicPlan === "object"
  );
}

/**
 * Per pipeline: bundle persistito se valido, altrimenti compile al volo.
 * @param {object} clip
 * @param {object} compiledSnapshot — da resolveCompiledSnapshotForPipeline
 * @param {{ clipAudioDirectionPrompt: string, clipCreativeBriefFinal: string }} briefs
 */
export function resolveAudioDesignForPipeline(clip, compiledSnapshot, briefs) {
  const br = briefs && typeof briefs === "object" ? briefs : {};
  if (isPersistedAudioDesignBundleUsable(clip)) {
    return {
      policySource: "persisted-audio-design",
      bundle: clip.compiledAudioDesignBundle,
    };
  }
  const bundle = compileAudioDesignBundle({
    clip,
    compiledAudioDirection: compiledSnapshot?.compiledAudioDirection,
    compiledCreativeIntent: compiledSnapshot?.compiledCreativeIntent,
    clipAudioDirectionPrompt: br.clipAudioDirectionPrompt || "",
    clipCreativeBriefFinal: br.clipCreativeBriefFinal || "",
  });
  return { policySource: "runtime-audio-design", bundle };
}
