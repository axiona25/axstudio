/**
 * AXSTUDIO H9 — supporto CLI per test harness audio (Node).
 * Carica .env, path output, logging, download, ffmpeg opzionale, shim AudioContext minimo.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync, spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.join(__dirname, "..");
export const RENDERS_DIR = path.join(APP_ROOT, "temp", "test-renders");
export const REPORTS_DIR = path.join(APP_ROOT, "temp", "test-reports");

const LOG_TAGS = {
  voice: "[AXSTUDIO · test voice]",
  dialogue: "[AXSTUDIO · test dialogue]",
  music: "[AXSTUDIO · test music]",
  sfx: "[AXSTUDIO · test sfx]",
  mix: "[AXSTUDIO · test mix]",
  full: "[AXSTUDIO · test full stack]",
  report: "[AXSTUDIO · test report]",
};

export function logAxstudio(tagKey, message, extra = null) {
  const prefix = LOG_TAGS[tagKey] || "[AXSTUDIO · test]";
  if (extra != null) console.log(prefix, message, extra);
  else console.log(prefix, message);
}

export function ensureDirs() {
  fs.mkdirSync(RENDERS_DIR, { recursive: true });
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

/** Carica chiavi da .env CRA senza sovrascrivere variabili già presenti nel processo. */
export function loadAxstudioEnv() {
  const p = path.join(APP_ROOT, ".env");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || String(process.env[key]).trim() === "") {
      process.env[key] = val;
    }
  }
}

export function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

export function hasFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function runFfmpeg(args, opts = {}) {
  const r = spawnSync("ffmpeg", args, {
    maxBuffer: 80 * 1024 * 1024,
    ...opts,
  });
  return {
    status: r.status,
    stderr: r.stderr
      ? Buffer.isBuffer(r.stderr)
        ? r.stderr.toString("utf8")
        : String(r.stderr)
      : "",
    stdout: r.stdout,
    error: r.error,
  };
}

/**
 * Decodifica file audio in stereo f32 interleaved tramite ffmpeg.
 * @returns {{ sampleRate: number, interleaved: Float32Array, frames: number } | null}
 */
export function decodeAudioFileToF32Stereo(audioPath) {
  if (!hasFfmpeg()) return null;
  const r = runFfmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    audioPath,
    "-ac",
    "2",
    "-f",
    "f32le",
    "pipe:1",
  ]);
  if (r.status !== 0) {
    return { error: r.stderr || "ffmpeg decode failed", sampleRate: 0, interleaved: null, frames: 0 };
  }
  const buf = Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout || []);
  if (buf.length < 8) return { error: "empty decode", sampleRate: 0, interleaved: null, frames: 0 };
  const nFloat = Math.floor(buf.length / 4);
  const interleaved = new Float32Array(nFloat);
  for (let i = 0; i < nFloat; i++) interleaved[i] = buf.readFloatLE(i * 4);
  let sampleRate = 48000;
  try {
    const srTxt = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=sample_rate",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        audioPath,
      ],
      { encoding: "utf8" },
    );
    const sr = parseInt(String(srTxt).trim().split("\n")[0], 10);
    if (Number.isFinite(sr) && sr > 0) sampleRate = sr;
  } catch {
    /* ignore */
  }
  const frames = Math.floor(interleaved.length / 2);
  return { sampleRate, interleaved, frames, error: null };
}

export function makeShimAudioBuffer(numberOfChannels, length, sampleRate) {
  const ch = [];
  for (let i = 0; i < numberOfChannels; i++) ch.push(new Float32Array(length));
  return {
    numberOfChannels,
    length,
    sampleRate,
    getChannelData(i) {
      return ch[i];
    },
  };
}

/** Shim minimo per importare moduli src che usano AudioContext.createBuffer. */
export function installAudioContextShim() {
  if (globalThis.AudioContext && globalThis.AudioContext.name !== "AxstudioShimAudioContext") {
    return;
  }
  globalThis.AudioContext = class AxstudioShimAudioContext {
    constructor(opts = {}) {
      this.sampleRate = opts.sampleRate ?? 48000;
    }
    createBuffer(channels, length, sampleRate) {
      const sr = sampleRate ?? this.sampleRate;
      return makeShimAudioBuffer(channels, length, sr);
    }
    close() {}
  };
}

/** Popola AudioBuffer shim da stereo interleaved f32. */
export function fillBufferFromInterleavedF32(buf, interleaved) {
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const n = Math.min(buf.length, Math.floor(interleaved.length / 2));
  for (let i = 0; i < n; i++) {
    L[i] = interleaved[i * 2];
    R[i] = interleaved[i * 2 + 1];
  }
}

export function audioBufferLikeToWavFile(outPath, bufferLike) {
  const numChannels = bufferLike.numberOfChannels;
  const sampleRate = bufferLike.sampleRate;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = bufferLike.length * blockAlign;
  const out = Buffer.alloc(44 + dataLength);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + dataLength, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(numChannels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * blockAlign, 28);
  out.writeUInt16LE(blockAlign, 32);
  out.writeUInt16LE(bitDepth, 34);
  out.write("data", 36);
  out.writeUInt32LE(dataLength, 40);
  let off = 44;
  const vol = 0.985;
  for (let i = 0; i < bufferLike.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const x = Math.max(
        -1,
        Math.min(1, bufferLike.getChannelData(Math.min(ch, numChannels - 1))[i] * vol),
      );
      const int16 = Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
      out.writeInt16LE(int16, off);
      off += 2;
    }
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out);
}

export async function downloadToFile(url, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download ${res.status}: ${url}`);
  const ab = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(ab));
}

export async function elevenLabsTtsToFile(voiceId, text, outMp3, meta) {
  const apiKey = String(process.env.REACT_APP_ELEVENLABS_API_KEY || "").trim();
  if (!apiKey) throw new Error("REACT_APP_ELEVENLABS_API_KEY mancante");
  const body = {
    text: String(text).trim(),
    model_id: meta?.modelId || "eleven_multilingual_v2",
    voice_settings: {
      stability: typeof meta?.stability === "number" ? meta.stability : 0.5,
      similarity_boost: typeof meta?.similarityBoost === "number" ? meta.similarityBoost : 0.75,
    },
  };
  const t0 = Date.now();
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify(body),
    },
  );
  const latencyMs = Date.now() - t0;
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS (${res.status}): ${errText || res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outMp3, buf);
  return { latencyMs, bytes: buf.length, requestBody: body };
}

/** Ricampiona a stereo 48k e taglia a durationSec (secondi). Stem più corti: silenzio implicito nel motore mix oltre la fine. */
export function ffmpegNormalizeTo48kStereoDuration(inputPath, outputWavPath, durationSec) {
  if (!hasFfmpeg()) return { ok: false, error: "ffmpeg missing" };
  const d = Math.max(0.5, Number(durationSec) || 2);
  const r = runFfmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-ac",
    "2",
    "-ar",
    "48000",
    "-t",
    String(d),
    "-y",
    outputWavPath,
  ]);
  return { ok: r.status === 0, error: r.status !== 0 ? r.stderr : null };
}

export function ffprobeDurationSec(filePath) {
  if (!hasFfmpeg()) return null;
  try {
    const r = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { encoding: "utf8" },
    );
    const d = parseFloat(String(r).trim(), 10);
    return Number.isFinite(d) ? Math.round(d * 1000) / 1000 : null;
  } catch {
    return null;
  }
}

export function resolvePresetVoiceId(presetKey) {
  const map = {
    neutral: "REACT_APP_SCENO_EL_VOICE_NEUTRAL",
    warm: "REACT_APP_SCENO_EL_VOICE_WARM",
    cinematic: "REACT_APP_SCENO_EL_VOICE_CINEMATIC",
    female_young: "REACT_APP_SCENO_EL_VOICE_FEMALE_YOUNG",
    male_mature: "REACT_APP_SCENO_EL_VOICE_MALE_MATURE",
  };
  const envName = map[presetKey];
  if (!envName) return { voiceId: null, source: null };
  const voiceId = String(process.env[envName] || "").trim();
  return { voiceId: voiceId || null, source: envName };
}

export function baseReportFields(scenario) {
  return {
    scenario,
    testedAt: new Date().toISOString(),
    success: false,
    provider: null,
    modelOrMode: null,
    payloadIntent: null,
    payloadActuallySent: null,
    outputFiles: [],
    outputDurationSec: null,
    latencyMs: null,
    fallbackUsed: [],
    errors: [],
    technicalNotes: [],
    limitationsObserved: [],
    practicalRecommendation: null,
  };
}
