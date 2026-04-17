/**
 * Adapter musica: FAL (Stable Audio) e ElevenLabs (/v1/music) — stessi pattern di trasporto del repo.
 */

import { falQueueRequest } from "./imagePipeline.js";
import { getElevenLabsApiKey } from "./elevenlabsService.js";
import { FAL_STABLE_AUDIO_TEXT_TO_AUDIO } from "./musicSourceEngine.js";

function trimUrl(u) {
  const s = u != null ? String(u).trim() : "";
  return s || null;
}

function extractFalAudioUrl(raw) {
  if (!raw || typeof raw !== "object") return null;
  const a = raw.audio;
  if (typeof a === "string") return trimUrl(a);
  if (a && typeof a === "object" && a.url) return trimUrl(a.url);
  return trimUrl(raw.audio_url?.url || raw.audio_url);
}

/**
 * @param {object} renderPlan — musicRenderPlan (campo requestPayloadActuallySent popolato)
 * @param {{ onProgress?: (s: string) => void }} [opts]
 * @returns {Promise<{ ok: boolean, audioUrl: string|null, raw: object, error: string|null }>}
 */
export async function generateMusicWithFal(renderPlan, opts = {}) {
  const p = renderPlan?.requestPayloadActuallySent && typeof renderPlan.requestPayloadActuallySent === "object"
    ? renderPlan.requestPayloadActuallySent
    : {};
  const prompt = trimUrl(p.prompt);
  if (!prompt) {
    return { ok: false, audioUrl: null, raw: {}, error: "Prompt musica FAL vuoto." };
  }
  const payload = {
    prompt,
    seconds_total: typeof p.seconds_total === "number" ? p.seconds_total : 30,
    num_inference_steps: typeof p.num_inference_steps === "number" ? p.num_inference_steps : 8,
    guidance_scale: typeof p.guidance_scale === "number" ? p.guidance_scale : 1,
  };
  try {
    const raw = await falQueueRequest(FAL_STABLE_AUDIO_TEXT_TO_AUDIO, payload, opts.onProgress);
    const audioUrl = extractFalAudioUrl(raw);
    if (!audioUrl) {
      return { ok: false, audioUrl: null, raw, error: "FAL Stable Audio: nessun URL audio nella risposta." };
    }
    return { ok: true, audioUrl, raw, error: null };
  } catch (e) {
    const msg = e?.message || String(e);
    return { ok: false, audioUrl: null, raw: {}, error: msg };
  }
}

/**
 * @param {object} renderPlan
 * @returns {Promise<{ ok: boolean, audioBlob: Blob|null, rawStatus: number, error: string|null }>}
 */
export async function generateMusicWithEleven(renderPlan) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    return { ok: false, audioBlob: null, rawStatus: 0, error: "REACT_APP_ELEVENLABS_API_KEY mancante." };
  }
  const p = renderPlan?.requestPayloadActuallySent && typeof renderPlan.requestPayloadActuallySent === "object"
    ? renderPlan.requestPayloadActuallySent
    : {};
  const prompt = trimUrl(p.prompt);
  if (!prompt) {
    return { ok: false, audioBlob: null, rawStatus: 0, error: "Prompt musica ElevenLabs vuoto." };
  }
  const body = {
    prompt,
    music_length_ms: typeof p.music_length_ms === "number" ? p.music_length_ms : 15000,
    model_id: p.model_id || "music_v1",
    force_instrumental: p.force_instrumental !== false,
  };
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
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
      return {
        ok: false,
        audioBlob: null,
        rawStatus: res.status,
        error: `ElevenLabs music (${res.status}): ${errText || res.statusText}`,
      };
    }
    const audioBlob = await res.blob();
    return { ok: true, audioBlob, rawStatus: res.status, error: null };
  } catch (e) {
    return { ok: false, audioBlob: null, rawStatus: 0, error: e?.message || String(e) };
  }
}
