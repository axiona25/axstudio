/**
 * Profili di rendering video AXSTUDIO — separazione netta tra **preview clip** (Scenografie / Clip Builder)
 * e **final delivery** (montaggio filmato finale). Non condividere parametri tra i due flussi.
 *
 * Note provider (Kling Avatar / O3): la risoluzione nativa del video generato in cloud non è
 * controllabile da questo repo; per la preview applichiamo comunque un passaggio ffmpeg locale
 * verso 1280×720 dove possibile. Il montaggio finale scala/ricodifica esplicitamente verso la
 * risoluzione di consegna scelta (upscale incluso — qualità limitata se i clip restano preview).
 *
 * **Preview fast vs balanced** (ffmpeg.wasm dopo provider):
 * - `fast`: preset ultrafast, CRF più alto, AAC più basso → file più leggeri, iterazione rapida.
 * - `balanced`: preset veryfast, CRF più basso, AAC più alto → review più pulita; stesso frame size 1280×720.
 * Il provider cloud (Kling) resta invariato; differenzia solo encode/mux locale.
 */

/** @typedef {'1080p' | '2k' | '4k'} FinalRenderResolutionId */

/** @typedef {'fast' | 'balanced'} PreviewEncodeTier */

/**
 * Risoluzioni di export finale. **2K = QHD 2560×1440** (consumer / display moderni), non DCI 2048×1080,
 * per allineamento a player e scaling 16:9 senza bande verticali sui monitor più comuni.
 */
export const FINAL_RENDER_RESOLUTIONS = {
  "1080p": { width: 1920, height: 1080, label: "Full HD", shortLabel: "1080p" },
  "2k": {
    width: 2560,
    height: 1440,
    label: "2K (QHD)",
    shortLabel: "2K",
    note: "2560×1440 — QHD; non DCI 2K cinematografico",
  },
  "4k": { width: 3840, height: 2160, label: "4K UHD", shortLabel: "4K" },
};

export const FINAL_RENDER_RESOLUTION_IDS = /** @type {const} */ (["1080p", "2k", "4k"]);

/**
 * Preview clip · priorità velocità e peso file (comportamento storico AXSTUDIO).
 * Usato per `preview_fast` e come default se il tier non è «balanced».
 */
export const PREVIEW_CLIP_PROFILE_FAST = {
  mode: "preview",
  previewTier: "fast",
  label: "Preview Clip · fast",
  width: 1280,
  height: 720,
  fps: 24,
  qualityTier: "fast",
  bitrateTier: "medium",
  audioMixTier: "review",
  exportPurpose: "ui_review",
  isFinal: false,
  x264Preset: "ultrafast",
  /** Allineato al profilo preview storico (prima del tier balanced). */
  x264Crf: 26,
  audioBitrateK: 128,
};

/**
 * Preview clip · priorità leggibilità in review (encode locale meno aggressivo).
 * Stessa risoluzione target 1280×720 del fast; CRF più basso e bitrate audio più alto.
 */
export const PREVIEW_CLIP_PROFILE_BALANCED = {
  mode: "preview",
  previewTier: "balanced",
  label: "Preview Clip · balanced",
  width: 1280,
  height: 720,
  fps: 24,
  qualityTier: "medium",
  bitrateTier: "medium",
  audioMixTier: "review",
  exportPurpose: "ui_review",
  isFinal: false,
  x264Preset: "veryfast",
  x264Crf: 22,
  audioBitrateK: 192,
};

/** @deprecated alias di `PREVIEW_CLIP_PROFILE_FAST` — stesso significato storico «preview default». */
export const PREVIEW_CLIP_PROFILE = PREVIEW_CLIP_PROFILE_FAST;

const FINAL_RENDER_BASE = {
  mode: "final",
  label: "Final Render",
  fps: 24,
  qualityTier: "high",
  bitrateTier: "high",
  audioMixTier: "final",
  exportPurpose: "delivery",
  isFinal: true,
  x264Preset: "medium",
  x264Crf: 19,
  audioBitrateK: 256,
};

/** Esposizione dichiarativa: `final` richiede width/height da `FINAL_RENDER_RESOLUTIONS` → usa `getVideoRenderProfile`. */
export const VIDEO_RENDER_PROFILES = {
  preview: PREVIEW_CLIP_PROFILE_FAST,
  previewBalanced: PREVIEW_CLIP_PROFILE_BALANCED,
  finalBase: FINAL_RENDER_BASE,
};

/**
 * @param {{ width: number, height: number, fps?: number }} dims
 * @returns {string}
 */
export function buildFfmpegScalePadFpsFilter(dims) {
  const w = Math.max(2, Math.floor(Number(dims.width) || 0));
  const h = Math.max(2, Math.floor(Number(dims.height) || 0));
  const fps = Math.max(1, Math.floor(Number(dims.fps) || 24));
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`;
}

/**
 * @param {unknown} key
 * @returns {FinalRenderResolutionId}
 */
export function normalizeFinalResolutionKey(key) {
  const k = String(key || "").toLowerCase().trim();
  if (k === "2k" || k === "1440p") return "2k";
  if (k === "4k" || k === "2160p") return "4k";
  return "1080p";
}

/**
 * Preferenza persistita (capitolo / payload editor).
 * @param {unknown} raw
 * @returns {{ resolution: FinalRenderResolutionId, fps: number }}
 */
export function normalizeFinalRenderSettings(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const resolution = normalizeFinalResolutionKey(o.resolution);
  const fps = typeof o.fps === "number" && Number.isFinite(o.fps) && o.fps > 0 ? Math.min(60, Math.round(o.fps)) : 24;
  return { resolution, fps };
}

/**
 * Da intent copilota / UI (`preview_fast` | `preview_balanced`) al tier encode locale.
 * Intent `final_*` non usa questo per la clip preview: la generazione clip resta sempre preview locale;
 * in quel caso si usa tier `fast` salvo override esplicito.
 *
 * @param {unknown} previewRenderIntentId
 * @returns {PreviewEncodeTier}
 */
export function resolvePreviewEncodeTier(previewRenderIntentId) {
  const id = String(previewRenderIntentId || "").trim();
  if (id === "preview_balanced") return "balanced";
  return "fast";
}

/**
 * @param {{
 *   mode: 'preview',
 *   previewTier?: PreviewEncodeTier,
 * } | {
 *   mode: 'final',
 *   finalResolutionKey?: string,
 *   finalFps?: number,
 * } | null} opts
 * @returns {Record<string, unknown>}
 */
export function getVideoRenderProfile(opts) {
  if (!opts || opts.mode === "preview") {
    const tier = opts?.previewTier === "balanced" ? "balanced" : "fast";
    const src = tier === "balanced" ? PREVIEW_CLIP_PROFILE_BALANCED : PREVIEW_CLIP_PROFILE_FAST;
    return { ...src };
  }
  const resKey = normalizeFinalResolutionKey(opts.finalResolutionKey);
  const spec = FINAL_RENDER_RESOLUTIONS[resKey] || FINAL_RENDER_RESOLUTIONS["1080p"];
  const fps =
    typeof opts.finalFps === "number" && Number.isFinite(opts.finalFps) && opts.finalFps > 0
      ? Math.round(opts.finalFps)
      : FINAL_RENDER_BASE.fps;
  return {
    ...FINAL_RENDER_BASE,
    ...spec,
    finalResolutionKey: resKey,
    fps,
  };
}

/**
 * Risoluzione effettiva per il montaggio (browser ffmpeg). Salva sempre la richiesta utente;
 * il fallback avviene solo se il passaggio di encode finale fallisce (memoria / errore wasm).
 *
 * @param {FinalRenderResolutionId} requestedKey
 * @returns {{
 *   requestedResolution: FinalRenderResolutionId,
 *   effectiveResolution: FinalRenderResolutionId,
 *   fallbackReason: string | null,
 *   width: number,
 *   height: number,
 * }}
 */
export function resolveMontageDeliveryDimensions(requestedKey) {
  const requestedResolution = normalizeFinalResolutionKey(requestedKey);
  const spec = FINAL_RENDER_RESOLUTIONS[requestedResolution];
  if (!spec) {
    const fb = FINAL_RENDER_RESOLUTIONS["1080p"];
    return {
      requestedResolution,
      effectiveResolution: "1080p",
      fallbackReason: "invalid_resolution_key",
      width: fb.width,
      height: fb.height,
    };
  }
  return {
    requestedResolution,
    effectiveResolution: requestedResolution,
    fallbackReason: null,
    width: spec.width,
    height: spec.height,
  };
}
