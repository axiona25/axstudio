/**
 * Kling Avatar v2 Pro (fal.ai) — immagine scena + audio → video.
 */

import { falQueueRequest } from "./imagePipeline.js";

export const KLING_AVATAR_V2_PRO_ENDPOINT = "fal-ai/kling-video/ai-avatar/v2/pro";

/**
 * @param {{ imageUrl: string, audioUrl: string, onProgress?: (s: string) => void }} opts
 * @returns {Promise<{ videoUrl: string, raw: object }>}
 */
export async function generateKlingAvatarV2Pro(opts) {
  const imageUrl = String(opts.imageUrl || "").trim();
  const audioUrl = String(opts.audioUrl || "").trim();
  if (!imageUrl) throw new Error("image_url mancante per Kling Avatar.");
  if (!audioUrl) throw new Error("audio_url mancante per Kling Avatar.");

  /** Allineato a queue.fal.run: payload piatto come altri endpoint Kling in App. */
  const payload = {
    image_url: imageUrl,
    audio_url: audioUrl,
  };

  const raw = await falQueueRequest(KLING_AVATAR_V2_PRO_ENDPOINT, payload, opts.onProgress);

  const videoUrl =
    raw?.video?.url ||
    raw?.output?.video?.url ||
    raw?.data?.video?.url ||
    raw?.file_url ||
    null;

  if (!videoUrl || typeof videoUrl !== "string") {
    throw new Error("Kling Avatar v2 Pro: nessun video URL nella risposta fal.ai.");
  }

  return { videoUrl: String(videoUrl).trim(), raw };
}
