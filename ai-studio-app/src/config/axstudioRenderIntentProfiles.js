/**
 * AXSTUDIO — intent profili render per UI copilota (preview vs consegna).
 *
 * NOTA TECNICA (onesta):
 * - `preview_fast` / `preview_balanced`: mux/transcode ffmpeg.wasm clip usa
 *   `PREVIEW_CLIP_PROFILE_FAST` vs `PREVIEW_CLIP_PROFILE_BALANCED` in `videoRenderProfiles.js`
 *   (preset x264, CRF e bitrate AAC diversi; stesso 1280×720). Il provider cloud clip non cambia.
 * - `final_1080p` / `final_2k` / `final_4k`: sono **intenzioni di consegna montaggio**
 *   (ffmpeg locale sul filmato finale). Il provider cloud dei singoli clip può non
 *   generare nativamente 2K/4K — l’upscale migliora il contenitore, non inventa dettaglio.
 */

import { FINAL_RENDER_RESOLUTIONS, PREVIEW_CLIP_PROFILE } from "../services/videoRenderProfiles.js";

/** @typedef {'preview' | 'final'} AxstudioRenderStage */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   stage: AxstudioRenderStage,
 *   targetResolutionLabel: string,
 *   qualityPriority: 'low' | 'medium' | 'high' | 'max',
 *   speedPriority: 'low' | 'medium' | 'high',
 *   intendedUse: string,
 *   outputHint: string,
 *   mapsToFinalResolutionKey?: '1080p'|'2k'|'4k',
 *   previewTier?: 'fast' | 'balanced',
 *   engineerNote?: string,
 * }} AxstudioRenderIntentProfile
 */

export const AXSTUDIO_RENDER_INTENT_IDS = /** @type {const} */ ([
  "preview_fast",
  "preview_balanced",
  "final_1080p",
  "final_2k",
  "final_4k",
]);

/** @type {Record<string, AxstudioRenderIntentProfile>} */
export const AXSTUDIO_RENDER_INTENT_PROFILES = {
  preview_fast: {
    id: "preview_fast",
    label: "Preview veloce",
    stage: "preview",
    targetResolutionLabel: `~${PREVIEW_CLIP_PROFILE.width}×${PREVIEW_CLIP_PROFILE.height} (review)`,
    qualityPriority: "low",
    speedPriority: "high",
    intendedUse: "Smoke test, lip-sync, timing, prima bozza movimento.",
    outputHint:
      "Encode leggero per iterare in fretta. Non è alta qualità di consegna.",
    previewTier: "fast",
    engineerNote:
      "Pipeline clip: `getVideoRenderProfile({ previewTier: 'balanced' })` → CRF/preset/AAC più favorevoli alla review.",
  },
  preview_balanced: {
    id: "preview_balanced",
    label: "Preview bilanciata",
    stage: "preview",
    targetResolutionLabel: `~${PREVIEW_CLIP_PROFILE.width}×${PREVIEW_CLIP_PROFILE.height} (review)`,
    qualityPriority: "medium",
    speedPriority: "medium",
    intendedUse: "Validazione immagine + audio + movimento con attenzione maggiore al dettaglio.",
    outputHint:
      "Stesso target tecnico della preview veloce oggi; differenza è guidance utente (meno aggressiva sul «butta via»).",
    previewTier: "balanced",
    engineerNote:
      "TODO pipeline: secondo tier (es. CRF più basso o scala diversa) senza confondere con export finale.",
  },
  final_1080p: {
    id: "final_1080p",
    label: "Final Full HD",
    stage: "final",
    targetResolutionLabel: `${FINAL_RENDER_RESOLUTIONS["1080p"].width}×${FINAL_RENDER_RESOLUTIONS["1080p"].height} (${FINAL_RENDER_RESOLUTIONS["1080p"].label})`,
    qualityPriority: "high",
    speedPriority: "medium",
    intendedUse: "Consegna standard: equilibrio qualità / peso file.",
    outputHint: "Montaggio finale: encode HQ verso 1080p (vedi videoRenderProfiles).",
    mapsToFinalResolutionKey: "1080p",
  },
  final_2k: {
    id: "final_2k",
    label: "Final 2K (QHD)",
    stage: "final",
    targetResolutionLabel: `${FINAL_RENDER_RESOLUTIONS["2k"].width}×${FINAL_RENDER_RESOLUTIONS["2k"].height} (${FINAL_RENDER_RESOLUTIONS["2k"].label})`,
    qualityPriority: "max",
    speedPriority: "low",
    intendedUse: "Schermi grandi e nitidezza extra; file più pesanti.",
    outputHint: FINAL_RENDER_RESOLUTIONS["2k"].note || "2560×1440 QHD.",
    mapsToFinalResolutionKey: "2k",
  },
  final_4k: {
    id: "final_4k",
    label: "Final 4K UHD",
    stage: "final",
    targetResolutionLabel: `${FINAL_RENDER_RESOLUTIONS["4k"].width}×${FINAL_RENDER_RESOLUTIONS["4k"].height} (${FINAL_RENDER_RESOLUTIONS["4k"].label})`,
    qualityPriority: "max",
    speedPriority: "low",
    intendedUse: "Massima risoluzione contenitore; richiede più tempo e risorse.",
    outputHint: "Upscale da clip preview limitato nel dettaglio reale — imposta dopo validazione.",
    mapsToFinalResolutionKey: "4k",
  },
};

/**
 * @param {string} id
 * @returns {AxstudioRenderIntentProfile | null}
 */
export function getRenderIntentProfile(id) {
  const p = AXSTUDIO_RENDER_INTENT_PROFILES[id];
  return p || null;
}

/**
 * @param {string} intentId
 * @returns {{ resolution: '1080p'|'2k'|'4k' } | null}
 */
export function finalResolutionFromRenderIntent(intentId) {
  const p = getRenderIntentProfile(intentId);
  if (!p || p.stage !== "final" || !p.mapsToFinalResolutionKey) return null;
  return { resolution: p.mapsToFinalResolutionKey };
}
