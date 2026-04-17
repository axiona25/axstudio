/**
 * AXSTUDIO H4 — Audio Render MVP reale: stem voce (ElevenLabs) + bed musica/ambiente procedurali
 * (Web Audio) + mix offline con priorità voce; upload fal per stem opzionali e mix finale per Kling.
 *
 * Musica/ambiente non sono libreria licenziata: sono pad sintetici coerenti con mood/preset wizard.
 * Percorso eseguibile oggi; sostituibile con asset library o provider generativi senza cambiare il contratto stem.
 */

import { uploadBlobToFalStorage } from "./imagePipeline.js";
import {
  buildMusicExecutionStrategy,
  buildMusicRenderPlan,
  MUSIC_SOURCE_ENGINE_VERSION,
} from "./musicSourceEngine.js";
import { generateMusicWithFal, generateMusicWithEleven } from "./musicProviderAdapters.js";
import { measureAudioBlobDurationSeconds, getElevenLabsApiKey } from "./elevenlabsService.js";
import {
  buildProfessionalMixStrategy,
  buildProfessionalMixRenderPlan,
  executeProfessionalMixOffline,
  PROFESSIONAL_MIX_ENGINE_VERSION,
} from "./professionalAudioMixEngine.js";

export const AUDIO_RENDER_ENGINE_VERSION = 1;

const STEM_STATUS = {
  OK: "ok",
  SKIPPED: "skipped",
  FAILED: "failed",
};

/** @param {unknown} s */
export function normalizeAudioStemRecord(s) {
  if (!s || typeof s !== "object") return null;
  return {
    role: s.role != null ? String(s.role) : "",
    url: s.url != null && String(s.url).trim() ? String(s.url).trim() : null,
    sourceType: s.sourceType != null ? String(s.sourceType) : "",
    stemKind: s.stemKind != null ? String(s.stemKind) : "",
    durationSec: typeof s.durationSec === "number" && Number.isFinite(s.durationSec) ? s.durationSec : null,
    status: s.status != null ? String(s.status) : "",
    label: s.label != null ? String(s.label) : "",
    meta: s.meta && typeof s.meta === "object" ? s.meta : null,
  };
}

/** Frequenze (Hz) per mood — pad somma sinusoidi molto bassa. */
const MUSIC_MOOD_FREQS = {
  none: [],
  delicate: [196, 246.94, 293.66],
  spiritual: [174.61, 220, 261.63],
  warm_family: [220, 277.18, 329.63],
  solemn: [164.81, 207.65, 246.94],
  suspended: [185, 233.08, 293.66],
  melancholic: [174.61, 220, 261.63],
  warm: [220, 277.18, 329.63],
  tense: [185, 233.08, 349.23],
  triumphant: [246.94, 311.13, 392],
  playful: [261.63, 329.63, 392],
  epic: [174.61, 220, 293.66],
};

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function fadeEnvelope(sampleIndex, totalSamples, fadeInSamples, fadeOutSamples) {
  const fi = fadeInSamples > 0 ? clamp01(sampleIndex / fadeInSamples) : 1;
  const fo = fadeOutSamples > 0 ? clamp01((totalSamples - sampleIndex) / fadeOutSamples) : 1;
  return fi * fo;
}

/**
 * @param {string} moodId
 * @param {number} durationSec
 * @param {number} sampleRate
 * @param {{ intensity: string }} [opts]
 * @returns {AudioBuffer}
 */
export function renderProceduralMusicBuffer(moodId, durationSec, sampleRate, opts = {}) {
  const id = String(moodId || "none").toLowerCase();
  const freqs = MUSIC_MOOD_FREQS[id] || MUSIC_MOOD_FREQS.delicate;
  const sr = sampleRate;
  const len = Math.max(1, Math.ceil(durationSec * sr));
  const intensity = String(opts.intensityLevel || "medium");
  const baseAmp = intensity === "high" ? 0.045 : intensity === "low" ? 0.022 : 0.032;
  const ctx = new AudioContext({ sampleRate: sr });
  const buf = ctx.createBuffer(2, len, sr);
  const fadeIn = Math.floor(0.12 * sr);
  const fadeOut = Math.floor(0.2 * sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    const pan = ch === 0 ? 0.92 : 1.08;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let s = 0;
      for (let k = 0; k < freqs.length; k++) {
        const f = freqs[k];
        const detune = 1 + 0.02 * Math.sin(t * 0.15 + k);
        s += Math.sin(2 * Math.PI * f * detune * t + k * 0.4) * (baseAmp / freqs.length);
      }
      const slow = 1 + 0.08 * Math.sin(t * 0.35);
      const env = fadeEnvelope(i, len, fadeIn, fadeOut);
      data[i] = s * slow * env * pan;
    }
  }
  ctx.close?.();
  return buf;
}

/**
 * Rumore colorato leggero per ambiente MVP.
 * @param {string} presetId
 * @param {number} durationSec
 * @param {number} sampleRate
 * @returns {AudioBuffer}
 */
export function renderProceduralAmbientBuffer(presetId, durationSec, sampleRate) {
  const id = String(presetId || "none").toLowerCase();
  const sr = sampleRate;
  const len = Math.max(1, Math.ceil(durationSec * sr));
  const ctx = new AudioContext({ sampleRate: sr });
  const buf = ctx.createBuffer(2, len, sr);
  let amp = 0.06;
  let hpBias = 0.15;
  if (id === "wind") {
    amp = 0.07;
    hpBias = 0.45;
  } else if (id === "village") {
    amp = 0.05;
    hpBias = 0.1;
  } else if (id === "woodshop") {
    amp = 0.055;
    hpBias = 0.05;
  } else if (id === "indoor_home") {
    amp = 0.04;
    hpBias = -0.05;
  } else if (id === "nature") {
    amp = 0.055;
    hpBias = 0.2;
  } else if (id === "footsteps") {
    amp = 0.035;
    hpBias = 0.25;
  }
  const fadeIn = Math.floor(0.15 * sr);
  const fadeOut = Math.floor(0.25 * sr);
  let lastL = 0;
  let lastR = 0;
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (ch === 0) {
        lastL = (lastL + white * 0.02) * 0.96;
      } else {
        lastR = (lastR + white * 0.02) * 0.96;
      }
      const brown = ch === 0 ? lastL : lastR;
      const colored = brown * (1 - hpBias) + white * hpBias;
      const env = fadeEnvelope(i, len, fadeIn, fadeOut);
      const rhythm = id === "footsteps" ? (Math.sin(i / (sr * 0.45)) > 0.92 ? 0.25 : 0) : 0;
      data[i] = (colored * amp + rhythm * 0.02) * env * (ch === 0 ? 0.95 : 1.05);
    }
  }
  ctx.close?.();
  return buf;
}

/** SFX MVP: due micro-impulsi di rumore filtrato. */
export function renderProceduralSfxBuffer(durationSec, sampleRate) {
  const sr = sampleRate;
  const len = Math.max(1, Math.ceil(durationSec * sr));
  const ctx = new AudioContext({ sampleRate: sr });
  const buf = ctx.createBuffer(2, len, sr);
  const hits = [Math.floor(sr * 0.25), Math.floor(sr * 0.9)];
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      let v = 0;
      for (const h of hits) {
        const d = i - h;
        if (d >= 0 && d < Math.floor(0.04 * sr)) {
          const t = d / sr;
          v += (Math.random() * 2 - 1) * 0.06 * Math.exp(-t * 80);
        }
      }
      data[i] = v * (ch === 0 ? 0.9 : 1.1);
    }
  }
  ctx.close?.();
  return buf;
}

function audioBufferToWavBlob(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = audioBuffer.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, "data");
  view.setUint32(40, dataLength, true);
  let offset = 44;
  const vol = 0.98;
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let s = audioBuffer.getChannelData(ch)[i] * vol;
      s = Math.max(-1, Math.min(1, s));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function decodeAudioBufferFromUrl(audioContext, url) {
  const u = String(url || "").trim();
  if (!u) throw new Error("URL audio vuoto per decode.");
  const ab = await (await fetch(u)).arrayBuffer();
  return audioContext.decodeAudioData(ab.slice(0));
}

/** Decodifica per leggere sampleRate/durata/campioni voce (allineamento bed al frame). */
async function sniffVoiceBufferMeta(voiceUrl) {
  const ac = new AudioContext();
  try {
    const buf = await decodeAudioBufferFromUrl(ac, voiceUrl);
    const sampleRate = buf.sampleRate;
    const lengthSamples = buf.length;
    const durationSec = Math.max(0.25, lengthSamples / sampleRate);
    return { sampleRate, durationSec, lengthSamples };
  } finally {
    await ac.close();
  }
}

/** Stessa cosa da Blob locale (evita secondo fetch/CORS su URL fal). */
async function sniffVoiceMp3Blob(mp3Blob) {
  const ac = new AudioContext();
  try {
    const ab = await mp3Blob.arrayBuffer();
    const buf = await ac.decodeAudioData(ab.slice(0));
    const sampleRate = buf.sampleRate;
    const lengthSamples = buf.length;
    const durationSec = Math.max(0.25, lengthSamples / sampleRate);
    return { sampleRate, durationSec, lengthSamples };
  } finally {
    await ac.close();
  }
}

function hasFalApiKeyForMusic() {
  return !!String(process.env.REACT_APP_FAL_API_KEY || "").trim();
}

/**
 * Rimappa il bed al sample rate / lunghezza della traccia voce per OfflineAudioContext mix.
 */
function fitMusicBufferToVoiceReference(voiceBuf, bedBuf) {
  const outSr = voiceBuf.sampleRate;
  const len = voiceBuf.length;
  const outCh = 2;
  const ctx = new AudioContext({ sampleRate: outSr });
  const out = ctx.createBuffer(outCh, len, outSr);
  ctx.close?.();
  const ratio = bedBuf.sampleRate / outSr;
  for (let ch = 0; ch < outCh; ch++) {
    const srcCh = Math.min(ch, bedBuf.numberOfChannels - 1);
    const src = bedBuf.getChannelData(srcCh);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const srcPos = i * ratio;
      const i0 = Math.floor(srcPos);
      const f = srcPos - i0;
      const s0 = src[Math.min(i0, src.length - 1)] || 0;
      const s1 = src[Math.min(i0 + 1, src.length - 1)] || 0;
      dst[i] = s0 * (1 - f) + s1 * f;
    }
  }
  return out;
}

async function loadVoiceBufferForBedFit(voiceMp3Url, voiceMp3Blob) {
  if (voiceMp3Blob) {
    const ac = new AudioContext();
    try {
      const ab = await voiceMp3Blob.arrayBuffer();
      return await ac.decodeAudioData(ab.slice(0));
    } finally {
      await ac.close();
    }
  }
  const ac = new AudioContext();
  try {
    return await decodeAudioBufferFromUrl(ac, voiceMp3Url);
  } finally {
    await ac.close();
  }
}

async function decodeProviderMusicUrlToBuffer(url) {
  const ac = new AudioContext();
  try {
    return await decodeAudioBufferFromUrl(ac, url);
  } finally {
    await ac.close();
  }
}

/**
 * Mix: voce a pieno; bed sotto; fade naturale sui bed tramite inviluppo già nei buffer.
 * @param {{ voiceUrl: string, musicBuffer: AudioBuffer|null, ambientBuffer: AudioBuffer|null, sfxBuffer: AudioBuffer|null, gains: { music: number, ambient: number, sfx: number } }} p
 */
export async function mixVoiceWithBedsOffline(p) {
  const { voiceUrl, musicBuffer, ambientBuffer, sfxBuffer, gains } = p;
  const ac = new AudioContext();
  let voiceBuf;
  try {
    voiceBuf = await decodeAudioBufferFromUrl(ac, voiceUrl);
  } finally {
    await ac.close();
  }
  const sr = voiceBuf.sampleRate;
  const len = voiceBuf.length;
  const offline = new OfflineAudioContext(2, len, sr);

  const gVoice = offline.createGain();
  gVoice.gain.value = 1;
  const srcV = offline.createBufferSource();
  srcV.buffer = voiceBuf;
  srcV.connect(gVoice);
  gVoice.connect(offline.destination);

  const mixIn = (buf, gainLinear) => {
    if (!buf || gainLinear <= 0) return;
    const g = offline.createGain();
    g.gain.value = gainLinear;
    const src = offline.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    g.connect(offline.destination);
    src.start(0);
  };

  mixIn(musicBuffer, gains.music);
  mixIn(ambientBuffer, gains.ambient);
  mixIn(sfxBuffer, gains.sfx);

  srcV.start(0);
  const rendered = await offline.startRendering();
  return rendered;
}

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

/**
 * @param {object} bundle compiledAudioDesignBundle
 */
function gainsFromBundle(bundle) {
  const b = bundle && typeof bundle === "object" ? bundle : {};
  const level = String(b.compiledMusicPlan?.intensityLevel || "medium");
  const ambPresence = String(b.compiledAmbientPlan?.backgroundPresence || "");
  let musicDb = -20;
  if (level === "high") musicDb = -16;
  if (level === "low") musicDb = -24;
  let ambDb = -22;
  if (/molto_discreta/i.test(ambPresence)) ambDb = -26;
  if (/più_avanti/i.test(ambPresence)) ambDb = -18;
  return {
    music: dbToLinear(musicDb),
    ambient: dbToLinear(ambDb),
    sfx: dbToLinear(-26),
  };
}

export function patchAudioDesignBundleAfterRender(bundle, flags) {
  const b = bundle && typeof bundle === "object" ? { ...bundle } : {};
  const pl = b.placeholderMixLayout && typeof b.placeholderMixLayout === "object" ? { ...b.placeholderMixLayout } : { tracks: [] };
  const tracks = Array.isArray(pl.tracks) ? pl.tracks.map((t) => ({ ...t })) : [];
  const setTrack = (role, patch) => {
    const i = tracks.findIndex((t) => t.role === role);
    if (i >= 0) tracks[i] = { ...tracks[i], ...patch };
  };
  if (flags.musicRendered) {
    const src =
      flags.musicProviderSource === "fal"
        ? "fal_stable_audio"
        : flags.musicProviderSource === "elevenlabs"
          ? "elevenlabs_music_compose"
          : "axstudio_procedural_mvp";
    setTrack("music_bed", { pipelineStatus: "produced", source: src });
  }
  if (flags.ambientRendered) {
    setTrack("ambient_bed", { pipelineStatus: "produced", source: "axstudio_procedural_mvp" });
  }
  if (flags.sfxRendered) {
    setTrack("sfx_spot", { pipelineStatus: "produced", source: "axstudio_procedural_mvp" });
  }
  return {
    ...b,
    executionSurface: {
      ...(b.executionSurface && typeof b.executionSurface === "object" ? b.executionSurface : {}),
      voiceStemFromElevenLabs: true,
      musicStemRendered: !!flags.musicRendered,
      ambientStemRendered: !!flags.ambientRendered,
      sfxStemRendered: !!flags.sfxRendered,
      note:
        "H6: musica bed = provider (FAL / ElevenLabs) quando possibile, normalizzata al frame voce; altrimenti synth MVP. Ambiente/SFX = MVP Web Audio. URL fal per mix/Kling.",
    },
    placeholderMixLayout: { ...pl, tracks },
  };
}

/**
 * @param {object} opts
 * @param {object} opts.clip
 * @param {object} opts.compiledAudioDesignBundle
 * @param {string} opts.voiceMp3Url
 * @param {Blob} [opts.voiceMp3Blob] — preferito per sampleRate senza rifetch
 * @param {number} opts.voiceDurationSec
 * @param {string} opts.clipId
 * @param {object|null} [opts.projectMeta]
 * @param {object|null} [opts.chapterMeta]
 * @param {object|null} [opts.musicProviderConfig]
 * @param {object|null} [opts.mixExecutionPlan]
 */
export async function runClipAudioRenderMvp(opts) {
  const {
    clip,
    compiledAudioDesignBundle,
    voiceMp3Url,
    voiceMp3Blob,
    voiceDurationSec,
    clipId,
    projectMeta = null,
    chapterMeta = null,
    musicProviderConfig = null,
    mixExecutionPlan = null,
  } = opts;
  const bundle = compiledAudioDesignBundle && typeof compiledAudioDesignBundle === "object" ? compiledAudioDesignBundle : {};
  const c = clip && typeof clip === "object" ? clip : {};
  const musicOn = !!bundle.compiledMusicPlan?.enabled;
  const ambOn = !!bundle.compiledAmbientPlan?.enabled;
  const sfxOn = !!bundle.compiledSfxPlan?.enabled;
  const moodId = String(c.clipMusicMood || "none").toLowerCase();
  const ambId = String(c.clipAmbientSoundPreset || "none").toLowerCase();

  let dur =
    typeof voiceDurationSec === "number" && Number.isFinite(voiceDurationSec) && voiceDurationSec > 0
      ? voiceDurationSec
      : 5;
  let sr = 48000;
  try {
    const meta = voiceMp3Blob ? await sniffVoiceMp3Blob(voiceMp3Blob) : await sniffVoiceBufferMeta(voiceMp3Url);
    sr = meta.sampleRate;
    dur = meta.durationSec;
  } catch {
    /* fallback dur/sr sopra */
  }
  const durRounded = Math.round(dur * 10) / 10;

  if (typeof console !== "undefined" && console.info) {
    console.info("[AXSTUDIO · audio render · plan]", {
      clipId: c.id,
      musicOn,
      ambOn,
      sfxOn,
      moodId,
      ambId,
      voiceDurationSec: durRounded,
    });
  }

  const voiceStem = {
    role: "voice",
    url: String(voiceMp3Url || "").trim(),
    sourceType: "elevenlabs_tts",
    stemKind: "rendered",
    durationSec: durRounded,
    status: STEM_STATUS.OK,
    label: "Voce TTS",
    meta: { provider: "elevenlabs" },
  };

  /** @type {object|null} */
  let musicStem = {
    role: "music",
    url: null,
    sourceType: "off",
    stemKind: "placeholder",
    durationSec: null,
    status: STEM_STATUS.SKIPPED,
    label: bundle.compiledMusicPlan?.mood || "Musica",
    meta: { reason: "disabled_in_plan" },
  };
  /** @type {object|null} */
  let ambientStem = {
    role: "ambient",
    url: null,
    sourceType: "off",
    stemKind: "placeholder",
    durationSec: null,
    status: STEM_STATUS.SKIPPED,
    label: bundle.compiledAmbientPlan?.preset || "Ambiente",
    meta: { reason: "disabled_in_plan" },
  };
  /** @type {object|null} */
  let sfxStem = {
    role: "sfx",
    url: null,
    sourceType: "off",
    stemKind: "placeholder",
    durationSec: null,
    status: STEM_STATUS.SKIPPED,
    label: "SFX",
    meta: { reason: "disabled_in_plan" },
  };

  let musicBuffer = null;
  let ambientBuffer = null;
  let sfxBuffer = null;

  let musicExecutionStrategy = null;
  let musicRenderPlan = null;
  let musicGenerationResult = null;
  let musicProviderPersist = null;
  let musicSourceTypePersist = "off";
  let musicAssetUrlPersist = null;
  let musicAssetDurationSecPersist = null;
  let musicFallbackUsed = false;
  let musicConstraintReport = null;
  let musicProviderSourceFlag = "mvp";

  if (musicOn && moodId !== "none") {
    musicExecutionStrategy = buildMusicExecutionStrategy({
      clip: c,
      compiledMusicPlan: bundle.compiledMusicPlan,
      compiledAudioDesignBundle: bundle,
      projectMeta,
      chapterMeta,
      clipDurationSec: durRounded,
      providerConfig: musicProviderConfig,
    });
    if (typeof console !== "undefined" && console.info) {
      console.info("[AXSTUDIO · music strategy]", musicExecutionStrategy);
    }

    if (musicExecutionStrategy.strategyType !== "off") {
      const tryElevenFirst = musicExecutionStrategy.providerChoice === "elevenlabs_compose";
      const attempts = [];
      if (tryElevenFirst) {
        if (getElevenLabsApiKey()) attempts.push("elevenlabs");
        if (hasFalApiKeyForMusic()) attempts.push("fal");
      } else {
        if (hasFalApiKeyForMusic()) attempts.push("fal");
        if (getElevenLabsApiKey()) attempts.push("elevenlabs");
      }

      let providerBuf = null;
      let stemAssetUrl = null;
      let usedProvider = null;

      for (const prov of attempts) {
        musicRenderPlan = buildMusicRenderPlan(musicExecutionStrategy, {
          activeProvider: prov,
          clipDurationSec: durRounded,
        });
        if (typeof console !== "undefined" && console.info) {
          console.info("[AXSTUDIO · music render plan]", musicRenderPlan);
          console.info("[AXSTUDIO · music provider dispatch]", {
            clipId: c.id,
            provider: prov,
            endpoint: musicRenderPlan.providerEndpointKey,
            model: musicRenderPlan.chosenModel,
          });
        }

        if (prov === "fal") {
          const r = await generateMusicWithFal(musicRenderPlan);
          if (typeof console !== "undefined" && console.info) {
            console.info("[AXSTUDIO · music provider result]", {
              clipId: c.id,
              provider: "fal",
              ok: r.ok,
              error: r.error || null,
            });
          }
          if (r.ok && r.audioUrl) {
            try {
              providerBuf = await decodeProviderMusicUrlToBuffer(r.audioUrl);
              stemAssetUrl = r.audioUrl;
              usedProvider = "fal";
              musicAssetDurationSecPersist =
                Math.round((providerBuf.length / providerBuf.sampleRate) * 10) / 10;
              musicGenerationResult = {
                ok: true,
                provider: "fal",
                model: "stable-audio-25/text-to-audio",
                assetUrl: r.audioUrl,
                error: null,
                at: new Date().toISOString(),
              };
              break;
            } catch (e) {
              musicGenerationResult = {
                ok: false,
                provider: "fal",
                error: e?.message || String(e),
                at: new Date().toISOString(),
              };
            }
          } else {
            musicGenerationResult = {
              ok: false,
              provider: "fal",
              error: r.error || "unknown",
              at: new Date().toISOString(),
            };
          }
        } else if (prov === "elevenlabs") {
          const r = await generateMusicWithEleven(musicRenderPlan);
          if (typeof console !== "undefined" && console.info) {
            console.info("[AXSTUDIO · music provider result]", {
              clipId: c.id,
              provider: "elevenlabs",
              ok: r.ok,
              error: r.error || null,
            });
          }
          if (r.ok && r.audioBlob) {
            try {
              const blobUrl = URL.createObjectURL(r.audioBlob);
              try {
                providerBuf = await decodeProviderMusicUrlToBuffer(blobUrl);
              } finally {
                URL.revokeObjectURL(blobUrl);
              }
              const measured = await measureAudioBlobDurationSeconds(r.audioBlob);
              musicAssetDurationSecPersist =
                measured != null
                  ? measured
                  : Math.round((providerBuf.length / providerBuf.sampleRate) * 10) / 10;
              stemAssetUrl = await uploadBlobToFalStorage(
                r.audioBlob,
                `sceno_${clipId}_music_el_compose.mp3`,
                "audio/mpeg",
              );
              usedProvider = "elevenlabs";
              musicGenerationResult = {
                ok: true,
                provider: "elevenlabs",
                model: "music_v1",
                assetUrl: stemAssetUrl,
                error: null,
                at: new Date().toISOString(),
              };
              break;
            } catch (e) {
              musicGenerationResult = {
                ok: false,
                provider: "elevenlabs",
                error: e?.message || String(e),
                at: new Date().toISOString(),
              };
            }
          } else {
            musicGenerationResult = {
              ok: false,
              provider: "elevenlabs",
              error: r.error || "unknown",
              at: new Date().toISOString(),
            };
          }
        }
      }

      if (providerBuf && stemAssetUrl && usedProvider) {
        musicFallbackUsed = false;
        const voiceRef = await loadVoiceBufferForBedFit(voiceMp3Url, voiceMp3Blob);
        musicBuffer = fitMusicBufferToVoiceReference(voiceRef, providerBuf);
        const wav = audioBufferToWavBlob(musicBuffer);
        const mixStemUrl = await uploadBlobToFalStorage(wav, `sceno_${clipId}_music_norm.wav`, "audio/wav");
        musicProviderSourceFlag = usedProvider;
        musicProviderPersist = usedProvider;
        musicSourceTypePersist = usedProvider === "elevenlabs" ? "elevenlabs_compose" : "fal_stable_audio";
        musicAssetUrlPersist = stemAssetUrl;
        musicConstraintReport = {
          engineVersion: MUSIC_SOURCE_ENGINE_VERSION,
          droppedFields: musicRenderPlan?.droppedFields || [],
          limitations: musicExecutionStrategy?.limitations || [],
          expectedDurationSec: durRounded,
          providerAssetDurationSec: musicAssetDurationSecPersist,
          normalization: "resample_linear_to_voice_sr_and_fit_voice_length",
        };
        musicStem = {
          role: "music",
          url: mixStemUrl,
          sourceType: musicSourceTypePersist,
          stemKind: "rendered",
          durationSec: durRounded,
          status: STEM_STATUS.OK,
          label: `Musica provider (${usedProvider})`,
          meta: {
            moodId,
            engine: "audioRenderEngine",
            musicSourceEngineVersion: MUSIC_SOURCE_ENGINE_VERSION,
            providerAssetUrl: stemAssetUrl,
            mixStemNormalizedUrl: mixStemUrl,
          },
        };
      } else {
        musicFallbackUsed = true;
        if (typeof console !== "undefined" && console.info) {
          console.info("[AXSTUDIO · music fallback]", {
            clipId: c.id,
            reason: attempts.length ? "all_provider_attempts_failed_or_decode_error" : "no_provider_keys_for_music",
            attemptsTried: attempts,
            lastError: musicGenerationResult?.error || null,
          });
        }
        musicProviderSourceFlag = "mvp";
        musicProviderPersist = "axstudio_synth";
        musicSourceTypePersist = "procedural_mvp";
        musicBuffer = renderProceduralMusicBuffer(moodId, dur, sr, {
          intensityLevel: bundle.compiledMusicPlan?.intensityLevel || "medium",
        });
        const wav = audioBufferToWavBlob(musicBuffer);
        const url = await uploadBlobToFalStorage(wav, `sceno_${clipId}_music_mvp.wav`, "audio/wav");
        musicAssetUrlPersist = url;
        musicAssetDurationSecPersist = durRounded;
        musicGenerationResult = {
          ok: true,
          provider: "axstudio_synth",
          model: "procedural_web_audio",
          assetUrl: url,
          error: null,
          at: new Date().toISOString(),
        };
        musicConstraintReport = {
          engineVersion: MUSIC_SOURCE_ENGINE_VERSION,
          droppedFields: musicRenderPlan?.droppedFields || [],
          limitations: [
            ...(musicExecutionStrategy?.limitations || []),
            "Fallback attivo: pad sinusoidale MVP (nessun output provider utilizzabile).",
          ],
          expectedDurationSec: durRounded,
          providerAssetDurationSec: null,
          normalization: "native_mvp_buffer",
        };
        musicStem = {
          role: "music",
          url,
          sourceType: "procedural_mvp",
          stemKind: "rendered",
          durationSec: durRounded,
          status: STEM_STATUS.OK,
          label: `Musica MVP (${moodId})`,
          meta: { moodId, engine: "audioRenderEngine", musicFallbackUsed: true },
        };
      }
    }
  }

  if (ambOn && ambId !== "none") {
    ambientBuffer = renderProceduralAmbientBuffer(ambId, dur, sr);
    const wav = audioBufferToWavBlob(ambientBuffer);
    const url = await uploadBlobToFalStorage(wav, `sceno_${clipId}_ambient_mvp.wav`, "audio/wav");
    ambientStem = {
      role: "ambient",
      url,
      sourceType: "procedural_mvp",
      stemKind: "rendered",
      durationSec: durRounded,
      status: STEM_STATUS.OK,
      label: `Ambiente MVP (${ambId})`,
      meta: { presetId: ambId, engine: "audioRenderEngine" },
    };
  }

  if (sfxOn) {
    sfxBuffer = renderProceduralSfxBuffer(dur, sr);
    const wav = audioBufferToWavBlob(sfxBuffer);
    const url = await uploadBlobToFalStorage(wav, `sceno_${clipId}_sfx_mvp.wav`, "audio/wav");
    sfxStem = {
      role: "sfx",
      url,
      sourceType: "procedural_mvp",
      stemKind: "rendered",
      durationSec: durRounded,
      status: STEM_STATUS.OK,
      label: "SFX MVP (accenti)",
      meta: { engine: "audioRenderEngine" },
    };
  }

  if (typeof console !== "undefined" && console.info) {
    console.info("[AXSTUDIO · audio render · selected stems]", {
      voice: { ok: true, sourceType: voiceStem.sourceType },
      music: { status: musicStem.status, sourceType: musicStem.sourceType, url: !!musicStem.url },
      ambient: { status: ambientStem.status, sourceType: ambientStem.sourceType, url: !!ambientStem.url },
      sfx: { status: sfxStem.status, sourceType: sfxStem.sourceType, url: !!sfxStem.url },
    });
  }

  const gains = gainsFromBundle(bundle);
  const needsMix = !!(musicBuffer || ambientBuffer || sfxBuffer);

  let mixedBuffer;
  let mixedUrl;
  let strategy;
  let professionalMixStrategy = null;
  let professionalMixRenderPlan = null;
  let professionalMixResult = null;
  let finalAudioMixUrl = null;
  let finalAudioMixMetrics = null;
  let finalAudioMixConstraintReport = null;
  let mixFallbackUsed = false;

  const stemPresence = {
    music: !!musicBuffer,
    ambient: !!ambientBuffer,
    sfx: !!sfxBuffer,
  };

  if (needsMix) {
    professionalMixStrategy = buildProfessionalMixStrategy({
      clip: c,
      compiledAudioMixIntent: bundle.compiledAudioMixIntent,
      compiledAudioDesignBundle: bundle,
      mixExecutionPlan,
      clipDurationSec: durRounded,
      stemPresence,
    });
    if (typeof console !== "undefined" && console.info) {
      console.info("[AXSTUDIO · mix strategy]", professionalMixStrategy);
    }

    try {
      const voiceBufForMix = await loadVoiceBufferForBedFit(voiceMp3Url, voiceMp3Blob);
      professionalMixRenderPlan = buildProfessionalMixRenderPlan(professionalMixStrategy, {
        sampleRate: voiceBufForMix.sampleRate,
        lengthSamples: voiceBufForMix.length,
        stemPresence,
      });
      if (typeof console !== "undefined" && console.info) {
        console.info("[AXSTUDIO · mix render plan]", professionalMixRenderPlan);
      }

      professionalMixResult = executeProfessionalMixOffline({
        voiceBuffer: voiceBufForMix,
        musicBuffer,
        ambientBuffer,
        sfxBuffer,
        renderPlan: professionalMixRenderPlan,
        strategy: professionalMixStrategy,
      });
      mixedBuffer = professionalMixResult.buffer;
      finalAudioMixMetrics = professionalMixResult.metrics;
      finalAudioMixConstraintReport = professionalMixResult.constraintReport;
      mixFallbackUsed = false;
      if (typeof console !== "undefined" && console.info) {
        console.info("[AXSTUDIO · mix execution]", {
          clipId: c.id,
          ok: professionalMixResult.ok,
          path: professionalMixResult.executionPath,
        });
        console.info("[AXSTUDIO · mix metrics]", professionalMixResult.metrics);
      }
    } catch (err) {
      mixFallbackUsed = true;
      professionalMixResult = {
        ok: false,
        error: err?.message || String(err),
        executionPath: "fallback_mvp_static_gain",
      };
      finalAudioMixConstraintReport = {
        version: PROFESSIONAL_MIX_ENGINE_VERSION,
        limitations: ["Motore professional mix fallito; usato sommatore MVP statico."],
        fallbackReason: professionalMixResult.error,
      };
      if (typeof console !== "undefined" && console.info) {
        console.info("[AXSTUDIO · mix fallback]", {
          clipId: c.id,
          error: professionalMixResult.error,
        });
      }
      mixedBuffer = await mixVoiceWithBedsOffline({
        voiceUrl: voiceMp3Url,
        musicBuffer,
        ambientBuffer,
        sfxBuffer,
        gains,
      });
    }

    const mixedWav = audioBufferToWavBlob(mixedBuffer);
    const mixFile = mixFallbackUsed ? `sceno_${clipId}_mix_mvp.wav` : `sceno_${clipId}_mix_pro.wav`;
    mixedUrl = await uploadBlobToFalStorage(mixedWav, mixFile, "audio/wav");
    finalAudioMixUrl = mixedUrl;
    strategy = mixFallbackUsed ? "web_audio_offline_gain_staging" : "professional_offline_v1";
  } else {
    mixedUrl = String(voiceMp3Url || "").trim();
    finalAudioMixUrl = mixedUrl;
    strategy = "voice_only_no_beds";
    professionalMixStrategy = buildProfessionalMixStrategy({
      clip: c,
      compiledAudioMixIntent: bundle.compiledAudioMixIntent,
      compiledAudioDesignBundle: bundle,
      mixExecutionPlan,
      clipDurationSec: durRounded,
      stemPresence: { music: false, ambient: false, sfx: false },
    });
    professionalMixRenderPlan = buildProfessionalMixRenderPlan(professionalMixStrategy, {
      sampleRate: sr,
      lengthSamples: Math.max(1, Math.ceil(dur * sr)),
      stemPresence: { music: false, ambient: false, sfx: false },
    });
    professionalMixResult = {
      ok: true,
      executionPath: "voice_only_no_beds",
      skippedOfflineRender: true,
    };
    finalAudioMixMetrics = { mode: "voice_only", sampleRate: sr };
    finalAudioMixConstraintReport = {
      version: PROFESSIONAL_MIX_ENGINE_VERSION,
      limitations: professionalMixStrategy.limitations || [],
      note: "Nessun bed: nessun passaggio offline oltre al file voce.",
    };
    mixFallbackUsed = false;
  }

  const audioMixExecutionResult = {
    engineVersion: AUDIO_RENDER_ENGINE_VERSION,
    at: new Date().toISOString(),
    strategy,
    sampleRate: sr,
    gainsLinear: gains,
    mixedAudioUrl: mixedUrl,
    mixedDurationSec: durRounded,
    klingAudioUrl: mixedUrl,
    bedsUsed: {
      music: !!musicBuffer,
      ambient: !!ambientBuffer,
      sfx: !!sfxBuffer,
    },
    professionalMixEngineVersion: PROFESSIONAL_MIX_ENGINE_VERSION,
    mixEngineMode: needsMix ? (mixFallbackUsed ? "mvp_fallback" : "professional_v1") : "voice_only",
    mixFallbackUsed,
  };

  if (typeof console !== "undefined" && console.info) {
    console.info("[AXSTUDIO · audio render · mix result]", audioMixExecutionResult);
  }

  let musicRenderSummaryNote =
    "Musica non attiva nel piano. Ambiente/SFX possono essere pad MVP; voce = ElevenLabs.";
  if (musicOn && moodId !== "none") {
    if (musicFallbackUsed) {
      musicRenderSummaryNote =
        "Musica: fallback synth MVP (provider non disponibile o errori). Ambiente/SFX MVP; voce ElevenLabs.";
    } else if (musicProviderPersist === "fal") {
      musicRenderSummaryNote =
        "Musica: FAL Stable Audio → stem normalizzato al frame voce. Ambiente/SFX MVP; voce ElevenLabs.";
    } else if (musicProviderPersist === "elevenlabs") {
      musicRenderSummaryNote =
        "Musica: ElevenLabs compose → fal storage → stem normalizzato. Ambiente/SFX MVP; voce ElevenLabs.";
    } else if (musicProviderPersist === "axstudio_synth") {
      musicRenderSummaryNote =
        "Musica: pad sintetico MVP. Ambiente/SFX MVP; voce ElevenLabs.";
    }
  }

  const audioRenderResult = {
    engineVersion: AUDIO_RENDER_ENGINE_VERSION,
    at: new Date().toISOString(),
    clipId: String(clipId),
    stems: {
      voice: voiceStem,
      music: musicStem,
      ambient: ambientStem,
      sfx: sfxStem,
    },
    renderSummary: {
      musicRenderedNow: musicStem.status === STEM_STATUS.OK,
      ambientRenderedNow: ambientStem.status === STEM_STATUS.OK,
      sfxRenderedNow: sfxStem.status === STEM_STATUS.OK,
      voiceRenderedNow: true,
      note: musicRenderSummaryNote,
      musicProvider: musicProviderPersist,
      musicFallbackUsed,
      musicSourceEngineVersion: MUSIC_SOURCE_ENGINE_VERSION,
    },
  };

  const bundlePatchFlags = {
    musicRendered: musicStem.status === STEM_STATUS.OK,
    ambientRendered: ambientStem.status === STEM_STATUS.OK,
    sfxRendered: sfxStem.status === STEM_STATUS.OK,
    musicProviderSource: musicProviderSourceFlag,
  };

  return {
    voiceStem,
    musicStem,
    ambientStem,
    sfxStem,
    audioRenderResult,
    audioMixExecutionResult,
    audioUrlForKling: mixedUrl,
    updatedAudioDesignBundle: patchAudioDesignBundleAfterRender(bundle, bundlePatchFlags),
    postAudioRenderForMixPlan: {
      voiceStem,
      musicStem,
      ambientStem,
      sfxStem,
      mixedAudioUrl: mixedUrl,
    },
    musicExecutionStrategy,
    musicRenderPlan,
    musicGenerationResult,
    musicProvider: musicProviderPersist,
    musicSourceType: musicSourceTypePersist,
    musicAssetUrl: musicAssetUrlPersist,
    musicAssetDurationSec: musicAssetDurationSecPersist,
    musicFallbackUsed,
    musicConstraintReport,
    professionalMixStrategy,
    professionalMixRenderPlan,
    professionalMixResult,
    finalAudioMixUrl,
    finalAudioMixMetrics,
    finalAudioMixConstraintReport,
    mixFallbackUsed,
  };
}
