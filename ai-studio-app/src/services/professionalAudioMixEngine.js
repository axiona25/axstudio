/**
 * AXSTUDIO H7 — Professional Audio Mix Engine (base reale, Web Audio / offline).
 * Ducking follower su voce, stem balance, fade intro/outro sui bed, peak safety e loudness conservativa.
 * Non mastering broadcast: niente LUFS ITU misurato, niente true-peak inter-sample.
 */

import { CLIP_TYPE } from "./scenografieVideoWorkflow.js";

export const PROFESSIONAL_MIX_ENGINE_VERSION = 1;

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

function linearToDb(x) {
  return 20 * Math.log10(Math.max(x, 1e-12));
}

function cloneAudioBuffer(src) {
  if (!src) return null;
  const ctx = new AudioContext({ sampleRate: src.sampleRate });
  const dst = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  ctx.close?.();
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    dst.getChannelData(ch).set(src.getChannelData(ch));
  }
  return dst;
}

/**
 * Fade in/out sui bed (non sulla voce).
 */
function applyStemFades(buffer, sampleRate, introMs, outroMs) {
  if (!buffer) return null;
  const b = cloneAudioBuffer(buffer);
  const intro = Math.max(0, Math.floor((introMs / 1000) * sampleRate));
  const outro = Math.max(0, Math.floor((outroMs / 1000) * sampleRate));
  const len = b.length;
  for (let ch = 0; ch < b.numberOfChannels; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      let g = 1;
      if (intro > 0 && i < intro) g *= i / intro;
      if (outro > 0 && i > len - 1 - outro) g *= (len - 1 - i) / Math.max(1, outro);
      d[i] *= g;
    }
  }
  return b;
}

/**
 * @param {object} args
 * @param {object} args.clip
 * @param {object|null} args.compiledAudioMixIntent
 * @param {object|null} args.compiledAudioDesignBundle
 * @param {object|null} args.mixExecutionPlan
 * @param {number} args.clipDurationSec
 * @param {{ music: boolean, ambient: boolean, sfx: boolean }} args.stemPresence
 */
export function buildProfessionalMixStrategy(args) {
  const c = args?.clip && typeof args.clip === "object" ? args.clip : {};
  const bundle = args?.compiledAudioDesignBundle && typeof args.compiledAudioDesignBundle === "object" ? args.compiledAudioDesignBundle : {};
  const mix =
    args?.compiledAudioMixIntent && typeof args.compiledAudioMixIntent === "object"
      ? args.compiledAudioMixIntent
      : bundle.compiledAudioMixIntent && typeof bundle.compiledAudioMixIntent === "object"
        ? bundle.compiledAudioMixIntent
        : {};
  const plan = args?.mixExecutionPlan && typeof args.mixExecutionPlan === "object" ? args.mixExecutionPlan : {};
  const stem = args?.stemPresence && typeof args.stemPresence === "object" ? args.stemPresence : {};
  const isDialogue = c.clipType === CLIP_TYPE.DIALOGUE;
  const musicUnder = mix.musicUnderVoice !== false;
  const level = String(bundle.compiledMusicPlan?.intensityLevel || "medium");
  let musicBedLevelDb = -20;
  if (level === "high") musicBedLevelDb = -17;
  if (level === "low") musicBedLevelDb = -24;
  const ambPresence = String(bundle.compiledAmbientPlan?.backgroundPresence || "");
  let ambientBedLevelDb = -22;
  if (/molto_discreta/i.test(ambPresence)) ambientBedLevelDb = -27;
  if (/più_avanti/i.test(ambPresence)) ambientBedLevelDb = -19;
  let sfxBedLevelDb = -26;
  if (bundle.compiledSfxPlan?.subtlety === "moderata") sfxBedLevelDb = -22;

  const hasBeds = !!(stem.music || stem.ambient || stem.sfx);
  const autoDuck = musicUnder && hasBeds && (stem.music || stem.ambient);
  const duckingAmountDb = isDialogue ? 9 : 6.5;
  const duckingAmbientExtraDb = isDialogue ? 3.5 : 2;

  const cleanupActions = [
    "Applicare fade intro/outro su musica, ambiente e SFX.",
    "Bilanciare gain statico da compiledAudioMixIntent + intensità wizard.",
    "Ducking dinamico follower mono su |voce| → riduzione musica e (più) ambiente sotto parlato.",
    "Somma stereo, peak scan, rescale verso tetto, soft-clip tanh leggero.",
    "RMS check post-limitatore per loudness conservativa (non LUFS).",
  ];

  const limitations = [
    "Nessuna misura LUFS BS.1770-4: solo RMS e peak campione.",
    "Ducking monobanda su envelope; niente sidechain EQ/multibanda.",
    "Niente true-peak; export 16-bit PCM come nel MVP.",
    "Preset spatial / mastering avanzato lasciati a struttura futura (mix presets, dialogue-aware v2).",
  ];

  const rationale = [
    isDialogue
      ? "Clip dialogata: priorità intelligibilità — ambiente più deferente, ducking più profondo."
      : "Clip narrata: letto musicale più sostenibile con ducking moderato sotto narrazione.",
    `Piano esecutivo mix (H2): voicePriority=${mix.voicePriority || "primaria"}; futures stems: ${(plan.futureExecutableStems || []).join(", ") || "n/a"}.`,
    "Obiettivo: mix più cinematografico del semplice gain statico MVP, senza dipendenze esterne.",
  ].join(" ");

  return {
    version: PROFESSIONAL_MIX_ENGINE_VERSION,
    dialoguePriority: isDialogue ? "maximize_intelligibility" : "balanced",
    narratorPriority: isDialogue ? "support_cast" : "feature_narration",
    musicBedLevel: musicBedLevelDb,
    ambientBedLevel: ambientBedLevelDb,
    sfxBedLevel: sfxBedLevelDb,
    sfxPriority: stem.sfx ? "spot_accent_under_voice" : "off",
    autoDuckingEnabled: autoDuck,
    duckingAmountDb,
    duckingAmbientExtraDb,
    duckingAttackMs: 15,
    duckingReleaseMs: 320,
    introFadeMs: 400,
    outroFadeMs: 550,
    targetLoudnessMode: isDialogue ? "dialogue_first_conservative" : "narration_warm_center",
    peakSafetyLimiterEnabled: true,
    cleanupActions,
    limitations,
    rationale,
  };
}

/**
 * @param {object} strategy
 * @param {object} ctx
 * @param {number} ctx.sampleRate
 * @param {number} ctx.lengthSamples
 */
export function buildProfessionalMixRenderPlan(strategy, ctx) {
  const s = strategy && typeof strategy === "object" ? strategy : {};
  const sr = typeof ctx?.sampleRate === "number" ? ctx.sampleRate : 48000;
  const len = typeof ctx?.lengthSamples === "number" ? ctx.lengthSamples : 0;

  const orderedStemStack = [
    { id: "music_bed", role: "music", order: 1, active: !!ctx?.stemPresence?.music },
    { id: "ambient_bed", role: "ambient", order: 2, active: !!ctx?.stemPresence?.ambient },
    { id: "sfx_spot", role: "sfx", order: 3, active: !!ctx?.stemPresence?.sfx },
    { id: "dialogue_voice", role: "voice", order: 4, active: true },
  ];

  const gainPlan = {
    voiceLinear: 1,
    musicBaseLinear: dbToLinear(typeof s.musicBedLevel === "number" ? s.musicBedLevel : -20),
    ambientBaseLinear: dbToLinear(typeof s.ambientBedLevel === "number" ? s.ambientBedLevel : -22),
    sfxBaseLinear: dbToLinear(typeof s.sfxBedLevel === "number" ? s.sfxBedLevel : -26),
    notes: "Gain statico in dBFS relativo; voce a 0 dB di riferimento interno.",
  };

  const duckingPlan = {
    enabled: !!s.autoDuckingEnabled,
    followerSource: "voice_mono_abs",
    music: {
      maxReductionDb: typeof s.duckingAmountDb === "number" ? s.duckingAmountDb : 6,
      curve: "presence_env_over_k",
      k: 0.11,
    },
    ambient: {
      maxReductionDb:
        (typeof s.duckingAmountDb === "number" ? s.duckingAmountDb : 6) +
        (typeof s.duckingAmbientExtraDb === "number" ? s.duckingAmbientExtraDb : 2),
      curve: "presence_env_over_k",
      k: 0.11,
    },
    sfx: { maxReductionDb: 2, curve: "light_under_voice" },
    attackMs: s.duckingAttackMs ?? 15,
    releaseMs: s.duckingReleaseMs ?? 320,
  };

  const fadePlan = {
    introFadeMs: s.introFadeMs ?? 400,
    outroFadeMs: s.outroFadeMs ?? 550,
    stemsAffected: ["music", "ambient", "sfx"],
    voiceUntouched: true,
  };

  const dynamicsPlan = {
    voiceTreatment: "unity_pass_through",
    bedsTreatment: "static_gain_plus_voice_follower_duck",
    future: ["multiband_sidechain", "dialogue_isolation_aware"],
  };

  const loudnessPlan = {
    mode: s.targetLoudnessMode || "dialogue_first_conservative",
    targetRmsLinearHint: 0.085,
    postNormalizePeakDbfs: -1.2,
    notes: "Aggiustamento RMS leggero solo se sotto hint e picco consente; non LUFS.",
  };

  const peakSafetyPlan = {
    enabled: s.peakSafetyLimiterEnabled !== false,
    ceilingLinear: 0.97,
    softClip: { type: "tanh", drive: 1.85 },
    preClipPeakScan: true,
  };

  const exportPlan = {
    format: "wav_pcm_s16le_stereo",
    interleave: "LR",
    namingHint: "sceno_{clipId}_mix_pro.wav",
  };

  return {
    version: PROFESSIONAL_MIX_ENGINE_VERSION,
    builtAt: new Date().toISOString(),
    sampleRate: sr,
    lengthSamples: len,
    orderedStemStack,
    gainPlan,
    duckingPlan,
    fadePlan,
    dynamicsPlan,
    loudnessPlan,
    peakSafetyPlan,
    exportPlan,
    fallbackMode: "mvp_static_gain_sum",
    notes:
      "Stack ordinato: bed sotto voce nel dominio campioni; voce sommata ultima per priorità percettiva. Estensioni: preset formato, spatial.",
  };
}

/**
 * @param {object} p
 * @param {AudioBuffer} p.voiceBuffer
 * @param {AudioBuffer|null} p.musicBuffer
 * @param {AudioBuffer|null} p.ambientBuffer
 * @param {AudioBuffer|null} p.sfxBuffer
 * @param {object} p.renderPlan — da buildProfessionalMixRenderPlan
 * @param {object} p.strategy — da buildProfessionalMixStrategy
 */
export function executeProfessionalMixOffline(p) {
  const voice = p.voiceBuffer;
  const plan = p.renderPlan && typeof p.renderPlan === "object" ? p.renderPlan : {};
  const strategy = p.strategy && typeof p.strategy === "object" ? p.strategy : {};
  const duck = plan.duckingPlan && typeof plan.duckingPlan === "object" ? plan.duckingPlan : {};
  const gain = plan.gainPlan && typeof plan.gainPlan === "object" ? plan.gainPlan : {};
  const peakPlan = plan.peakSafetyPlan && typeof plan.peakSafetyPlan === "object" ? plan.peakSafetyPlan : {};
  const loud = plan.loudnessPlan && typeof plan.loudnessPlan === "object" ? plan.loudnessPlan : {};

  if (!voice || voice.numberOfChannels < 1) {
    throw new Error("Professional mix: voiceBuffer mancante.");
  }

  const sr = voice.sampleRate;
  const len = voice.length;
  const fade = plan.fadePlan || {};

  const musicF = applyStemFades(p.musicBuffer, sr, fade.introFadeMs ?? 400, fade.outroFadeMs ?? 550);
  const ambF = applyStemFades(p.ambientBuffer, sr, fade.introFadeMs ?? 400, fade.outroFadeMs ?? 550);
  const sfxF = applyStemFades(p.sfxBuffer, sr, fade.introFadeMs ?? 400, fade.outroFadeMs ?? 550);

  const getLR = (buf, i) => {
    if (!buf) return { l: 0, r: 0 };
    const l = buf.getChannelData(0)[i] || 0;
    const r = buf.numberOfChannels > 1 ? buf.getChannelData(1)[i] || 0 : l;
    return { l, r };
  };

  const v0 = voice.getChannelData(0);
  const v1 = voice.numberOfChannels > 1 ? voice.getChannelData(1) : v0;

  const tauA = Math.max(1e-4, (duck.attackMs ?? 15) / 1000);
  const tauR = Math.max(1e-4, (duck.releaseMs ?? 320) / 1000);
  const ca = 1 - Math.exp(-1 / (tauA * sr));
  const cr = 1 - Math.exp(-1 / (tauR * sr));

  let env = 0;
  const outL = new Float32Array(len);
  const outR = new Float32Array(len);

  const baseM = gain.musicBaseLinear ?? dbToLinear(-20);
  const baseA = gain.ambientBaseLinear ?? dbToLinear(-22);
  const baseS = gain.sfxBaseLinear ?? dbToLinear(-26);

  const k = duck.music?.k ?? 0.11;
  const maxDm = duck.music?.maxReductionDb ?? 6;
  const maxDa = duck.ambient?.maxReductionDb ?? 8;
  const maxDs = duck.sfx?.maxReductionDb ?? 2;
  const duckOn = duck.enabled !== false;

  let peakBefore = 0;
  let sumSq = 0;

  for (let i = 0; i < len; i++) {
    const inp = 0.5 * (Math.abs(v0[i]) + Math.abs(v1[i]));
    if (inp > env) env += (inp - env) * ca;
    else env += (inp - env) * cr;

    const presence = duckOn ? env / (k + env) : 0;
    const duckDbM = duckOn && musicF ? maxDm * presence : 0;
    const duckDbA = duckOn && ambF ? maxDa * presence : 0;
    const duckDbS = duckOn && sfxF ? maxDs * presence : 0;

    const gM = baseM * dbToLinear(-duckDbM);
    const gA = baseA * dbToLinear(-duckDbA);
    const gS = baseS * dbToLinear(-duckDbS);

    const m = getLR(musicF, i);
    const a = getLR(ambF, i);
    const s = getLR(sfxF, i);

    let oL = v0[i] + m.l * gM + a.l * gA + s.l * gS;
    let oR = v1[i] + m.r * gM + a.r * gA + s.r * gS;

    const pk = Math.max(Math.abs(oL), Math.abs(oR));
    if (pk > peakBefore) peakBefore = pk;

    outL[i] = oL;
    outR[i] = oR;
    sumSq += 0.5 * (oL * oL + oR * oR);
  }

  const rms = Math.sqrt(sumSq / Math.max(1, len * 2));
  const ceiling = typeof peakPlan.ceilingLinear === "number" ? peakPlan.ceilingLinear : 0.97;
  let peakAfterScale = peakBefore;
  let scale = 1;
  if (peakPlan.preClipPeakScan !== false && peakBefore > ceiling) {
    scale = ceiling / peakBefore;
    for (let i = 0; i < len; i++) {
      outL[i] *= scale;
      outR[i] *= scale;
    }
    peakAfterScale = peakBefore * scale;
  }

  const targetRms = typeof loud.targetRmsLinearHint === "number" ? loud.targetRmsLinearHint : 0.085;
  let rmsBoost = 1;
  if (rms > 1e-8 && rms < targetRms * 0.92 && peakAfterScale * (targetRms / rms) <= ceiling * 0.98) {
    rmsBoost = Math.min(targetRms / rms, (ceiling * 0.98) / peakAfterScale);
    if (rmsBoost > 1.02) {
      for (let i = 0; i < len; i++) {
        outL[i] *= rmsBoost;
        outR[i] *= rmsBoost;
      }
      peakAfterScale *= rmsBoost;
    }
  }

  const drive = peakPlan.softClip?.drive ?? 1.85;
  const softClipFn = (x) => Math.tanh(x * drive) / Math.tanh(drive);

  let peakFinal = 0;
  let sumSq2 = 0;
  if (peakPlan.softClip && peakPlan.softClip.type === "tanh") {
    for (let i = 0; i < len; i++) {
      outL[i] = softClipFn(outL[i]);
      outR[i] = softClipFn(outR[i]);
      peakFinal = Math.max(peakFinal, Math.abs(outL[i]), Math.abs(outR[i]));
      sumSq2 += 0.5 * (outL[i] * outL[i] + outR[i] * outR[i]);
    }
  } else {
    for (let i = 0; i < len; i++) {
      peakFinal = Math.max(peakFinal, Math.abs(outL[i]), Math.abs(outR[i]));
      sumSq2 += 0.5 * (outL[i] * outL[i] + outR[i] * outR[i]);
    }
  }

  const rmsFinal = Math.sqrt(sumSq2 / Math.max(1, len * 2));

  const ctx = new AudioContext({ sampleRate: sr });
  const outBuf = ctx.createBuffer(2, len, sr);
  ctx.close?.();
  outBuf.getChannelData(0).set(outL);
  outBuf.getChannelData(1).set(outR);

  const constraintReport = {
    version: PROFESSIONAL_MIX_ENGINE_VERSION,
    limitations: strategy.limitations || [],
    peakBefore,
    peakAfterLinear: peakFinal,
    peakReductionDb: peakBefore > 0 ? linearToDb(peakFinal / peakBefore) : 0,
    rmsFinal,
    rmsBoostApplied: rmsBoost > 1.02,
    duckingEnabled: duckOn,
  };

  const metrics = {
    sampleRate: sr,
    frames: len,
    peakBeforeLimiter: peakBefore,
    peakAfterProcessing: peakFinal,
    rmsBeforeSoftClip: rms * (scale * (rmsBoost > 1.02 ? rmsBoost : 1)),
    rmsFinal,
    headroomScale: scale,
    rmsBoost,
    ducking: {
      attackMs: duck.attackMs,
      releaseMs: duck.releaseMs,
      maxMusicDb: maxDm,
      maxAmbientDb: maxDa,
    },
  };

  return {
    ok: true,
    buffer: outBuf,
    metrics,
    constraintReport,
    executionPath: "professional_offline_v1",
  };
}
