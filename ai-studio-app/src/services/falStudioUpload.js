/**
 * Upload immagine su fal storage (Immagine/Video libero).
 */

import { getFalApiKey } from "./falTransport.js";

export async function uploadBase64ToFal(base64DataUrl) {
  const key = getFalApiKey();
  const res = await fetch(base64DataUrl);
  const blob = await res.blob();

  const initRes = await fetch("https://rest.alpha.fal.ai/storage/upload/initiate", {
    method: "POST",
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file_name: "image.png",
      content_type: blob.type || "image/png",
    }),
  });

  if (!initRes.ok) {
    const formData = new FormData();
    formData.append("file", blob, "image.png");
    const fallbackRes = await fetch("https://rest.alpha.fal.ai/storage/upload", {
      method: "POST",
      headers: { Authorization: `Key ${key}` },
      body: formData,
    });
    if (!fallbackRes.ok) throw new Error(`fal.ai upload error ${fallbackRes.status}`);
    const fallbackData = await fallbackRes.json();
    return fallbackData.url || fallbackData.access_url;
  }

  const { upload_url, file_url } = await initRes.json();
  const uploadRes = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": blob.type || "image/png" },
    body: blob,
  });
  if (!uploadRes.ok) throw new Error(`fal.ai presigned upload error ${uploadRes.status}`);
  return file_url;
}
