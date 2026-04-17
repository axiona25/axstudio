/**
 * Trasporto FAL condiviso (sync fal.run + queue.fal.run).
 * Usato da Immagine/Video libero, imagePipeline (Scenografie) e upload satellite.
 */

const FAL_API_KEY = process.env.REACT_APP_FAL_API_KEY || "";

export const FAL_BASE_URL = "https://fal.run";
export const FAL_QUEUE_URL = "https://queue.fal.run";

export function getFalApiKey() {
  return FAL_API_KEY;
}

export async function falRequest(endpoint, payload) {
  const start = Date.now();
  const res = await fetch(`${FAL_BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${FAL_API_KEY}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errBody = await res.text();
    console.error("[FAL]", res.status, errBody);
    throw new Error(errBody);
  }
  const data = await res.json();
  data._latencyMs = Date.now() - start;
  return data;
}

export async function falQueueRequest(endpoint, payload, onProgress) {
  const start = Date.now();
  const submitRes = await fetch(`${FAL_QUEUE_URL}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${FAL_API_KEY}` },
    body: JSON.stringify(payload),
  });
  if (!submitRes.ok) {
    const err = await submitRes.json().catch(() => ({ detail: submitRes.statusText }));
    throw new Error(err.detail || `fal.ai queue submit error ${submitRes.status}`);
  }
  const submitData = await submitRes.json();
  const requestId = submitData.request_id;
  if (!requestId) throw new Error("fal.ai: nessun request_id ricevuto");

  const statusUrl =
    submitData.status_url || `${FAL_QUEUE_URL}/${endpoint}/requests/${requestId}/status`;
  const responseUrl =
    submitData.response_url || `${FAL_QUEUE_URL}/${endpoint}/requests/${requestId}`;

  while (true) {
    await new Promise((r) => setTimeout(r, 3000));
    const statusRes = await fetch(`${statusUrl}?logs=1`, {
      method: "GET",
      headers: { Authorization: `Key ${FAL_API_KEY}` },
    });
    const statusData = await statusRes.json();
    if (onProgress) onProgress(statusData.status);
    if (statusData.status === "COMPLETED") {
      const finalResponseUrl = statusData.response_url || responseUrl;
      const resultRes = await fetch(finalResponseUrl, {
        headers: { Authorization: `Key ${FAL_API_KEY}` },
      });
      const data = await resultRes.json();
      data._latencyMs = Date.now() - start;
      return data;
    }
    if (statusData.status === "FAILED") {
      throw new Error(`fal.ai job failed: ${JSON.stringify(statusData.error || statusData)}`);
    }
  }
}
