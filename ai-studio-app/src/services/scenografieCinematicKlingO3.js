/**
 * Scenografie — Kling O3 reference-to-video (image + prompt) per clip cinematic / narrati.
 * Isolato da App.js (Video libero); stesso endpoint già usato nel free studio.
 */

import { falQueueRequest } from "./falTransport.js";

export const KLING_O3_REFERENCE_TO_VIDEO_ENDPOINT = "fal-ai/kling-video/o3/pro/reference-to-video";

const MAX_PROMPT = 2400;

/**
 * @param {object} strategy — output computeVideoExecutionStrategy
 * @param {object|null} compiledCreativeIntent
 */
export function buildScenografieCinematicPrompt(strategy, compiledCreativeIntent) {
  const s = strategy && typeof strategy === "object" ? strategy : {};
  const v = s.resolvedVisualPlan && typeof s.resolvedVisualPlan === "object" ? s.resolvedVisualPlan : {};
  const shot = s.resolvedShotPlan && typeof s.resolvedShotPlan === "object" ? s.resolvedShotPlan : {};
  const motion = s.resolvedMotionPlan && typeof s.resolvedMotionPlan === "object" ? s.resolvedMotionPlan : {};
  const cr = compiledCreativeIntent && typeof compiledCreativeIntent === "object" ? compiledCreativeIntent : {};

  const parts = [];
  if (v.directionPromptResolved) parts.push(String(v.directionPromptResolved));
  if (v.visualGoal) parts.push(`Visual goal: ${v.visualGoal}`);
  if (v.emotionalTone) parts.push(`Tone: ${v.emotionalTone}`);
  if (shot.shotType) parts.push(`Shot: ${shot.shotType}`);
  if (shot.openingStyle) parts.push(`Opening: ${shot.openingStyle}`);
  if (shot.closingStyle) parts.push(`Closing: ${shot.closingStyle}`);
  if (motion.cameraMotion) {
    parts.push(
      `Camera motion: ${motion.cameraMotion}${motion.cameraIntensity ? ` (${motion.cameraIntensity})` : ""}`,
    );
  }
  if (motion.progressionNote) parts.push(`Progression: ${motion.progressionNote}`);
  if (cr.whatMustBeSeen) parts.push(`Must see: ${cr.whatMustBeSeen}`);
  if (cr.narrativeGoal) parts.push(`Narrative: ${cr.narrativeGoal}`);
  parts.push(
    "Cinematic shot motion from the reference frame. No lip-sync or dialogue-driven mouth animation; environment and camera movement take priority.",
  );
  let prompt = parts.filter(Boolean).join(". ");
  if (prompt.length > MAX_PROMPT) prompt = prompt.slice(0, MAX_PROMPT - 3) + "...";
  return prompt;
}

/**
 * Durata API Kling (secondi interi, allineato a App.js: 5–15).
 * @param {number|null|undefined} audioDurationSec
 */
export function pickKlingO3DurationSec(audioDurationSec) {
  const d =
    typeof audioDurationSec === "number" && Number.isFinite(audioDurationSec) && audioDurationSec > 0
      ? audioDurationSec
      : 8;
  return Math.min(15, Math.max(5, Math.round(d)));
}

/**
 * @param {object} opts
 * @param {string} opts.imageUrl
 * @param {string} opts.prompt
 * @param {number} opts.durationSec
 * @param {string} [opts.aspectRatio]
 * @param {string} [opts.negativePrompt]
 * @param {(s: string) => void} [opts.onProgress]
 */
export async function generateKlingO3ReferenceToVideo(opts) {
  const imageUrl = String(opts.imageUrl || "").trim();
  const prompt = String(opts.prompt || "").trim();
  if (!imageUrl) throw new Error("Kling O3: image_url mancante.");
  if (!prompt) throw new Error("Kling O3: prompt mancante.");

  const durationSec = opts.durationSec;
  const aspectRatio = String(opts.aspectRatio || "16:9").trim() || "16:9";
  const neg = opts.negativePrompt != null ? String(opts.negativePrompt).trim() : "";

  const payload = {
    prompt,
    start_image_url: imageUrl,
    duration: String(durationSec),
    aspect_ratio: aspectRatio,
    cfg_scale: 0.5,
    character_orientation: durationSec > 10 ? "video" : "image",
    generate_audio: false,
    ...(neg ? { negative_prompt: neg.slice(0, MAX_PROMPT) } : {}),
  };

  const raw = await falQueueRequest(KLING_O3_REFERENCE_TO_VIDEO_ENDPOINT, payload, opts.onProgress);
  const videoUrl =
    raw?.video?.url || raw?.output?.video?.url || raw?.data?.video?.url || raw?.file_url || null;
  if (!videoUrl || typeof videoUrl !== "string") {
    throw new Error("Kling O3 reference-to-video: nessun video URL nella risposta.");
  }
  return { videoUrl: String(videoUrl).trim(), raw };
}
