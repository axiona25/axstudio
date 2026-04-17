/**
 * AXSTUDIO — Verifica concreta dell’output film finale (browser-only, senza backend nuovo).
 * HEAD/GET leggeri dove CORS lo consente; altrimenti probe metadata su <video>.
 * Non sostituisce provider/storage: riduce il gap tra “URL salvato” e “file plausibilmente raggiungibile”.
 */

/** Stato persistito / logico */
export const OUTPUT_VERIFICATION_STATUS = {
  NEVER: "never",
  OK: "ok",
  FAILED: "failed",
  NOT_VERIFIABLE: "not_verifiable",
  TIMEOUT: "timeout",
};

/** Durata in cui una verifica positiva conta come “fresca” per la UI */
export const OUTPUT_VERIFICATION_FRESH_MS = 24 * 60 * 60 * 1000;

const VIDEO_CT_RE = /^video\//i;
const OK_CT_RE = /^(video\/|application\/octet-stream|binary)/i;

function isoNow() {
  return new Date().toISOString();
}

function trimUrl(u) {
  return u != null && String(u).trim() ? String(u).trim() : "";
}

/**
 * @param {string|null|undefined} checkedAtIso
 * @param {number} [freshMs]
 */
export function isOutputVerificationFresh(checkedAtIso, freshMs = OUTPUT_VERIFICATION_FRESH_MS) {
  if (!checkedAtIso) return false;
  const t = Date.parse(String(checkedAtIso));
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < freshMs;
}

/**
 * @param {object} result
 * @param {string} sourceUrl
 * @returns {object}
 */
export function buildPersistedFilmOutputVerification(result, sourceUrl) {
  const r = result && typeof result === "object" ? result : {};
  return {
    outputVerificationStatus: r.status || OUTPUT_VERIFICATION_STATUS.FAILED,
    outputVerificationMethod: r.method || "unknown",
    outputVerificationCheckedAt: r.checkedAt || isoNow(),
    outputVerificationError: r.errorUser != null ? String(r.errorUser) : null,
    outputVerificationSourceUrl: trimUrl(sourceUrl) || null,
    outputVerificationHttpStatus: r.httpStatus != null ? r.httpStatus : null,
    outputVerificationContentType: r.contentType != null ? String(r.contentType) : null,
  };
}

/**
 * @param {unknown} raw
 * @returns {object|null}
 */
export function readFilmOutputVerificationFromWorkspace(ws) {
  const w = ws && typeof ws === "object" ? ws : {};
  const v = w.filmOutputVerification;
  if (!v || typeof v !== "object") return null;
  return v;
}

/**
 * Effetto verifica rispetto all’URL attuale di consegna.
 * @param {object|null} stored — filmOutputVerification sul workspace
 * @param {string|null} completedFilmUrl — URL sintesi attuale
 */
export function computeFilmVerificationEffective(stored, completedFilmUrl) {
  const cur = trimUrl(completedFilmUrl);
  if (!cur) {
    return {
      kind: "no_url",
      status: OUTPUT_VERIFICATION_STATUS.NEVER,
      isFresh: false,
      userLineIt: null,
      headlineModifier: null,
    };
  }
  if (!stored || typeof stored !== "object") {
    return {
      kind: "never_checked",
      status: OUTPUT_VERIFICATION_STATUS.NEVER,
      isFresh: false,
      userLineIt: "Non è ancora stata eseguita una verifica rete/player su questo file.",
      headlineModifier: "non_verificato",
    };
  }
  const src = stored.outputVerificationSourceUrl != null ? trimUrl(stored.outputVerificationSourceUrl) : "";
  if (src && src !== cur) {
    return {
      kind: "stale_url",
      status: OUTPUT_VERIFICATION_STATUS.NEVER,
      isFresh: false,
      userLineIt: "Il link del film è cambiato dopo l’ultima verifica: esegui di nuovo «Verifica file finale».",
      headlineModifier: "verifica_obsoleta",
    };
  }
  const st = String(stored.outputVerificationStatus || "").trim() || OUTPUT_VERIFICATION_STATUS.NEVER;
  const checkedAt = stored.outputVerificationCheckedAt != null ? String(stored.outputVerificationCheckedAt) : null;
  const fresh = isOutputVerificationFresh(checkedAt);
  const err = stored.outputVerificationError != null ? String(stored.outputVerificationError).trim() : "";

  if (st === OUTPUT_VERIFICATION_STATUS.OK) {
    return {
      kind: fresh ? "verified_ok_fresh" : "verified_ok_stale_check",
      status: st,
      isFresh: fresh,
      checkedAt,
      method: stored.outputVerificationMethod != null ? String(stored.outputVerificationMethod) : null,
      userLineIt: fresh
        ? "Ultima verifica riuscita: il file risponde (rete o lettore) in modo coerente."
        : "Verifica riuscita in passato; è consigliabile ripeterla se il film non si apre.",
      headlineModifier: fresh ? "verificato" : "verificato_non_fresco",
    };
  }
  if (st === OUTPUT_VERIFICATION_STATUS.NOT_VERIFIABLE) {
    return {
      kind: "not_verifiable",
      status: st,
      isFresh: fresh,
      checkedAt,
      method: stored.outputVerificationMethod != null ? String(stored.outputVerificationMethod) : null,
      userLineIt:
        "Da questo browser AXSTUDIO non può verificare il link (es. CORS). Usa «Apri in nuova scheda» o il player di sistema.",
      headlineModifier: "non_verificabile",
    };
  }
  if (st === OUTPUT_VERIFICATION_STATUS.TIMEOUT) {
    return {
      kind: "timeout",
      status: st,
      isFresh: false,
      checkedAt,
      method: stored.outputVerificationMethod != null ? String(stored.outputVerificationMethod) : null,
      userLineIt: err || "Timeout durante la verifica: rete lenta o host non risponde.",
      headlineModifier: "verifica_fallita",
    };
  }
  if (st === OUTPUT_VERIFICATION_STATUS.FAILED) {
    return {
      kind: "failed",
      status: st,
      isFresh: false,
      checkedAt,
      method: stored.outputVerificationMethod != null ? String(stored.outputVerificationMethod) : null,
      userLineIt: err || "Ultima verifica non è riuscita: il file potrebbe essere scaduto o non raggiungibile.",
      headlineModifier: "verifica_fallita",
    };
  }
  return {
    kind: "never_checked",
    status: OUTPUT_VERIFICATION_STATUS.NEVER,
    isFresh: false,
    userLineIt: "Non è ancora stata eseguita una verifica su questo file.",
    headlineModifier: "non_verificato",
  };
}

function contentTypeLooksLikeMedia(ct) {
  const s = ct != null ? String(ct).trim() : "";
  if (!s) return true;
  return OK_CT_RE.test(s) || VIDEO_CT_RE.test(s);
}

/**
 * @param {string} url
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [opts]
 * @returns {Promise<{ status: string, method: string, checkedAt: string, errorUser?: string, httpStatus?: number, contentType?: string }>}
 */
export async function verifyFinalOutputUrl(url, opts = {}) {
  const u = trimUrl(url);
  const checkedAt = isoNow();
  const timeoutMs = typeof opts.timeoutMs === "number" && opts.timeoutMs > 0 ? opts.timeoutMs : 12000;
  if (!u) {
    return {
      status: OUTPUT_VERIFICATION_STATUS.FAILED,
      method: "none",
      checkedAt,
      errorUser: "Nessun indirizzo del file da verificare.",
    };
  }
  if (u.startsWith("blob:") || u.startsWith("data:")) {
    return { status: OUTPUT_VERIFICATION_STATUS.OK, method: "local_url", checkedAt };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const signal = opts.signal ? mergeAbortSignals(opts.signal, ctrl.signal) : ctrl.signal;

  let fetchError = null;

  try {
    const head = await fetch(u, { method: "HEAD", mode: "cors", cache: "no-store", signal });
    if (head.ok) {
      const ct = head.headers.get("Content-Type") || "";
      if (contentTypeLooksLikeMedia(ct)) {
        clearTimeout(t);
        return {
          status: OUTPUT_VERIFICATION_STATUS.OK,
          method: "http_head",
          checkedAt: isoNow(),
          httpStatus: head.status,
          contentType: ct || null,
        };
      }
      clearTimeout(t);
      return {
        status: OUTPUT_VERIFICATION_STATUS.OK,
        method: "http_head",
        checkedAt: isoNow(),
        httpStatus: head.status,
        contentType: ct || null,
      };
    }
    if (head.status === 403 || head.status === 404) {
      clearTimeout(t);
      return {
        status: OUTPUT_VERIFICATION_STATUS.FAILED,
        method: "http_head",
        checkedAt: isoNow(),
        httpStatus: head.status,
        errorUser: `Il server ha risposto ${head.status}: il file potrebbe essere stato rimosso o non è più accessibile.`,
      };
    }
  } catch (e) {
    fetchError = e;
  }

  try {
    const get = await fetch(u, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      signal,
      headers: { Range: "bytes=0-0" },
    });
    if (get.ok || get.status === 206) {
      const ct = get.headers.get("Content-Type") || "";
      clearTimeout(t);
      return {
        status: OUTPUT_VERIFICATION_STATUS.OK,
        method: "http_get_range",
        checkedAt: isoNow(),
        httpStatus: get.status,
        contentType: ct || null,
      };
    }
    if (get.status === 403 || get.status === 404) {
      clearTimeout(t);
      return {
        status: OUTPUT_VERIFICATION_STATUS.FAILED,
        method: "http_get_range",
        checkedAt: isoNow(),
        httpStatus: get.status,
        errorUser: `Il server ha risposto ${get.status}: il file potrebbe non essere più disponibile.`,
      };
    }
  } catch (e) {
    fetchError = fetchError || e;
  }

  const videoProbe = await probeVideoMetadata(u, Math.min(8000, timeoutMs), signal);
  clearTimeout(t);

  if (videoProbe.ok) {
    return {
      status: OUTPUT_VERIFICATION_STATUS.OK,
      method: "video_metadata",
      checkedAt: isoNow(),
    };
  }

  if (videoProbe.reason === "timeout") {
    return {
      status: OUTPUT_VERIFICATION_STATUS.TIMEOUT,
      method: "video_metadata",
      checkedAt: isoNow(),
      errorUser: "Timeout: il file non ha caricato metadati in tempo.",
    };
  }

  if (fetchError && (fetchError.name === "TypeError" || /Failed to fetch/i.test(String(fetchError.message || "")))) {
    return {
      status: OUTPUT_VERIFICATION_STATUS.NOT_VERIFIABLE,
      method: "fetch_blocked",
      checkedAt: isoNow(),
      errorUser:
        "Il browser non consente una verifica diretta (rete/CORS). Il file potrebbe comunque aprirsi in nuova scheda o in un altro player.",
    };
  }

  return {
    status: OUTPUT_VERIFICATION_STATUS.FAILED,
    method: "video_metadata",
    checkedAt: isoNow(),
    errorUser: "Il lettore non è riuscito a leggere i metadati del video: link scaduto, formato non supportato o blocco rete.",
  };
}

/**
 * @param {AbortSignal} a
 * @param {AbortSignal} b
 */
function mergeAbortSignals(a, b) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return AbortSignal.any([a, b]);
  }
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (a.aborted) {
    ctrl.abort();
    return ctrl.signal;
  }
  if (b.aborted) {
    ctrl.abort();
    return ctrl.signal;
  }
  a.addEventListener("abort", onAbort);
  b.addEventListener("abort", onAbort);
  return ctrl.signal;
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 * @param {AbortSignal} signal
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
function probeVideoMetadata(url, timeoutMs, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, reason: "aborted" });
      return;
    }
    const v = typeof document !== "undefined" ? document.createElement("video") : null;
    if (!v) {
      resolve({ ok: false, reason: "no_document" });
      return;
    }
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      try {
        v.removeAttribute("src");
        v.load();
      } catch {
        /* ignore */
      }
      resolve(payload);
    };

    const tid = setTimeout(() => finish({ ok: false, reason: "timeout" }), timeoutMs);
    const onAbort = () => {
      clearTimeout(tid);
      finish({ ok: false, reason: "aborted" });
    };
    signal?.addEventListener("abort", onAbort);

    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    v.onloadedmetadata = () => {
      clearTimeout(tid);
      signal?.removeEventListener("abort", onAbort);
      finish({ ok: true });
    };
    v.onerror = () => {
      clearTimeout(tid);
      signal?.removeEventListener("abort", onAbort);
      finish({ ok: false, reason: "error" });
    };
    v.src = url;
  });
}
