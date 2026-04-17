/**
 * ElevenLabs TTS per Scenografie (solo API ufficiale; nessun fallback FAL voce).
 * Le chiavi arrivano da variabili d'ambiente CRA (REACT_APP_*).
 */

/** Mappa preset UI → variabile .env con voice ID ElevenLabs reale (es. 21m00Tcm4TlvDq8ikWAM). */
export const SCENOGRAFIA_VOICE_PRESET_ENV_KEYS = {
  eleven_it_neutral_01: "REACT_APP_SCENO_EL_VOICE_NEUTRAL",
  eleven_it_warm_01: "REACT_APP_SCENO_EL_VOICE_WARM",
  eleven_it_cinematic_01: "REACT_APP_SCENO_EL_VOICE_CINEMATIC",
  eleven_it_female_young: "REACT_APP_SCENO_EL_VOICE_FEMALE_YOUNG",
  eleven_it_male_mature: "REACT_APP_SCENO_EL_VOICE_MALE_MATURE",
};

export function getElevenLabsApiKey() {
  return String(process.env.REACT_APP_ELEVENLABS_API_KEY || "").trim();
}

/**
 * Risolve un voice id configurato nell’app (preset sintetico o ID ElevenLabs reale).
 * @returns {{ voiceId: string|null, error: string|null }}
 */
export function resolveElevenLabsVoiceId(configuredId) {
  const raw = String(configuredId || "").trim();
  if (!raw) return { voiceId: null, error: "Voice ID ElevenLabs non impostato." };
  if (raw.startsWith("eleven_")) {
    const envName = SCENOGRAFIA_VOICE_PRESET_ENV_KEYS[raw];
    const fromEnv = envName ? String(process.env[envName] || "").trim() : "";
    if (fromEnv) return { voiceId: fromEnv, error: null };
    return {
      voiceId: null,
      error: envName
        ? `Preset voce «${raw}»: imposta ${envName} nel file .env con un voice ID ElevenLabs reale.`
        : `Preset voce «${raw}» non riconosciuto.`,
    };
  }
  return { voiceId: raw, error: null };
}

/**
 * @param {Blob} audioBlob
 * @returns {Promise<number|null>} durata in secondi
 */
export async function measureAudioBlobDurationSeconds(audioBlob) {
  if (typeof window === "undefined" || !audioBlob) return null;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const buf = await ctx.decodeAudioData(await audioBlob.arrayBuffer());
    await ctx.close?.();
    return Math.round(buf.duration * 10) / 10;
  } catch {
    return null;
  }
}

/**
 * Genera MP3 da testo (ElevenLabs).
 * @param {{ text: string, voiceId: string, modelId?: string, stability?: number, similarityBoost?: number }} opts
 */
export async function elevenLabsTextToSpeechMp3(opts) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error("REACT_APP_ELEVENLABS_API_KEY non configurata nel .env");
  }
  const text = String(opts.text || "").trim();
  if (!text) throw new Error("Testo TTS vuoto.");
  const voiceId = String(opts.voiceId || "").trim();
  if (!voiceId) throw new Error("voiceId ElevenLabs mancante.");

  const modelId = opts.modelId || "eleven_multilingual_v2";
  const stability = typeof opts.stability === "number" ? opts.stability : 0.5;
  const similarityBoost = typeof opts.similarityBoost === "number" ? opts.similarityBoost : 0.75;

  const body = {
    text,
    model_id: modelId,
    voice_settings: { stability, similarity_boost: similarityBoost },
  };

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS (${res.status}): ${errText || res.statusText}`);
  }

  return await res.blob();
}
