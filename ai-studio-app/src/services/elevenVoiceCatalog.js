/**
 * Catalogo voci ElevenLabs: API `/v1/voices` + preset IT da .env (AXSTUDIO).
 * Cache locale (localStorage) per UX offline / riduzione chiamate.
 */

import { getElevenLabsApiKey, resolveElevenLabsVoiceId } from "./elevenlabsService.js";
import { ELEVENLABS_VOICE_PRESETS } from "./scenografieVideoWorkflow.js";

export const ELEVEN_VOICE_CATALOG_VERSION = 1;
const LS_KEY = "axstudio_eleven_voice_catalog_v1";

function trim(v) {
  return v != null ? String(v).trim() : "";
}

/**
 * @param {object} v — voce raw API ElevenLabs
 * @returns {object}
 */
export function normalizeElevenLabsApiVoice(v) {
  if (!v || typeof v !== "object") return null;
  const voiceId = trim(v.voice_id || v.voiceId);
  if (!voiceId) return null;
  const name = trim(v.name) || "Voce senza nome";
  const category = trim(v.category).toLowerCase() || "unknown";
  const labels = v.labels && typeof v.labels === "object" ? { ...v.labels } : {};
  const description = v.description != null ? String(v.description) : "";

  let previewUrl = "";
  if (typeof v.preview_url === "string" && v.preview_url.trim()) previewUrl = v.preview_url.trim();
  else if (Array.isArray(v.samples) && v.samples[0]) {
    const s0 = v.samples[0];
    if (typeof s0.url === "string" && s0.url.trim()) previewUrl = s0.url.trim();
  }

  const langLabel = `${trim(labels.language)} ${trim(labels.accent)}`.toLowerCase();
  const verified = Array.isArray(v.verified_languages)
    ? v.verified_languages.map((x) => String(x || "").toLowerCase())
    : [];
  const blob = `${name} ${description} ${JSON.stringify(labels)}`.toLowerCase();
  const isItalian =
    langLabel.includes("ital") ||
    langLabel.includes(" it") ||
    langLabel === "it" ||
    verified.some((l) => l === "it" || l.includes("ital")) ||
    /\bitalian[oa]?\b|\bitaliano\b|\b(it)\b/i.test(blob);

  const isClone = category === "cloned";
  const isLibraryPremade = category === "premade";
  const isGenerated = category === "generated" || category === "ivc";
  const isFromMyVoices = isClone || isGenerated || category === "professional" || category === "fine_tuned";

  let sourceType = "library_premade";
  if (isClone) sourceType = "clone";
  else if (isFromMyVoices) sourceType = "my_voice";
  else if (isLibraryPremade) sourceType = "library_premade";
  else sourceType = "account_voice";

  const useCase = trim(labels.use_case || labels.useCase).toLowerCase();
  const isRecommendedForNarration =
    useCase.includes("narrat") || useCase.includes("audiobook") || useCase.includes("news");
  const isRecommendedForCharacter =
    useCase.includes("character") || useCase.includes("conversat") || useCase.includes("dialogue");

  return {
    voiceId,
    name,
    category,
    language: trim(labels.language) || (isItalian ? "it" : "") || null,
    labels,
    description,
    previewUrl: previewUrl || null,
    sourceType,
    isItalian,
    isFromMyVoices,
    isClone,
    isLibrary: isLibraryPremade,
    isRecommendedForNarration: isRecommendedForNarration || false,
    isRecommendedForCharacter: isRecommendedForCharacter || false,
  };
}

/**
 * Preset UI AXSTUDIO (id sintetico → risoluzione .env).
 * @returns {object[]}
 */
export function buildItalianEnvPresetCatalogEntries() {
  return ELEVENLABS_VOICE_PRESETS.map((p) => {
    const { voiceId, error } = resolveElevenLabsVoiceId(p.voiceId);
    return {
      voiceId: p.voiceId,
      resolvedVoiceId: voiceId || null,
      name: p.label,
      category: "app_preset",
      language: "it",
      labels: { axstudio: "env_preset" },
      description: error
        ? `Preset: configura la variabile .env collegata (dettaglio: ${error.slice(0, 120)})`
        : "Preset italiano AXSTUDIO — voice ID risolto da .env",
      previewUrl: null,
      sourceType: "italian_preset_env",
      isItalian: true,
      isFromMyVoices: false,
      isClone: false,
      isLibrary: false,
      isRecommendedForNarration: true,
      isRecommendedForCharacter: true,
    };
  });
}

/**
 * Unifica voci API e preset senza duplicare lo stesso voice_id reale.
 * @param {object[]} apiVoices — normalizzate
 * @param {object[]} presetVoices
 */
export function mergeVoiceCatalogEntries(apiVoices, presetVoices) {
  const byRealId = new Map();
  for (const x of apiVoices) {
    if (x?.voiceId) byRealId.set(x.voiceId, x);
  }
  const out = [...apiVoices];
  for (const p of presetVoices) {
    const rid = p.resolvedVoiceId || p.voiceId;
    if (rid && byRealId.has(rid)) continue;
    out.push({ ...p, voiceId: p.voiceId });
  }
  return out;
}

/**
 * @returns {{ voices: object[], voiceCatalogLastSyncAt: string, voiceCatalogSource: string, voiceCatalogVersion: number }}
 */
export async function syncElevenVoiceCatalogFromApi(options = {}) {
  const { signal } = options;
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error("REACT_APP_ELEVENLABS_API_KEY non configurata nel .env");
  }
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    method: "GET",
    headers: { "xi-api-key": apiKey, Accept: "application/json" },
    signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`ElevenLabs voices (${res.status}): ${t || res.statusText}`);
  }
  const data = await res.json();
  const rawList = Array.isArray(data.voices) ? data.voices : [];
  const apiVoices = rawList.map(normalizeElevenLabsApiVoice).filter(Boolean);
  const presets = buildItalianEnvPresetCatalogEntries();
  const voices = mergeVoiceCatalogEntries(apiVoices, presets);
  const payload = {
    voices,
    voiceCatalogLastSyncAt: new Date().toISOString(),
    voiceCatalogSource: "elevenlabs_api_v1_voices",
    voiceCatalogVersion: ELEVEN_VOICE_CATALOG_VERSION,
  };
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    }
  } catch {
    /* ignore quota */
  }
  return payload;
}

export function loadCachedElevenVoiceCatalog() {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || !Array.isArray(p.voices)) return null;
    return p;
  } catch {
    return null;
  }
}

export function clearCachedElevenVoiceCatalog() {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

/** Etichetta leggibile per `sourceType` (UI). */
export function voiceCatalogSourceLabel(entry) {
  const t = entry?.sourceType || "";
  if (t === "italian_preset_env") return "Preset IT (.env)";
  if (t === "my_voice") return "Le mie voci";
  if (t === "clone") return "Clone";
  if (t === "library_premade") return "Libreria ElevenLabs";
  if (t === "account_voice") return "Account";
  return t || "—";
}
