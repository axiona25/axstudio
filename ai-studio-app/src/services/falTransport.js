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

/**
 * Saldo crediti account fal (Platform API v1).
 * @returns {Promise<{ ok: true, balance: number, currency: string } | { ok: false, error: string }>}
 */
export async function fetchFalAccountCredits() {
  const key = getFalApiKey();
  if (!String(key).trim()) return { ok: false, error: "no_key" };
  try {
    const res = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", {
      method: "GET",
      headers: {
        Authorization: `Key ${key}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: t || `http_${res.status}` };
    }
    const data = await res.json();
    const c = data?.credits;
    if (!c || typeof c.current_balance !== "number" || Number.isNaN(c.current_balance)) {
      return { ok: false, error: "no_balance" };
    }
    return {
      ok: true,
      balance: c.current_balance,
      currency: typeof c.currency === "string" && c.currency.trim() ? c.currency.trim() : "USD",
    };
  } catch (e) {
    return { ok: false, error: e?.message || "network" };
  }
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
