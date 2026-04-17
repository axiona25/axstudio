/**
 * AXSTUDIO H6 — Music Source Layer: da intent (compiledMusicPlan) a strategia e piano di render esecutivo.
 * Provider-agnostic; routing e limiti espliciti per FAL, ElevenLabs e fallback sintetico MVP.
 */

import { getElevenLabsApiKey } from "./elevenlabsService.js";

export const MUSIC_SOURCE_ENGINE_VERSION = 1;

export const FAL_STABLE_AUDIO_TEXT_TO_AUDIO = "fal-ai/stable-audio-25/text-to-audio";
export const ELEVENLABS_MUSIC_MODEL_ID = "music_v1";

const MOOD_STYLE_HINTS = {
  none: "",
  delicate: "minimal, soft piano and strings, intimate, slow tempo, no percussion",
  spiritual: "ethereal pads, choir-like textures, reverberant, contemplative",
  warm_family: "acoustic guitar, warm strings, gentle major tonality, hopeful",
  solemn: "slow orchestral, low brass hints, restrained dynamics",
  suspended: "sustained clusters, subtle tension, sparse harmony",
  melancholic: "minor key, cello or piano lead, restrained",
  warm: "soft jazz-tinged harmony, brushed textures, cozy",
  tense: "low pulse, dissonant undertones, rhythmic tension, no loud peaks",
  triumphant: "brass and percussion builds, heroic but not overpowering for dialogue bed",
  playful: "light pizzicato, bouncy rhythm, whimsical",
  epic: "wide orchestral bed, cinematic, controlled dynamics under dialogue",
};

function trim(v) {
  return v != null ? String(v).trim() : "";
}

function hasFalKey() {
  return !!trim(process.env.REACT_APP_FAL_API_KEY);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * @param {object} [projectMeta]
 * @param {object} [chapterMeta]
 */
function buildCreativeContextLine(projectMeta, chapterMeta) {
  const p = projectMeta && typeof projectMeta === "object" ? projectMeta : {};
  const ch = chapterMeta && typeof chapterMeta === "object" ? chapterMeta : {};
  const bits = [];
  const pt = trim(p.title || p.name || p.projectTitle);
  if (pt) bits.push(`progetto: ${pt}`);
  const ct = trim(ch.title || ch.chapterTitle || ch.name);
  if (ct) bits.push(`capitolo: ${ct}`);
  return bits.length ? bits.join(" · ") : "";
}

/**
 * @param {object} args
 * @param {object} args.clip
 * @param {object|null} args.compiledMusicPlan
 * @param {object|null} args.compiledAudioDesignBundle
 * @param {object|null} [args.projectMeta]
 * @param {object|null} [args.chapterMeta]
 * @param {number} args.clipDurationSec
 * @param {object|null} [args.providerConfig]
 * @returns {object} musicExecutionStrategy
 */
export function buildMusicExecutionStrategy(args) {
  const clip = args?.clip && typeof args.clip === "object" ? args.clip : {};
  const plan = args?.compiledMusicPlan && typeof args.compiledMusicPlan === "object" ? args.compiledMusicPlan : {};
  const bundle =
    args?.compiledAudioDesignBundle && typeof args.compiledAudioDesignBundle === "object"
      ? args.compiledAudioDesignBundle
      : {};
  const providerConfig = args?.providerConfig && typeof args.providerConfig === "object" ? args.providerConfig : {};
  const clipDurationSec =
    typeof args?.clipDurationSec === "number" && Number.isFinite(args.clipDurationSec) && args.clipDurationSec > 0
      ? args.clipDurationSec
      : 8;

  const moodId = trim(clip.clipMusicMood || "none").toLowerCase();
  const enabled = plan.enabled === true && moodId !== "none";
  const prefRaw = trim(
    clip.musicProviderPreference ||
      clip.axstudioMusicProvider ||
      providerConfig.preferredProvider ||
      process.env.REACT_APP_AXSTUDIO_MUSIC_PROVIDER ||
      "fal",
  ).toLowerCase();
  const preferEleven = prefRaw === "elevenlabs" || prefRaw === "11labs" || prefRaw === "eleven";

  const hasFal = hasFalKey();
  const hasEl = !!getElevenLabsApiKey();

  const moodLabel = trim(plan.mood) || moodId;
  const styleHint = MOOD_STYLE_HINTS[moodId] || MOOD_STYLE_HINTS.delicate;
  const intensity = trim(plan.intensityLevel || plan.intensity || "medium");
  const noGo =
    trim(clip.clipMusicNoGo || providerConfig.musicNoGo || "") ||
    (Array.isArray(providerConfig.musicNegativeStyles) ? providerConfig.musicNegativeStyles.join(", ") : "");

  const ctx = buildCreativeContextLine(args?.projectMeta, args?.chapterMeta);
  const brief =
    bundle.briefReference && typeof bundle.briefReference === "object"
      ? trim(bundle.briefReference.clipCreativeBriefFinal || "")
      : "";

  const promptParts = [
    `Background instrumental bed for spoken dialogue. Mood: ${moodLabel}.`,
    `Energy / mix role: ${intensity} — stay under voice, no lead vocals, no sudden loud transients.`,
    styleHint ? `Style: ${styleHint}.` : "",
    ctx ? `Context: ${ctx}.` : "",
    brief ? `Narrative hint (advisory): ${brief.slice(0, 280)}${brief.length > 280 ? "…" : ""}.` : "",
  ].filter(Boolean);

  const promptText = promptParts.join(" ");
  const negativePromptText = [
    noGo || "vocals, lyrics, recognizable samples, ear fatigue, harsh clipping",
    "solo instruments that compete with speech intelligibility in midrange",
  ]
    .filter(Boolean)
    .join(" · ");

  const limitations = [
    "FAL Stable Audio text-to-audio: nessun campo negative_prompt nello schema pubblico — gli elementi «no-go» restano advisory nel prompt positivo o nella rationale.",
    "ElevenLabs /v1/music: lunghezza richiesta in ms (3 min–10 min max API); oltre va segmentazione futura.",
    "Durata effettiva del file generato può differire leggermente: normalizzazione trim/pad al frame voce lato client.",
    "Libreria licenziata / cue pre-approvati / cataloghi interni non sono ancora collegati — struttura stem e persistencePlan li anticipa.",
  ];

  if (!enabled) {
    return {
      version: MUSIC_SOURCE_ENGINE_VERSION,
      strategyType: "off",
      providerChoice: "none",
      providerMode: "n/a",
      generationMode: "none",
      promptText: "",
      negativePromptText: "",
      targetDurationSec: clipDurationSec,
      loopable: false,
      stemRole: "music_bed",
      qualityTier: "n/a",
      fallbackChain: [],
      limitations: [...limitations, "Musica disattiva nel compiledMusicPlan o mood «none»."],
      rationale:
        "Nessuna strategia provider: piano musica disattivo. Nessun tentativo FAL/ElevenLabs; nessun stem musicale obbligatorio.",
      advisoryOnly: {
        genreInstrumentation: "Non applicabile — musica off.",
        noGoStyles: negativePromptText || null,
      },
    };
  }

  const primary = preferEleven && hasEl ? "elevenlabs" : hasFal ? "fal" : hasEl ? "elevenlabs" : "none";
  const secondary =
    primary === "elevenlabs" && hasFal ? "fal" : primary === "fal" && hasEl ? "elevenlabs" : primary === "none" ? null : null;

  const fallbackChain =
    primary === "fal"
      ? ["fal_stable_audio", hasEl ? "elevenlabs_compose" : null, "axstudio_procedural_synth"].filter(Boolean)
      : primary === "elevenlabs"
        ? ["elevenlabs_compose", hasFal ? "fal_stable_audio" : null, "axstudio_procedural_synth"].filter(Boolean)
        : ["axstudio_procedural_synth"];

  let providerChoice = "none";
  let providerMode = "n/a";
  let generationMode = "procedural_web_audio";
  let strategyType = "procedural_synth_fallback";
  let qualityTier = "mvp";

  if (primary === "fal") {
    providerChoice = "fal_stable_audio";
    providerMode = "text_to_audio";
    generationMode = "fal_queue_api";
    strategyType = "provider_text_to_music";
    qualityTier = "standard";
  } else if (primary === "elevenlabs") {
    providerChoice = "elevenlabs_compose";
    providerMode = "compose_music_binary";
    generationMode = "elevenlabs_rest_api";
    strategyType = "provider_text_to_music";
    qualityTier = "standard";
  } else {
    limitations.push("Nessuna chiave FAL o ElevenLabs disponibile: si usa solo synth MVP locale.");
  }

  const rationaleParts = [
    preferEleven
      ? "Preferenza esplicita ElevenLabs: si tenta prima /v1/music (compose) se la chiave è presente."
      : "Default AXSTUDIO: FAL Stable Audio 2.5 text-to-audio — durata fino a 190s, adatta a bed sotto voce senza orchestrare librerie locali.",
    primary === "fal"
      ? "FAL onora: prompt testuale, seconds_total nel range API. Non onora: negative prompt dedicato; no-go va incluso nel testo o accettato come advisory."
      : primary === "elevenlabs"
        ? "ElevenLabs onora: prompt, music_length_ms, force_instrumental per bed sotto parlato. Non onora: generi strumentali ultra-specifici oltre il modello; sezioni/composition_plan avanzato riservato a reuse futuro."
        : "Nessun provider remoto configurato: solo pad sinusoidale MVP coerente con mood wizard.",
    secondary
      ? `Fallback inter-provider: se il primario fallisce, si tenta ${secondary} prima del synth.`
      : "Nessun secondary provider disponibile: passaggio diretto a synth MVP in caso di errore.",
  ];

  return {
    version: MUSIC_SOURCE_ENGINE_VERSION,
    strategyType,
    providerChoice,
    providerMode,
    generationMode,
    promptText,
    negativePromptText,
    targetDurationSec: clipDurationSec,
    loopable: true,
    stemRole: "music_bed",
    qualityTier,
    fallbackChain,
    limitations,
    rationale: rationaleParts.join(" "),
    advisoryOnly: {
      genreInstrumentation: styleHint,
      noGoStyles: noGo || null,
      secondaryProvider: secondary,
    },
  };
}

/**
 * @param {object} strategy — output buildMusicExecutionStrategy
 * @param {object} opts
 * @param {string} opts.activeProvider — 'fal' | 'elevenlabs'
 * @param {number} opts.clipDurationSec
 */
export function buildMusicRenderPlan(strategy, opts) {
  const s = strategy && typeof strategy === "object" ? strategy : {};
  const active = trim(opts?.activeProvider || "fal").toLowerCase() === "elevenlabs" ? "elevenlabs" : "fal";
  const clipDurationSec =
    typeof opts?.clipDurationSec === "number" && Number.isFinite(opts.clipDurationSec) && opts.clipDurationSec > 0
      ? opts.clipDurationSec
      : typeof s.targetDurationSec === "number"
        ? s.targetDurationSec
        : 8;

  const droppedFields = [];
  let requestPayloadIntent = {};
  let chosenProvider = "none";
  let chosenModel = "";
  let providerEndpointKey = "";
  let requestPayloadActuallySent = {};

  if (active === "fal" && s.strategyType !== "off") {
    chosenProvider = "fal";
    chosenModel = "stable-audio-25";
    providerEndpointKey = FAL_STABLE_AUDIO_TEXT_TO_AUDIO;
    const seconds_total = Math.round(clamp(Math.ceil(clipDurationSec), 1, 190));
    requestPayloadIntent = {
      prompt: s.promptText,
      negative_prompt: s.negativePromptText,
      seconds_total,
      num_inference_steps: 8,
      guidance_scale: 1,
    };
    droppedFields.push("negative_prompt");
    requestPayloadActuallySent = {
      prompt: s.promptText,
      seconds_total,
      num_inference_steps: 8,
      guidance_scale: 1,
    };
  } else if (active === "elevenlabs" && s.strategyType !== "off") {
    chosenProvider = "elevenlabs";
    chosenModel = ELEVENLABS_MUSIC_MODEL_ID;
    providerEndpointKey = "POST /v1/music";
    const music_length_ms = Math.round(clamp(clipDurationSec * 1000, 3000, 600000));
    requestPayloadIntent = {
      prompt: s.promptText,
      music_length_ms,
      model_id: ELEVENLABS_MUSIC_MODEL_ID,
      force_instrumental: true,
      negative_global_styles: s.negativePromptText ? [s.negativePromptText] : [],
    };
    droppedFields.push("negative_global_styles");
    requestPayloadActuallySent = {
      prompt: s.promptText,
      music_length_ms,
      model_id: ELEVENLABS_MUSIC_MODEL_ID,
      force_instrumental: true,
    };
  }

  const normalizationNeeded = true;
  const loopPreparationNeeded = !!s.loopable;

  return {
    version: MUSIC_SOURCE_ENGINE_VERSION,
    builtAt: new Date().toISOString(),
    chosenProvider,
    chosenModel,
    providerEndpointKey,
    requestPayloadIntent,
    requestPayloadActuallySent,
    droppedFields,
    expectedOutputType: active === "elevenlabs" ? "audio/mpeg" : "audio/wav_url",
    expectedDurationSec: clipDurationSec,
    normalizationNeeded,
    loopPreparationNeeded,
    persistencePlan: {
      clipFields: [
        "musicExecutionStrategy",
        "musicRenderPlan",
        "musicGenerationResult",
        "musicProvider",
        "musicSourceType",
        "musicAssetUrl",
        "musicAssetDurationSec",
        "musicFallbackUsed",
        "musicConstraintReport",
      ],
      uploadGeneratedAssetToFal: true,
      reuseAssetLibraryKey: null,
      notes:
        "H6: URL pubblico su fal storage per Kling/mix; struttura pronta per asset library key e cataloghi interni.",
    },
  };
}
