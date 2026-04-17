/**
 * AXSTUDIO — Consumer reliability (Fase 1): stati semantici, errori strutturati, sintesi film/indice.
 * Non sostituisce i provider; arricchisce payload e UI con segnali espliciti per utenti non tecnici.
 */

/** @typedef {'draft'|'planned'|'ready'|'processing'|'completed'|'completed_with_warnings'|'failed'|'failed_recoverable'|'missing_output'|'degraded'} ConsumerWorkflowSemantic */

/** Fasi tecniche per diagnostica / log. */
export const WORKFLOW_ERROR_STAGE = {
  CLIP_PIPELINE: "clip_pipeline",
  CLIP_MUX: "clip_mux",
  CLIP_PROVIDER_FAL: "clip_provider_fal",
  CLIP_PROVIDER_ELEVEN: "clip_provider_eleven",
  MONTAGE_VALIDATE: "montage_validate",
  MONTAGE_RENDER: "montage_render",
  MONTAGE_UPLOAD: "montage_upload",
  FILM_INDEX: "film_index",
  STORY_WIZARD_COMMIT: "story_wizard_commit",
  NARRATOR_RESOLVE: "narrator_resolve",
  PROVIDER_OPENROUTER: "provider_openrouter",
  UNKNOWN: "unknown",
};

/** Azioni suggerite (UI mappa su etichette italiane). */
export const SUGGESTED_ACTION = {
  RETRY: "retry",
  REGENERATE_CLIP: "regenerate_clip",
  OPEN_PROJECT: "open_project",
  OPEN_CLIP: "open_clip",
  GO_BACK: "go_back",
  OUTPUT_UNAVAILABLE: "output_unavailable",
  RECOMPUTE_STATUS: "recompute_status",
  CHECK_API_KEYS: "check_api_keys",
};

const STRUCTURED_KEYS = [
  "errorCode",
  "errorStage",
  "errorMessageUser",
  "errorMessageTechnical",
  "isRecoverable",
  "suggestedAction",
  "at",
];

/**
 * @param {unknown} raw
 * @returns {object|null}
 */
export function sanitizeStructuredWorkflowFailure(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const k of STRUCTURED_KEYS) {
    if (raw[k] != null && raw[k] !== "") out[k] = raw[k];
  }
  if (!out.errorMessageUser && !out.errorCode) return null;
  return out;
}

/**
 * @param {object} p
 * @returns {object}
 */
export function buildStructuredWorkflowFailure(p) {
  const at = p.at || new Date().toISOString();
  return sanitizeStructuredWorkflowFailure({
    errorCode: p.errorCode || "WORKFLOW_ERROR",
    errorStage: p.errorStage || WORKFLOW_ERROR_STAGE.UNKNOWN,
    errorMessageUser: p.errorMessageUser || "Operazione non riuscita.",
    errorMessageTechnical: p.errorMessageTechnical != null ? String(p.errorMessageTechnical) : "",
    isRecoverable: p.isRecoverable !== false,
    suggestedAction: p.suggestedAction || SUGGESTED_ACTION.RETRY,
    at,
  });
}

/**
 * Mappa stato hub legacy → semantica consumer (indice / diagnostica).
 * @param {string} uiStatus
 * @returns {ConsumerWorkflowSemantic}
 */
export function consumerPhaseFromScenografiaUiStatus(uiStatus) {
  const u = String(uiStatus || "").trim();
  switch (u) {
    case "planning":
      return "draft";
    case "character_approval":
    case "scene_approval":
    case "clip_approval":
    case "timeline_approval":
      return "processing";
    case "final_film_ready":
      return "ready";
    case "video_production":
    case "final_montage":
      return "processing";
    case "completed":
      return "completed";
    default:
      return "planned";
  }
}

/** @type {Record<string, string>} */
export const SUGGESTED_ACTION_LABEL_IT = {
  [SUGGESTED_ACTION.RETRY]: "Riprova",
  [SUGGESTED_ACTION.REGENERATE_CLIP]: "Rigenera clip",
  [SUGGESTED_ACTION.OPEN_PROJECT]: "Apri progetto",
  [SUGGESTED_ACTION.OPEN_CLIP]: "Apri clip",
  [SUGGESTED_ACTION.GO_BACK]: "Torna indietro",
  [SUGGESTED_ACTION.OUTPUT_UNAVAILABLE]: "Output non disponibile",
  [SUGGESTED_ACTION.RECOMPUTE_STATUS]: "Ricalcola stato",
  [SUGGESTED_ACTION.CHECK_API_KEYS]: "Controlla chiavi API",
};

/**
 * Livello di affidabilità del file film (non verifica HTTP reale in Fase 1).
 */
export const FILM_OUTPUT_READINESS = {
  /** URL salvato + montaggio `complete` + fase capitolo `done` — miglior caso indicizzato. */
  PLAYABLE: "playable",
  /** URL presente e montaggio ok ma fase non segnata done (o incoerenza minore). */
  URL_STALE_PHASE: "url_stale_phase",
  /** Completato lato UI ma nessun URL in archivio. */
  MISSING_OUTPUT: "missing_output",
  /** Montaggio segnalato fallito. */
  MONTAGE_FAILED: "montage_failed",
  /** Render o compile in corso. */
  IN_PROGRESS: "in_progress",
  /** Completato con avvisi esecuzione piano. */
  DEGRADED: "degraded",
  /** URL presente: playback va verificato al player (CDN / scadenza). */
  UNVERIFIED_URL: "unverified_url",
};

/**
 * Fiducia nel file / URL (senza HEAD HTTP; usa solo metadati salvati).
 */
export const FILM_OUTPUT_TRUST = {
  MISSING: "missing",
  /** Render `complete` + URL + timestamp ultimo successo noto. */
  LAST_SUCCESS_KNOWN: "last_success_known",
  /** URL con montaggio non allineato (idle/ready) o incoerenza di fase. */
  UNVERIFIED: "unverified",
  /** Piano con avvisi esecuzione. */
  DEGRADED_PLAN: "degraded_plan",
  FAILED: "failed",
  PENDING: "pending",
};

/** Stato consegna film a livello workspace (multi-capitolo incluso). */
export const FILM_DELIVERY_STATE = {
  NOT_READY: "not_ready",
  MONTAGE_IN_PROGRESS: "montage_in_progress",
  MONTAGE_FAILED: "montage_failed",
  DELIVERED_WATCHABLE: "delivered_watchable",
  DELIVERED_FRAGILE: "delivered_fragile",
  DELIVERED_UNVERIFIED: "delivered_unverified",
  DELIVERED_MISSING_OUTPUT: "delivered_missing_output",
  MULTI_CHAPTER_NO_CONSOLIDATED: "multi_chapter_no_consolidated",
};

/** @type {Record<string, string>} */
export const FILM_DELIVERY_LABEL_IT = {
  [FILM_DELIVERY_STATE.NOT_READY]: "Film non ancora pronto",
  [FILM_DELIVERY_STATE.MONTAGE_IN_PROGRESS]: "Montaggio in corso · da verificare",
  [FILM_DELIVERY_STATE.MONTAGE_FAILED]: "Da rigenerare · montaggio non riuscito",
  [FILM_DELIVERY_STATE.DELIVERED_WATCHABLE]: "Pronto da guardare",
  [FILM_DELIVERY_STATE.DELIVERED_FRAGILE]: "Probabilmente pronto · con avvisi",
  [FILM_DELIVERY_STATE.DELIVERED_UNVERIFIED]: "Da verificare · file salvato",
  [FILM_DELIVERY_STATE.DELIVERED_MISSING_OUTPUT]: "Non disponibile · senza file film",
  [FILM_DELIVERY_STATE.MULTI_CHAPTER_NO_CONSOLIDATED]: "Da verificare · più capitoli da allineare",
};

/** @type {Record<string, string>} */
export const FILM_OUTPUT_TRUST_LABEL_IT = {
  [FILM_OUTPUT_TRUST.MISSING]: "Nessun file noto",
  [FILM_OUTPUT_TRUST.LAST_SUCCESS_KNOWN]: "Ultimo render riuscito registrato",
  [FILM_OUTPUT_TRUST.UNVERIFIED]: "Link salvato · stato non allineato",
  [FILM_OUTPUT_TRUST.DEGRADED_PLAN]: "Render ok · piano con avvisi",
  [FILM_OUTPUT_TRUST.FAILED]: "Ultimo tentativo fallito",
  [FILM_OUTPUT_TRUST.PENDING]: "In corso o in attesa",
};

/**
 * @param {string} readiness
 * @param {string|null} url
 * @param {boolean} hasExecutionWarnings
 * @param {string} montageStatus
 * @param {string} fmp
 * @returns {string}
 */
export function inferFilmOutputTrust(readiness, url, hasExecutionWarnings, montageStatus, fmp) {
  const st = String(montageStatus || "idle").trim();
  const phase = String(fmp || "none").trim();
  if (!url) return FILM_OUTPUT_TRUST.MISSING;
  if (st === "failed") return FILM_OUTPUT_TRUST.FAILED;
  if (st === "rendering" || st === "compiling") return FILM_OUTPUT_TRUST.PENDING;
  if (readiness === FILM_OUTPUT_READINESS.DEGRADED || hasExecutionWarnings) return FILM_OUTPUT_TRUST.DEGRADED_PLAN;
  if (readiness === FILM_OUTPUT_READINESS.PLAYABLE && st === "complete" && phase === "done") {
    return FILM_OUTPUT_TRUST.LAST_SUCCESS_KNOWN;
  }
  if (readiness === FILM_OUTPUT_READINESS.PLAYABLE && st === "complete") {
    return FILM_OUTPUT_TRUST.LAST_SUCCESS_KNOWN;
  }
  if (
    readiness === FILM_OUTPUT_READINESS.URL_STALE_PHASE ||
    readiness === FILM_OUTPUT_READINESS.UNVERIFIED_URL ||
    st === "idle" ||
    st === "ready"
  ) {
    return FILM_OUTPUT_TRUST.UNVERIFIED;
  }
  return FILM_OUTPUT_TRUST.UNVERIFIED;
}

/**
 * Heuristica URL “probabilmente locale / blob” vs remoto.
 * @param {string|null} url
 * @returns {'blob'|'data'|'remote'|'unknown'}
 */
export function classifyFilmOutputUrlKind(url) {
  const u = url != null ? String(url).trim() : "";
  if (!u) return "unknown";
  if (u.startsWith("blob:")) return "blob";
  if (u.startsWith("data:")) return "data";
  if (/^https?:\/\//i.test(u)) return "remote";
  return "unknown";
}

/**
 * @param {object} chapterData — payload capitolo (plan, finalFilmMontage, …)
 * @returns {{ readiness: string, outputUrl: string|null, userHint: string, lastWorkflowFailure: object|null, hasExecutionWarnings: boolean, outputTrust: string, outputRecordedAt: string|null, renderModeHint: string|null, outputUrlKind: string }}
 */
export function deriveFilmOutputReadinessFromChapterData(chapterData) {
  const d = chapterData && typeof chapterData === "object" ? chapterData : {};
  const fmRaw = d.finalFilmMontage;
  const fm = fmRaw && typeof fmRaw === "object" ? fmRaw : null;
  const fmp = String(d.finalMontagePhase || "none").trim();
  const montageStatus = fm ? String(fm.status || "idle").trim() : "idle";
  const url = fm?.outputUrl != null && String(fm.outputUrl).trim() ? String(fm.outputUrl).trim() : null;
  const outputRecordedAt =
    fm?.outputUrlSetAt != null && String(fm.outputUrlSetAt).trim()
      ? String(fm.outputUrlSetAt).trim()
      : fm?.lastRenderCompletedAt != null && String(fm.lastRenderCompletedAt).trim()
        ? String(fm.lastRenderCompletedAt).trim()
        : null;
  const renderModeHint =
    fm?.lastRenderSummary?.renderModeUsed != null && String(fm.lastRenderSummary.renderModeUsed).trim()
      ? String(fm.lastRenderSummary.renderModeUsed).trim()
      : fm?.montageExecutionPlan?.renderModePreference != null &&
          String(fm.montageExecutionPlan.renderModePreference).trim()
        ? String(fm.montageExecutionPlan.renderModePreference).trim()
        : null;
  const warningsLen = Array.isArray(fm?.compiledMontagePlan?.executionWarnings)
    ? fm.compiledMontagePlan.executionWarnings.length
    : 0;
  const hasExecutionWarnings = warningsLen > 0;
  const lastWf = sanitizeStructuredWorkflowFailure(fm?.lastWorkflowFailure) || null;
  const outputUrlKind = classifyFilmOutputUrlKind(url);

  const finish = (partial) => {
    const readiness = partial.readiness;
    const trust = inferFilmOutputTrust(
      readiness,
      partial.outputUrl != null ? partial.outputUrl : url,
      partial.hasExecutionWarnings ?? hasExecutionWarnings,
      montageStatus,
      fmp,
    );
    return {
      ...partial,
      outputTrust: partial.outputTrust != null ? partial.outputTrust : trust,
      outputRecordedAt: partial.outputRecordedAt != null ? partial.outputRecordedAt : outputRecordedAt,
      renderModeHint: partial.renderModeHint != null ? partial.renderModeHint : renderModeHint,
      outputUrlKind: partial.outputUrlKind != null ? partial.outputUrlKind : outputUrlKind,
    };
  };

  if (montageStatus === "failed") {
    return finish({
      readiness: FILM_OUTPUT_READINESS.MONTAGE_FAILED,
      outputUrl: url,
      userHint: "Il montaggio finale non è riuscito. Apri il progetto e riprova il render.",
      lastWorkflowFailure: lastWf,
      hasExecutionWarnings,
      outputTrust: FILM_OUTPUT_TRUST.FAILED,
    });
  }
  if (montageStatus === "rendering" || montageStatus === "compiling") {
    return finish({
      readiness: FILM_OUTPUT_READINESS.IN_PROGRESS,
      outputUrl: url,
      userHint: "Montaggio in corso: attendi il completamento nello strumento Scenografie.",
      lastWorkflowFailure: null,
      hasExecutionWarnings,
      outputTrust: FILM_OUTPUT_TRUST.PENDING,
    });
  }

  const uiCompleted =
    fmp === "done" || d.scenografiaVideoPhase === "completed" || String(d.finalMontagePhase || "") === "done";

  if (montageStatus === "complete" && url) {
    if (hasExecutionWarnings) {
      return finish({
        readiness: FILM_OUTPUT_READINESS.DEGRADED,
        outputUrl: url,
        userHint: "Film pronto ma con avvisi sul piano (controlla il montaggio nel capitolo).",
        lastWorkflowFailure: null,
        hasExecutionWarnings: true,
      });
    }
    if (fmp === "done") {
      return finish({
        readiness: FILM_OUTPUT_READINESS.PLAYABLE,
        outputUrl: url,
        userHint: "Film salvato. La riproduzione dipende dal link remoto: se non si apre, rigenera il montaggio.",
        lastWorkflowFailure: null,
        hasExecutionWarnings: false,
      });
    }
    return finish({
      readiness: FILM_OUTPUT_READINESS.URL_STALE_PHASE,
      outputUrl: url,
      userHint: "C’è un file film ma il capitolo non risulta chiuso al 100%: apri Scenografie per confermare.",
      lastWorkflowFailure: null,
      hasExecutionWarnings: false,
    });
  }

  if (montageStatus === "complete" && !url) {
    return finish({
      readiness: FILM_OUTPUT_READINESS.MISSING_OUTPUT,
      outputUrl: null,
      userHint: "Montaggio segnato completo ma senza URL file: rigenera il filmato finale.",
      lastWorkflowFailure: lastWf,
      hasExecutionWarnings,
    });
  }

  if (uiCompleted && !url) {
    return finish({
      readiness: FILM_OUTPUT_READINESS.MISSING_OUTPUT,
      outputUrl: null,
      userHint: "Progetto completato ma nessun file film in archivio.",
      lastWorkflowFailure: lastWf,
      hasExecutionWarnings,
    });
  }

  if (url && (montageStatus === "ready" || montageStatus === "idle")) {
    return finish({
      readiness: FILM_OUTPUT_READINESS.UNVERIFIED_URL,
      outputUrl: url,
      userHint: "Link film presente ma stato montaggio non aggiornato.",
      lastWorkflowFailure: null,
      hasExecutionWarnings,
    });
  }

  return finish({
    readiness: FILM_OUTPUT_READINESS.MISSING_OUTPUT,
    outputUrl: null,
    userHint: "Nessun film finale disponibile per questo capitolo.",
    lastWorkflowFailure: null,
    hasExecutionWarnings,
  });
}

function chapterWorkflowClosed(chapterData) {
  const d = chapterData && typeof chapterData === "object" ? chapterData : {};
  const fmp = String(d.finalMontagePhase || "none").trim();
  const vp = String(d.scenografiaVideoPhase || "none").trim();
  return fmp === "done" || vp === "completed";
}

/**
 * @param {Array<{ id?: string, data?: object }>} chaptersSorted
 * @param {Array<object>} roll — stesso ordine dei capitoli
 * @param {number} pickedIdx
 * @param {string|null} pickedUrl
 */
function pickPrimaryChapterIdForFilmRecovery(chaptersSorted, roll, pickedIdx, pickedUrl) {
  const list = Array.isArray(chaptersSorted) ? chaptersSorted : [];
  const safeRoll = Array.isArray(roll) ? roll : [];
  const idAt = (i) => {
    if (i < 0 || i >= list.length) return null;
    const id = list[i]?.id;
    return id != null && String(id).trim() ? String(id).trim() : null;
  };
  for (let i = 0; i < safeRoll.length; i++) {
    if (safeRoll[i]?.readiness === FILM_OUTPUT_READINESS.MONTAGE_FAILED) return idAt(i);
  }
  for (let i = 0; i < safeRoll.length; i++) {
    if (safeRoll[i]?.readiness === FILM_OUTPUT_READINESS.IN_PROGRESS) return idAt(i);
  }
  if (pickedIdx >= 0) {
    const id = idAt(pickedIdx);
    if (id) return id;
  }
  let bestTs = "";
  let bestId = null;
  for (let i = 0; i < list.length; i++) {
    const fm = list[i]?.data?.finalFilmMontage;
    const ts =
      fm?.lastRenderCompletedAt != null && String(fm.lastRenderCompletedAt).trim()
        ? String(fm.lastRenderCompletedAt).trim()
        : fm?.outputUrlSetAt != null && String(fm.outputUrlSetAt).trim()
          ? String(fm.outputUrlSetAt).trim()
          : "";
    if (ts && ts >= bestTs) {
      bestTs = ts;
      bestId = idAt(i);
    }
  }
  if (bestId) return bestId;
  if (pickedUrl) {
    for (let i = 0; i < safeRoll.length; i++) {
      if (safeRoll[i]?.outputUrl === pickedUrl) return idAt(i);
    }
  }
  for (let i = 0; i < safeRoll.length; i++) {
    if (safeRoll[i]?.readiness === FILM_OUTPUT_READINESS.MISSING_OUTPUT && chapterWorkflowClosed(list[i]?.data || {})) {
      return idAt(i);
    }
  }
  return idAt(0);
}

/**
 * @param {object} p
 */
function computeFilmDeliveryState(p) {
  const {
    chaptersCount,
    completedFilmUrl,
    filmOutputReadiness,
    roll,
    anyMontageFailed,
    anyInProgress,
    consolidatedChapterCount,
    playableChapterCount,
  } = p;

  if (!chaptersCount) return FILM_DELIVERY_STATE.NOT_READY;
  if (anyInProgress) return FILM_DELIVERY_STATE.MONTAGE_IN_PROGRESS;
  if (completedFilmUrl && filmOutputReadiness === FILM_OUTPUT_READINESS.PLAYABLE) {
    if (chaptersCount > 1 && consolidatedChapterCount === 0 && playableChapterCount > 0) {
      return FILM_DELIVERY_STATE.MULTI_CHAPTER_NO_CONSOLIDATED;
    }
    return FILM_DELIVERY_STATE.DELIVERED_WATCHABLE;
  }
  if (completedFilmUrl && filmOutputReadiness === FILM_OUTPUT_READINESS.DEGRADED) {
    return FILM_DELIVERY_STATE.DELIVERED_FRAGILE;
  }
  if (
    completedFilmUrl &&
    (filmOutputReadiness === FILM_OUTPUT_READINESS.URL_STALE_PHASE ||
      filmOutputReadiness === FILM_OUTPUT_READINESS.UNVERIFIED_URL)
  ) {
    return FILM_DELIVERY_STATE.DELIVERED_UNVERIFIED;
  }
  if (anyMontageFailed && !completedFilmUrl) return FILM_DELIVERY_STATE.MONTAGE_FAILED;
  if (!completedFilmUrl && filmOutputReadiness === FILM_OUTPUT_READINESS.MISSING_OUTPUT) {
    const anyUrlSomewhere = roll.some((r) => r.outputUrl);
    if (chaptersCount > 1 && anyUrlSomewhere) return FILM_DELIVERY_STATE.MULTI_CHAPTER_NO_CONSOLIDATED;
    return FILM_DELIVERY_STATE.DELIVERED_MISSING_OUTPUT;
  }
  if (chaptersCount > 1 && playableChapterCount > 1 && !completedFilmUrl) {
    return FILM_DELIVERY_STATE.MULTI_CHAPTER_NO_CONSOLIDATED;
  }
  if (anyMontageFailed) return FILM_DELIVERY_STATE.MONTAGE_FAILED;
  return FILM_DELIVERY_STATE.NOT_READY;
}

/**
 * Testo breve “prossimo passo” per il blocco montaggio (consumer-safe).
 * @param {object} p
 * @param {string} p.readiness — FILM_OUTPUT_READINESS.*
 * @param {string} p.finalMontagePhase
 * @param {string} p.montageStatus
 * @param {string|null} p.outputUrl
 */
export function consumerMontageNextStepIt(p) {
  const readiness = String(p?.readiness || "").trim();
  const fmp = String(p?.finalMontagePhase || "none").trim();
  const st = String(p?.montageStatus || "idle").trim();
  const url = p?.outputUrl != null && String(p.outputUrl).trim() ? String(p.outputUrl).trim() : null;
  if (st === "failed" || readiness === FILM_OUTPUT_READINESS.MONTAGE_FAILED) {
    return "Riprova il montaggio: correggi eventuali errori sulle clip, poi genera di nuovo il filmato.";
  }
  if (st === "rendering" || st === "compiling" || readiness === FILM_OUTPUT_READINESS.IN_PROGRESS) {
    return "Attendi la fine del render. Se resta bloccato, chiudi e riapri il progetto sullo stesso dispositivo.";
  }
  if (fmp !== "assembly" && fmp !== "done") {
    return "Completa le fasi precedenti fino al montaggio finale, poi torna qui per assemblare il film.";
  }
  if (st === "ready" && !url) {
    return "Genera il filmato: verrà creato il file finale e un link per guardarlo.";
  }
  if (st === "complete" && url && fmp !== "done") {
    return "Segna il montaggio come completato quando sei soddisfatto, così il film risulta consegnato in modo chiaro.";
  }
  if (st === "complete" && !url) {
    return "Il render risulta completo ma manca il link al file: rigenera il filmato.";
  }
  if (readiness === FILM_OUTPUT_READINESS.MISSING_OUTPUT && fmp === "assembly") {
    return "Non c’è ancora un file film salvato: avvia la generazione del filmato finale.";
  }
  return "Da qui assembli il film conclusivo del capitolo.";
}

/**
 * Fase 4 — livello di fiducia consumer sul film (nessun controllo HTTP sull’URL).
 * Usa delivery state, readiness, trust, stato montaggio e presenza URL coerente con i dati salvati.
 */
export const FILM_CONFIDENCE_LEVEL = {
  WATCH_NOW: "watch_now",
  READY_NEEDS_VERIFY: "ready_needs_verify",
  UNCERTAIN: "uncertain",
  NOT_AVAILABLE: "not_available",
  REGENERATE: "regenerate",
};

const FILM_CONFIDENCE_HEADLINE_IT = {
  [FILM_CONFIDENCE_LEVEL.WATCH_NOW]: "Puoi provare a guardare il film ora",
  [FILM_CONFIDENCE_LEVEL.READY_NEEDS_VERIFY]: "Sembra pronto: verifica la riproduzione",
  [FILM_CONFIDENCE_LEVEL.UNCERTAIN]: "File presente ma affidabilità non garantita",
  [FILM_CONFIDENCE_LEVEL.NOT_AVAILABLE]: "Film non disponibile da qui",
  [FILM_CONFIDENCE_LEVEL.REGENERATE]: "Serve rigenerare o completare il montaggio",
};

/**
 * @param {object} raw
 * @param {string} [raw.filmDeliveryState]
 * @param {string} [raw.filmOutputReadiness]
 * @param {string} [raw.filmOutputTrust]
 * @param {boolean} [raw.hasUrl]
 * @param {string|null} [raw.outputUrl]
 * @param {string} [raw.montageStatus]
 * @param {string} [raw.finalMontagePhase]
 * @returns {{ level: string, headline: string, subline: string, nextStep: string }}
 */
export function deriveConsumerFilmConfidence(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const filmDeliveryState = String(p.filmDeliveryState || "").trim();
  const readiness = String(p.filmOutputReadiness || "").trim();
  const trust = String(p.filmOutputTrust || "").trim();
  const filmReconcileMeta = p.filmReconcileMeta && typeof p.filmReconcileMeta === "object" ? p.filmReconcileMeta : null;
  const staleReasons = Array.isArray(filmReconcileMeta?.staleUnverifiedReasons) ? filmReconcileMeta.staleUnverifiedReasons : [];
  const hasUrl =
    p.hasUrl === true ||
    (p.outputUrl != null && String(p.outputUrl).trim() !== "") ||
    (p.completedFilmUrl != null && String(p.completedFilmUrl).trim() !== "");
  const montageStatus = String(p.montageStatus || "").trim();
  const fmp = String(p.finalMontagePhase || "").trim();

  if (filmReconcileMeta?.nominalCompletedWithoutFilm === true) {
    return {
      level: FILM_CONFIDENCE_LEVEL.REGENERATE,
      headline: "Completato in elenco ma senza file film consolidato",
      subline: "Le fasi risultano chiuse, ma dalla riconciliazione non emerge un MP4 affidabile per tutto il progetto.",
      nextStep: "Apri Scenografie, vai al montaggio del capitolo indicato e genera o rigenera il filmato.",
    };
  }

  if (
    hasUrl &&
    staleReasons.includes("later_montage_failure_vs_shown_file")
  ) {
    return {
      level: FILM_CONFIDENCE_LEVEL.UNCERTAIN,
      headline: "File salvato, ma c’è un fallimento più recente",
      subline:
        "Il link che vedi potrebbe non riflettere l’ultimo tentativo di montaggio. Meglio non considerarlo definitivo finché non verifichi in editor.",
      nextStep: "Apri il montaggio sul capitolo suggerito: controlla lo stato e, se serve, riprova la generazione.",
    };
  }

  if (hasUrl && staleReasons.includes("recovery_targets_fix_chapter_not_newest_playable")) {
    return {
      level: FILM_CONFIDENCE_LEVEL.READY_NEEDS_VERIFY,
      headline: "Capitolo da sistemare ≠ capitolo col file più recente",
      subline:
        "Per rimettere in carreggiata il flusso ti indichiamo un capitolo; il file migliore potrebbe essere su un altro capitolo.",
      nextStep: "Usa «Apri capitolo con il file» se disponibile, oppure «Vai al montaggio» sul capitolo suggerito per allineare lo stato.",
    };
  }

  const fail =
    readiness === FILM_OUTPUT_READINESS.MONTAGE_FAILED ||
    filmDeliveryState === FILM_DELIVERY_STATE.MONTAGE_FAILED ||
    montageStatus === "failed";
  if (fail) {
    return {
      level: FILM_CONFIDENCE_LEVEL.REGENERATE,
      headline: FILM_CONFIDENCE_HEADLINE_IT[FILM_CONFIDENCE_LEVEL.REGENERATE],
      subline: "Il montaggio non è riuscito o il file non risulta utilizzabile.",
      nextStep: "Apri il montaggio nel capitolo indicato e genera di nuovo il filmato.",
    };
  }

  const inProg =
    readiness === FILM_OUTPUT_READINESS.IN_PROGRESS ||
    filmDeliveryState === FILM_DELIVERY_STATE.MONTAGE_IN_PROGRESS ||
    montageStatus === "rendering" ||
    montageStatus === "compiling";
  if (inProg) {
    return {
      level: FILM_CONFIDENCE_LEVEL.UNCERTAIN,
      headline: "Montaggio in corso",
      subline: "Il render potrebbe essere ancora attivo o non salvato.",
      nextStep: "Resta in Scenografie sullo stesso dispositivo finché non vedi completato.",
    };
  }

  const missing =
    !hasUrl ||
    readiness === FILM_OUTPUT_READINESS.MISSING_OUTPUT ||
    filmDeliveryState === FILM_DELIVERY_STATE.DELIVERED_MISSING_OUTPUT;
  if (missing) {
    return {
      level: FILM_CONFIDENCE_LEVEL.NOT_AVAILABLE,
      headline: FILM_CONFIDENCE_HEADLINE_IT[FILM_CONFIDENCE_LEVEL.NOT_AVAILABLE],
      subline: "Non c’è un link al file finale che possiamo usare da qui.",
      nextStep: "Apri il progetto e avvia il montaggio fino al file MP4.",
    };
  }

  if (
    filmDeliveryState === FILM_DELIVERY_STATE.MULTI_CHAPTER_NO_CONSOLIDATED ||
    readiness === FILM_OUTPUT_READINESS.URL_STALE_PHASE ||
    readiness === FILM_OUTPUT_READINESS.UNVERIFIED_URL ||
    trust === FILM_OUTPUT_TRUST.UNVERIFIED ||
    filmDeliveryState === FILM_DELIVERY_STATE.DELIVERED_UNVERIFIED
  ) {
    return {
      level: FILM_CONFIDENCE_LEVEL.UNCERTAIN,
      headline: FILM_CONFIDENCE_HEADLINE_IT[FILM_CONFIDENCE_LEVEL.UNCERTAIN],
      subline:
        filmDeliveryState === FILM_DELIVERY_STATE.MULTI_CHAPTER_NO_CONSOLIDATED
          ? "Più capitoli: serve capire quale montaggio è la tua consegna finale."
          : "Fasi o link non perfettamente allineati: meglio confermare in editor.",
      nextStep: "Usa «Vai al montaggio» sul capitolo suggerito e allinea lo stato.",
    };
  }

  if (readiness === FILM_OUTPUT_READINESS.DEGRADED || filmDeliveryState === FILM_DELIVERY_STATE.DELIVERED_FRAGILE) {
    return {
      level: FILM_CONFIDENCE_LEVEL.READY_NEEDS_VERIFY,
      headline: FILM_CONFIDENCE_HEADLINE_IT[FILM_CONFIDENCE_LEVEL.READY_NEEDS_VERIFY],
      subline: "Il file c’è, ma il piano segnala avvisi.",
      nextStep: "Guarda il film; se qualcosa non torna, rivedi clip o montaggio.",
    };
  }

  if (readiness === FILM_OUTPUT_READINESS.PLAYABLE && trust === FILM_OUTPUT_TRUST.LAST_SUCCESS_KNOWN) {
    return {
      level: FILM_CONFIDENCE_LEVEL.WATCH_NOW,
      headline: FILM_CONFIDENCE_HEADLINE_IT[FILM_CONFIDENCE_LEVEL.WATCH_NOW],
      subline: "Ultimo render segnato come riuscito. I link remoti possono scadere.",
      nextStep: "Avvia la riproduzione; se non parte, rigenera dal montaggio.",
    };
  }

  if (readiness === FILM_OUTPUT_READINESS.PLAYABLE && hasUrl) {
    return {
      level: FILM_CONFIDENCE_LEVEL.READY_NEEDS_VERIFY,
      headline: FILM_CONFIDENCE_HEADLINE_IT[FILM_CONFIDENCE_LEVEL.READY_NEEDS_VERIFY],
      subline:
        fmp !== "done"
          ? "C’è un file, ma il capitolo non risulta ancora chiuso al 100%."
          : "File salvato: verifica che il lettore lo apra.",
      nextStep:
        fmp !== "done"
          ? "Quando il risultato ti convince, segna il montaggio come completato."
          : "Prova Guarda; se fallisce, apri il montaggio e rigenera.",
    };
  }

  return {
    level: FILM_CONFIDENCE_LEVEL.UNCERTAIN,
    headline: FILM_CONFIDENCE_HEADLINE_IT[FILM_CONFIDENCE_LEVEL.UNCERTAIN],
    subline: "Stato non del tutto chiaro dai dati salvati.",
    nextStep: "Apri il progetto e controlla il blocco montaggio.",
  };
}

/** Livello sintetico per utenti non tecnici (allineato tra Home, hub, editor). */
export const FINAL_OUTPUT_SIMPLE_TIER = {
  READY_TO_WATCH: "ready_watch",
  LIKELY_READY: "likely_ready",
  NEEDS_CHECK: "needs_check",
  NOT_AVAILABLE: "not_available",
  REGENERATE: "regenerate",
};

/** @type {Record<string, string>} */
export const FINAL_OUTPUT_SIMPLE_LABEL_IT = {
  [FINAL_OUTPUT_SIMPLE_TIER.READY_TO_WATCH]: "Pronto da guardare",
  [FINAL_OUTPUT_SIMPLE_TIER.LIKELY_READY]: "Probabilmente pronto",
  [FINAL_OUTPUT_SIMPLE_TIER.NEEDS_CHECK]: "Da verificare",
  [FINAL_OUTPUT_SIMPLE_TIER.NOT_AVAILABLE]: "Non disponibile",
  [FINAL_OUTPUT_SIMPLE_TIER.REGENERATE]: "Da rigenerare",
};

/**
 * Sintesi a tre livelli: primaryLine (primo), detail/next (secondo), technicalHeadline (terzo).
 * @param {{ level?: string, headline?: string, subline?: string, nextStep?: string }} confidence — output di deriveConsumerFilmConfidence
 * @param {{ hasUrl?: boolean, filmDeliveryState?: string, filmOutputReadiness?: string, filmVerificationEffective?: object|null }} opts
 */
export function deriveFinalOutputSimplePresentation(confidence, opts = {}) {
  const c = confidence && typeof confidence === "object" ? confidence : {};
  const level = String(c.level || "").trim();
  const o = opts && typeof opts === "object" ? opts : {};
  const hasUrl = o.hasUrl === true;
  const readiness = String(o.filmOutputReadiness || "").trim();
  const delivery = String(o.filmDeliveryState || "").trim();
  const fv = o.filmVerificationEffective && typeof o.filmVerificationEffective === "object" ? o.filmVerificationEffective : null;
  const hm = fv?.headlineModifier != null ? String(fv.headlineModifier).trim() : "";

  let tier = FINAL_OUTPUT_SIMPLE_TIER.NEEDS_CHECK;

  if (level === FILM_CONFIDENCE_LEVEL.WATCH_NOW) {
    tier = FINAL_OUTPUT_SIMPLE_TIER.READY_TO_WATCH;
  } else if (level === FILM_CONFIDENCE_LEVEL.NOT_AVAILABLE) {
    tier = FINAL_OUTPUT_SIMPLE_TIER.NOT_AVAILABLE;
  } else if (level === FILM_CONFIDENCE_LEVEL.REGENERATE) {
    tier = FINAL_OUTPUT_SIMPLE_TIER.REGENERATE;
  } else if (level === FILM_CONFIDENCE_LEVEL.READY_NEEDS_VERIFY) {
    if (readiness === FILM_OUTPUT_READINESS.DEGRADED || delivery === FILM_DELIVERY_STATE.DELIVERED_FRAGILE) {
      tier = FINAL_OUTPUT_SIMPLE_TIER.LIKELY_READY;
    } else {
      tier = FINAL_OUTPUT_SIMPLE_TIER.NEEDS_CHECK;
    }
  } else if (level === FILM_CONFIDENCE_LEVEL.UNCERTAIN) {
    if (delivery === FILM_DELIVERY_STATE.MONTAGE_IN_PROGRESS) {
      tier = FINAL_OUTPUT_SIMPLE_TIER.NEEDS_CHECK;
    } else if (hasUrl) {
      tier = FINAL_OUTPUT_SIMPLE_TIER.NEEDS_CHECK;
    } else {
      tier = FINAL_OUTPUT_SIMPLE_TIER.NOT_AVAILABLE;
    }
  }

  let primaryLine = FINAL_OUTPUT_SIMPLE_LABEL_IT[tier] || FINAL_OUTPUT_SIMPLE_LABEL_IT[FINAL_OUTPUT_SIMPLE_TIER.NEEDS_CHECK];

  if (tier === FINAL_OUTPUT_SIMPLE_TIER.READY_TO_WATCH && hm) {
    if (hm === "verificato") {
      primaryLine = "Pronto da guardare · verificato";
    } else if (hm === "verificato_non_fresco") {
      primaryLine = "Pronto da guardare · verifica non recente";
    } else if (hm === "non_verificato" || hm === "verifica_obsoleta") {
      primaryLine = "Pronto da guardare · non verificato";
    } else if (hm === "non_verificabile") {
      primaryLine = "Pronto da guardare · verifica non disponibile (browser)";
    } else if (hm === "verifica_fallita") {
      primaryLine = "Pronto da guardare · ultima verifica fallita";
    }
  } else if (tier === FINAL_OUTPUT_SIMPLE_TIER.LIKELY_READY && hm === "verifica_fallita") {
    primaryLine = "Probabilmente pronto · verifica fallita";
  }

  const verificationLine = fv?.userLineIt != null && String(fv.userLineIt).trim() ? String(fv.userLineIt).trim() : null;

  return {
    tier,
    primaryLine,
    detailLine: c.subline != null && String(c.subline).trim() ? String(c.subline).trim() : null,
    nextStepLine: c.nextStep != null && String(c.nextStep).trim() ? String(c.nextStep).trim() : null,
    technicalHeadline: c.headline != null && String(c.headline).trim() ? String(c.headline).trim() : null,
    verificationLine,
    verificationHeadlineModifier: hm || null,
  };
}

/** Fascia esplicita al momento del Play (allineata ai tier sintetici, senza cambiarne la semantica). */
export const FINAL_FILM_PLAYBACK_MOMENT_BAND = {
  PLAY_NOW: "play_now",
  PROBABLY: "probably",
  VERIFY_FIRST: "verify_first",
  NOT_OPENABLE: "not_openable",
  REGENERATE: "regenerate",
};

/**
 * Messaggio chiaro nel punto di playback: cosa aspettarsi da Play / link remoto.
 * @param {string} simpleTier — es. FINAL_OUTPUT_SIMPLE_TIER.*
 * @param {string} [filmOutputReadiness]
 * @param {object|null} [filmVerificationEffective] — da computeFilmVerificationEffective
 * @returns {{ band: string, headline: string, subline: string }}
 */
export function describeFinalFilmPlaybackMoment(simpleTier, filmOutputReadiness, filmVerificationEffective = null) {
  const tier = String(simpleTier || "").trim();
  const r = String(filmOutputReadiness || "").trim();
  const fv = filmVerificationEffective && typeof filmVerificationEffective === "object" ? filmVerificationEffective : null;
  const hm = fv?.headlineModifier != null ? String(fv.headlineModifier).trim() : "";

  if (
    tier === FINAL_OUTPUT_SIMPLE_TIER.REGENERATE ||
    r === FILM_OUTPUT_READINESS.MONTAGE_FAILED
  ) {
    return {
      band: FINAL_FILM_PLAYBACK_MOMENT_BAND.REGENERATE,
      headline: "Da rigenerare",
      subline:
        "Il montaggio non risulta affidabile o è fallito: apri il blocco montaggio e rigenera il file prima di guardare il film.",
    };
  }
  if (tier === FINAL_OUTPUT_SIMPLE_TIER.NOT_AVAILABLE || r === FILM_OUTPUT_READINESS.MISSING_OUTPUT) {
    return {
      band: FINAL_FILM_PLAYBACK_MOMENT_BAND.NOT_OPENABLE,
      headline: "Non apribile da qui",
      subline: "Non c’è un file finale utilizzabile indicizzato: serve completare o salvare il montaggio nel progetto.",
    };
  }
  if (tier === FINAL_OUTPUT_SIMPLE_TIER.READY_TO_WATCH) {
    let headline = "Riproducibile ora";
    let subline =
      "Dati salvati coerenti con un output pronto. Il play può comunque fallire se il link remoto è scaduto o il browser blocca il caricamento.";
    if (hm === "verificato") {
      headline = "Riproducibile ora · verificato";
      subline =
        "Ultimo controllo rete/player riuscito e recente: il file risponde. Restano possibili limiti del player integrato o policy del browser.";
    } else if (hm === "verificato_non_fresco") {
      headline = "Riproducibile ora · verifica datata";
      subline =
        "In passato il file ha risposto alla verifica; ripeti «Verifica file finale» se non si apre più.";
    } else if (hm === "non_verificato") {
      headline = "Riproducibile ora · non verificato";
      subline =
        "Stato salvato ottimale, ma AXSTUDIO non ha ancora eseguito un controllo su questo URL: usa «Verifica file finale» prima del play se vuoi maggiore certezza.";
    } else if (hm === "verifica_obsoleta") {
      headline = "Riproducibile ora · verifica obsoleta";
      subline = fv?.userLineIt || "Il link è cambiato dopo l’ultima verifica: esegui di nuovo il controllo.";
    } else if (hm === "non_verificabile") {
      headline = "Riproducibile ora · verifica non possibile qui";
      subline =
        fv?.userLineIt ||
        "Il browser blocca la verifica automatica (CORS): prova «Apri in nuova scheda» o un player esterno.";
    } else if (hm === "verifica_fallita") {
      headline = "Riproducibile ora · verifica fallita";
      subline =
        fv?.userLineIt ||
        "L’ultimo controllo non è riuscito: il file potrebbe essere scaduto; prova nuova scheda o rigenera il montaggio.";
    }
    return {
      band: FINAL_FILM_PLAYBACK_MOMENT_BAND.PLAY_NOW,
      headline,
      subline,
    };
  }
  if (tier === FINAL_OUTPUT_SIMPLE_TIER.LIKELY_READY) {
    let headline = "Probabilmente riproducibile";
    let subline =
      "C’è un file da provare, con avvisi. Se il player interno non parte, usa «Nuova scheda» o un altro link salvato (se presente).";
    if (hm === "verifica_fallita") {
      headline = "Probabilmente riproducibile · verifica fallita";
      subline = fv?.userLineIt || subline;
    } else if (hm === "non_verificato") {
      subline = `${subline} ${fv?.userLineIt || ""}`.trim();
    }
    return {
      band: FINAL_FILM_PLAYBACK_MOMENT_BAND.PROBABLY,
      headline,
      subline,
    };
  }
  return {
    band: FINAL_FILM_PLAYBACK_MOMENT_BAND.VERIFY_FIRST,
    headline: "Da verificare prima del play",
    subline:
      (fv?.userLineIt ? `${fv.userLineIt} ` : "") +
      "Output o stato progetto non del tutto consolidati. Prova il play; se fallisce, verifica il file in nuova scheda o dal montaggio.",
  };
}

/**
 * Candidati URL per il film finale (nessuna richiesta HTTP). Ordine: URL rollup riconciliato, poi ogni `finalFilmMontage.outputUrl` dei capitoli.
 * @param {{ chapters?: Array<{ id?: string, sortOrder?: number, data?: object }> }} workspace
 * @returns {{ entries: Array<{ url: string, sourceLabel: string, chapterId: string|null }> }}
 */
export function buildFinalFilmPlaybackCandidates(workspace) {
  const ws = workspace && typeof workspace === "object" ? workspace : {};
  const rawList = Array.isArray(ws.chapters) ? ws.chapters : [];
  const chapters = [...rawList].sort(
    (a, b) =>
      (Number(a?.sortOrder) || 0) - (Number(b?.sortOrder) || 0) ||
      String(a?.id || "").localeCompare(String(b?.id || "")),
  );
  const rec = reconcileWorkspaceFilmOutputState(ws);
  const seen = new Set();
  /** @type {{ url: string, sourceLabel: string, chapterId: string|null }[]} */
  const entries = [];
  const push = (url, sourceLabel, chapterId = null) => {
    const u = url != null && String(url).trim() ? String(url).trim() : null;
    if (!u || seen.has(u)) return;
    seen.add(u);
    const cid = chapterId != null && String(chapterId).trim() ? String(chapterId).trim() : null;
    entries.push({ url: u, sourceLabel, chapterId: cid });
  };

  if (rec.completedFilmUrl) {
    push(
      rec.completedFilmUrl,
      "Film finale · sintesi progetto (stesso link della Home)",
      rec.pickedOutputSourceChapterId || null,
    );
  }

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const u = ch?.data?.finalFilmMontage?.outputUrl;
    if (!u) continue;
    const id = ch?.id != null && String(ch.id).trim() ? String(ch.id).trim() : null;
    const n = i + 1;
    let label = `Montaggio salvato · capitolo ${n}`;
    if (id && rec.pickedOutputSourceChapterId && String(id) === String(rec.pickedOutputSourceChapterId)) {
      label = `Montaggio salvato · capitolo ${n} (capitolo scelto per la consegna)`;
    }
    push(u, label, id);
  }

  return { entries, reconcileSnapshot: rec };
}

/**
 * Per una card capitolo: mette per primo l’output del capitolo, poi gli altri candidati workspace (dedup).
 * @param {string|null|undefined} chapterOutputUrl
 * @param {string|null|undefined} chapterId
 * @param {{ entries?: Array<{ url: string, sourceLabel: string, chapterId?: string|null }> }} candidates — es. output di buildFinalFilmPlaybackCandidates
 */
export function mergePlaybackEntriesChapterFirst(chapterOutputUrl, chapterId, candidates) {
  const list = candidates && Array.isArray(candidates.entries) ? candidates.entries : [];
  const seen = new Set();
  /** @type {{ url: string, sourceLabel: string, chapterId: string|null }[]} */
  const entries = [];
  const push = (url, sourceLabel, cid = null) => {
    const u = url != null && String(url).trim() ? String(url).trim() : null;
    if (!u || seen.has(u)) return;
    seen.add(u);
    const id = cid != null && String(cid).trim() ? String(cid).trim() : null;
    entries.push({ url: u, sourceLabel, chapterId: id });
  };
  const chId = chapterId != null && String(chapterId).trim() ? String(chapterId).trim() : null;
  if (chapterOutputUrl) {
    push(chapterOutputUrl, "Output salvato · questo capitolo", chId);
  }
  for (const e of list) {
    push(e.url, e.sourceLabel, e.chapterId);
  }
  return { entries };
}

/**
 * Messaggio leggibile per errori del tag &lt;video&gt; (MEDIA_ERR_*).
 * @param {HTMLVideoElement|null|undefined} videoEl
 * @returns {string|null}
 */
export function humanizeHtml5VideoElementError(videoEl) {
  const err = videoEl && typeof videoEl === "object" ? videoEl.error : null;
  if (!err || typeof err.code !== "number") return null;
  switch (err.code) {
    case 1:
      return "Riproduzione interrotta.";
    case 2:
      return "Errore di rete durante il caricamento (link remoto, firewall o sessione scaduta).";
    case 3:
      return "Il file non è decodificabile in questo browser.";
    case 4:
      return "Formato o indirizzo non supportato dal lettore incorporato.";
    default:
      return "Errore del lettore video.";
  }
}

/**
 * Segnali consumer-safe per card capitolo (Chapter Hub): delivery a livello singolo capitolo + fiducia.
 * @param {object} chapterData — payload capitolo (come in editor), eventualmente già merge-ato col pool workspace.
 * @returns {{ readiness: string, outputUrl: string|null, outputTrust: string, filmDeliveryState: string, deliveryLabelIt: string, userHint: string|null, hasExecutionWarnings: boolean, confidence: object, montageNextStep: string }}
 */
export function deriveChapterMontageConsumerSummary(chapterData) {
  const d = chapterData && typeof chapterData === "object" ? chapterData : {};
  const m = deriveFilmOutputReadinessFromChapterData(d);
  const readiness = m.readiness;
  const url = m.outputUrl != null && String(m.outputUrl).trim() ? String(m.outputUrl).trim() : null;
  const st = String(d.finalFilmMontage?.status || "idle").trim();
  const fmp = String(d.finalMontagePhase || "none").trim();
  const vp = String(d.scenografiaVideoPhase || "none").trim();

  let filmDeliveryState = FILM_DELIVERY_STATE.NOT_READY;
  if (readiness === FILM_OUTPUT_READINESS.MONTAGE_FAILED || st === "failed") {
    filmDeliveryState = FILM_DELIVERY_STATE.MONTAGE_FAILED;
  } else if (
    readiness === FILM_OUTPUT_READINESS.IN_PROGRESS ||
    st === "rendering" ||
    st === "compiling"
  ) {
    filmDeliveryState = FILM_DELIVERY_STATE.MONTAGE_IN_PROGRESS;
  } else if (readiness === FILM_OUTPUT_READINESS.MISSING_OUTPUT) {
    if (fmp === "done" || vp === "completed") {
      filmDeliveryState = FILM_DELIVERY_STATE.DELIVERED_MISSING_OUTPUT;
    } else {
      filmDeliveryState = FILM_DELIVERY_STATE.NOT_READY;
    }
  } else if (readiness === FILM_OUTPUT_READINESS.PLAYABLE && url) {
    filmDeliveryState = FILM_DELIVERY_STATE.DELIVERED_WATCHABLE;
  } else if (readiness === FILM_OUTPUT_READINESS.DEGRADED && url) {
    filmDeliveryState = FILM_DELIVERY_STATE.DELIVERED_FRAGILE;
  } else if (
    url &&
    (readiness === FILM_OUTPUT_READINESS.URL_STALE_PHASE || readiness === FILM_OUTPUT_READINESS.UNVERIFIED_URL)
  ) {
    filmDeliveryState = FILM_DELIVERY_STATE.DELIVERED_UNVERIFIED;
  }

  const confidence = deriveConsumerFilmConfidence({
    filmDeliveryState,
    filmOutputReadiness: readiness,
    filmOutputTrust: m.outputTrust,
    hasUrl: Boolean(url),
    outputUrl: url,
    montageStatus: st,
    finalMontagePhase: fmp,
  });

  const montageNextStep = consumerMontageNextStepIt({
    readiness,
    finalMontagePhase: fmp,
    montageStatus: st,
    outputUrl: url,
  });

  return {
    readiness,
    outputUrl: url,
    outputTrust: m.outputTrust,
    filmDeliveryState,
    deliveryLabelIt: FILM_DELIVERY_LABEL_IT[filmDeliveryState] || filmDeliveryState,
    userHint: m.userHint || null,
    hasExecutionWarnings: m.hasExecutionWarnings === true,
    confidence,
    montageNextStep,
  };
}

/**
 * Indice Home / libreria: include completati, quasi pronti e casi da recuperare.
 * @param {object} summary — output di summarizeScenografiaWorkspaceForIndex
 */
export function workspaceEligibleForCompletedFilmsLibrary(summary) {
  const s = summary && typeof summary === "object" ? summary : {};
  if (s.uiStatus === "completed" || s.workspaceAggregateUiStatus === "completed") return true;
  const legacyUrl = s.completedFilmUrl != null && String(s.completedFilmUrl).trim();
  if (legacyUrl) return true;
  if ((s.filmChaptersCompletedCount || 0) > 0) return true;
  const d = String(s.filmDeliveryState || "").trim();
  if (
    d === FILM_DELIVERY_STATE.MONTAGE_IN_PROGRESS ||
    d === FILM_DELIVERY_STATE.MONTAGE_FAILED ||
    d === FILM_DELIVERY_STATE.DELIVERED_MISSING_OUTPUT ||
    d === FILM_DELIVERY_STATE.MULTI_CHAPTER_NO_CONSOLIDATED ||
    d === FILM_DELIVERY_STATE.DELIVERED_FRAGILE ||
    d === FILM_DELIVERY_STATE.DELIVERED_UNVERIFIED ||
    d === FILM_DELIVERY_STATE.DELIVERED_WATCHABLE
  ) {
    return true;
  }
  if ((s.chaptersCount || 0) > 1 && (s.filmChaptersWithPlayableOutput || 0) > 0) return true;
  return false;
}

/**
 * Aggrega film multi-capitolo: prima URL `playable`, poi altri con file, poi fallimenti.
 * @param {Array<{ id?: string, data?: object }>} chaptersSorted
 */
export function rollupWorkspaceFilmDelivery(chaptersSorted) {
  const list = Array.isArray(chaptersSorted) ? chaptersSorted : [];
  const roll = list.map((ch) => deriveFilmOutputReadinessFromChapterData(ch?.data || {}));

  const findPickedIndex = (pred) => {
    const i = roll.findIndex(pred);
    return i;
  };

  let pickedIdx = findPickedIndex((r) => r.readiness === FILM_OUTPUT_READINESS.PLAYABLE && r.outputUrl);
  if (pickedIdx < 0) pickedIdx = findPickedIndex((r) => r.readiness === FILM_OUTPUT_READINESS.DEGRADED && r.outputUrl);
  if (pickedIdx < 0) pickedIdx = findPickedIndex((r) => r.outputUrl && r.readiness === FILM_OUTPUT_READINESS.URL_STALE_PHASE);
  if (pickedIdx < 0) pickedIdx = findPickedIndex((r) => r.outputUrl && r.readiness === FILM_OUTPUT_READINESS.UNVERIFIED_URL);
  if (pickedIdx < 0) pickedIdx = findPickedIndex((r) => r.outputUrl);

  const picked = pickedIdx >= 0 ? roll[pickedIdx] : null;
  const anyMontageFailed = roll.some((r) => r.readiness === FILM_OUTPUT_READINESS.MONTAGE_FAILED);
  const anyMissing = roll.some((r) => r.readiness === FILM_OUTPUT_READINESS.MISSING_OUTPUT);
  const inProgress = roll.some((r) => r.readiness === FILM_OUTPUT_READINESS.IN_PROGRESS);

  const completedFilmUrl = picked?.outputUrl || null;
  let filmOutputReadiness = picked?.readiness || FILM_OUTPUT_READINESS.MISSING_OUTPUT;
  if (!completedFilmUrl && anyMontageFailed) filmOutputReadiness = FILM_OUTPUT_READINESS.MONTAGE_FAILED;
  else if (!completedFilmUrl && inProgress) filmOutputReadiness = FILM_OUTPUT_READINESS.IN_PROGRESS;
  else if (!completedFilmUrl && anyMissing) filmOutputReadiness = FILM_OUTPUT_READINESS.MISSING_OUTPUT;

  const consolidatedChapterCount = list.filter((ch) => {
    const d = ch?.data || {};
    const fmp = String(d.finalMontagePhase || "none").trim();
    const r = deriveFilmOutputReadinessFromChapterData(d);
    return fmp === "done" && r.readiness === FILM_OUTPUT_READINESS.PLAYABLE && r.outputUrl;
  }).length;

  const playableChapterCount = roll.filter(
    (r) => r.readiness === FILM_OUTPUT_READINESS.PLAYABLE && r.outputUrl,
  ).length;

  const filmDeliveryState = computeFilmDeliveryState({
    chaptersCount: list.length,
    completedFilmUrl,
    filmOutputReadiness,
    roll,
    anyMontageFailed,
    anyInProgress: inProgress,
    consolidatedChapterCount,
    playableChapterCount,
  });

  const primaryChapterId = pickPrimaryChapterIdForFilmRecovery(list, roll, pickedIdx, completedFilmUrl);

  const lastFilmWorkflowFailure =
    roll.map((r) => r.lastWorkflowFailure).find(Boolean) ||
    (anyMontageFailed
      ? buildStructuredWorkflowFailure({
          errorCode: "MONTAGE_FAILED",
          errorStage: WORKFLOW_ERROR_STAGE.MONTAGE_RENDER,
          errorMessageUser: "Il montaggio di almeno un capitolo è fallito.",
          errorMessageTechnical: "",
          isRecoverable: true,
          suggestedAction: SUGGESTED_ACTION.OPEN_PROJECT,
        })
      : null);

  let multiChapterFilmHint = null;
  if (list.length > 1) {
    if (filmDeliveryState === FILM_DELIVERY_STATE.MULTI_CHAPTER_NO_CONSOLIDATED) {
      multiChapterFilmHint =
        "Progetto con più capitoli: non c’è ancora una consegna finale univoca. Apri il capitolo indicato per chiudere o rigenerare il montaggio.";
    } else {
      multiChapterFilmHint =
        "Progetto multi-capitolo: qui vedi il miglior film disponibile tra i capitoli; apri il progetto per verificare ogni capitolo.";
    }
  }

  const filmUserHint =
    picked?.userHint ||
    (filmDeliveryState === FILM_DELIVERY_STATE.MULTI_CHAPTER_NO_CONSOLIDATED
      ? "Più capitoli: controlla montaggio e fase «completato» su ciascun capitolo."
      : roll[0]?.userHint ?? "");

  const pickedOutputSourceChapterId =
    pickedIdx >= 0 && list[pickedIdx]?.id != null && String(list[pickedIdx].id).trim()
      ? String(list[pickedIdx].id).trim()
      : null;

  return {
    completedFilmUrl,
    filmOutputReadiness,
    filmDeliveryState,
    primaryChapterId,
    pickedOutputSourceChapterId,
    outputTrust: picked?.outputTrust || FILM_OUTPUT_TRUST.MISSING,
    outputRecordedAt: picked?.outputRecordedAt || null,
    outputUrlKind: picked?.outputUrlKind || "unknown",
    renderModeHint: picked?.renderModeHint || null,
    filmChaptersWithPlayableOutput: playableChapterCount,
    filmChaptersConsolidated: consolidatedChapterCount,
    filmUserHint,
    lastFilmWorkflowFailure,
    multiChapterFilmHint,
    hasPartialMontageFailure: anyMontageFailed && Boolean(completedFilmUrl),
  };
}

/**
 * Riconciliazione film finale multi-segnale: arricchisce il rollup con confronti tra capitoli,
 * tentativi falliti successivi al timestamp del file mostrato e capitolo «miglior render» vs capitolo recovery.
 * Nessun HEAD HTTP cross-origin.
 *
 * @param {{ chapters?: Array<{ id?: string, sortOrder?: number, data?: object }> } | Array<{ id?: string, sortOrder?: number, data?: object }>} input — workspace o lista capitoli ordinabile
 * @returns {object} — stesso contratto di `rollupWorkspaceFilmDelivery` + `reconcileMeta`
 */
export function reconcileWorkspaceFilmOutputState(input) {
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const rawList = Array.isArray(input) ? input : Array.isArray(src.chapters) ? src.chapters : [];
  const chapters = [...rawList].sort(
    (a, b) =>
      (Number(a?.sortOrder) || 0) - (Number(b?.sortOrder) || 0) || String(a?.id || "").localeCompare(String(b?.id || "")),
  );

  const base = rollupWorkspaceFilmDelivery(chapters);
  const list = chapters;
  const roll = list.map((ch) => deriveFilmOutputReadinessFromChapterData(ch?.data || {}));

  const ts = (iso) => {
    if (iso == null) return 0;
    const s = String(iso).trim();
    if (!s) return 0;
    const n = Date.parse(s);
    return Number.isFinite(n) ? n : 0;
  };

  const staleUnverifiedReasons = [];
  let montageFailedAfterPickedOutputTs = false;

  const pickedId = base.pickedOutputSourceChapterId;
  let pickedUrlTs = 0;
  if (pickedId) {
    const ch = list.find((c) => String(c?.id || "") === String(pickedId));
    const fm = ch?.data?.finalFilmMontage;
    if (fm && typeof fm === "object") {
      pickedUrlTs = Math.max(ts(fm.outputUrlSetAt), ts(fm.lastRenderCompletedAt));
    }
  }

  for (let i = 0; i < list.length; i++) {
    const fm = list[i]?.data?.finalFilmMontage;
    if (!fm || typeof fm !== "object") continue;
    const st = String(fm.status || "idle").trim();
    const failAt = st === "failed" ? Math.max(ts(fm.lastMontageAttemptAt), ts(fm.lastRenderStartedAt)) : 0;
    if (failAt > 0 && base.completedFilmUrl && pickedUrlTs > 0 && failAt > pickedUrlTs) {
      montageFailedAfterPickedOutputTs = true;
    }
    if (st === "failed" && failAt > 0) {
      const urlChTs = Math.max(ts(fm.outputUrlSetAt), ts(fm.lastRenderCompletedAt));
      if (urlChTs > 0 && failAt > urlChTs) staleUnverifiedReasons.push("chapter_failure_after_saved_url");
    }
  }
  if (montageFailedAfterPickedOutputTs) {
    staleUnverifiedReasons.push("later_montage_failure_vs_shown_file");
  }

  let latestPlayableChapterId = null;
  let bestPlayableTs = 0;
  for (const ch of list) {
    const d = ch?.data || {};
    const r = deriveFilmOutputReadinessFromChapterData(d);
    const fm = d.finalFilmMontage;
    if (r.readiness === FILM_OUTPUT_READINESS.PLAYABLE && r.outputUrl) {
      const t = Math.max(ts(fm?.outputUrlSetAt), ts(fm?.lastRenderCompletedAt));
      if (t >= bestPlayableTs) {
        bestPlayableTs = t;
        latestPlayableChapterId = ch?.id != null && String(ch.id).trim() ? String(ch.id).trim() : null;
      }
    }
  }

  const recoveryDiffersFromLatestPlayable =
    list.length > 1 &&
    latestPlayableChapterId &&
    base.primaryChapterId &&
    String(latestPlayableChapterId) !== String(base.primaryChapterId) &&
    base.filmDeliveryState !== FILM_DELIVERY_STATE.MONTAGE_FAILED;

  if (recoveryDiffersFromLatestPlayable) {
    staleUnverifiedReasons.push("recovery_targets_fix_chapter_not_newest_playable");
  }

  let filmOutputReadiness = base.filmOutputReadiness;
  let outputTrust = base.outputTrust;

  if (montageFailedAfterPickedOutputTs && base.completedFilmUrl) {
    if (outputTrust === FILM_OUTPUT_TRUST.LAST_SUCCESS_KNOWN) outputTrust = FILM_OUTPUT_TRUST.UNVERIFIED;
    if (filmOutputReadiness === FILM_OUTPUT_READINESS.PLAYABLE) {
      filmOutputReadiness = FILM_OUTPUT_READINESS.UNVERIFIED_URL;
    }
  }

  const inProgress = roll.some((r) => r.readiness === FILM_OUTPUT_READINESS.IN_PROGRESS);
  const anyMontageFailed = roll.some((r) => r.readiness === FILM_OUTPUT_READINESS.MONTAGE_FAILED);
  const consolidatedChapterCount = list.filter((ch) => {
    const d = ch?.data || {};
    const fmp = String(d.finalMontagePhase || "none").trim();
    const r = deriveFilmOutputReadinessFromChapterData(d);
    return fmp === "done" && r.readiness === FILM_OUTPUT_READINESS.PLAYABLE && r.outputUrl;
  }).length;
  const playableChapterCount = roll.filter(
    (r) => r.readiness === FILM_OUTPUT_READINESS.PLAYABLE && r.outputUrl,
  ).length;

  const filmDeliveryState = computeFilmDeliveryState({
    chaptersCount: list.length,
    completedFilmUrl: base.completedFilmUrl,
    filmOutputReadiness,
    roll,
    anyMontageFailed,
    anyInProgress: inProgress,
    consolidatedChapterCount,
    playableChapterCount,
  });

  const reconciledAt = new Date().toISOString();

  return {
    ...base,
    filmOutputReadiness,
    filmDeliveryState,
    outputTrust,
    pickedOutputSourceChapterId: base.pickedOutputSourceChapterId,
    filmChaptersWithPlayableOutput: playableChapterCount,
    filmChaptersConsolidated: consolidatedChapterCount,
    reconcileMeta: {
      staleUnverifiedReasons,
      montageFailedAfterPickedOutputTs,
      latestPlayableChapterId,
      recoveryDiffersFromLatestPlayable,
      reconciledAt,
      derivedFrom: "workspace_chapters",
    },
  };
}

/**
 * @param {unknown} errLike
 * @param {string} userMsg
 * @param {object} extra — videoExecutionFailureStage, videoMuxFailure, …
 */
export function buildClipPipelineFailureRecord(errLike, userMsg, extra = {}) {
  const technical = errLike?.message != null ? String(errLike.message) : String(errLike ?? "");
  const stageHint = String(extra.videoExecutionFailureStage || "").trim();
  let errorStage = WORKFLOW_ERROR_STAGE.CLIP_PIPELINE;
  let errorCode = "CLIP_PIPELINE_FAILED";
  let suggestedAction = SUGGESTED_ACTION.REGENERATE_CLIP;

  if (extra.videoMuxFailure === true || /mux/i.test(technical) || stageHint.includes("mux")) {
    errorStage = WORKFLOW_ERROR_STAGE.CLIP_MUX;
    errorCode = "CLIP_MUX_FAILED";
    suggestedAction = SUGGESTED_ACTION.RETRY;
  } else if (/ELEVEN|ElevenLabs|voice|tts|TTS/i.test(technical)) {
    errorStage = WORKFLOW_ERROR_STAGE.CLIP_PROVIDER_ELEVEN;
    errorCode = "CLIP_ELEVENLABS_FAILED";
    suggestedAction = SUGGESTED_ACTION.CHECK_API_KEYS;
  } else if (/fal\.|FAL|Kling|upload/i.test(technical) || stageHint.includes("provider") || stageHint.includes("cinematic")) {
    errorStage = WORKFLOW_ERROR_STAGE.CLIP_PROVIDER_FAL;
    errorCode = "CLIP_FAL_FAILED";
    suggestedAction = SUGGESTED_ACTION.RETRY;
  }

  return buildStructuredWorkflowFailure({
    errorCode,
    errorStage,
    errorMessageUser: userMsg,
    errorMessageTechnical: technical,
    isRecoverable: true,
    suggestedAction,
  });
}

/**
 * @param {object} p
 * @param {string} p.technical
 * @param {string} p.userMessage
 * @param {'validate'|'render'} p.kind
 */
export function buildMontageFailureRecord(p) {
  const kind = p.kind === "validate" ? "validate" : "render";
  return buildStructuredWorkflowFailure({
    errorCode: kind === "validate" ? "MONTAGE_VALIDATE_FAILED" : "MONTAGE_RENDER_FAILED",
    errorStage: kind === "validate" ? WORKFLOW_ERROR_STAGE.MONTAGE_VALIDATE : WORKFLOW_ERROR_STAGE.MONTAGE_RENDER,
    errorMessageUser:
      p.userMessage ||
      (kind === "validate"
        ? "Il piano di montaggio non può essere eseguito. Controlla clip e timeline."
        : "Il render del filmato finale non è riuscito. Riprova."),
    errorMessageTechnical: p.technical != null ? String(p.technical) : "",
    isRecoverable: true,
    suggestedAction: SUGGESTED_ACTION.RETRY,
  });
}

/**
 * @param {unknown} err
 */
export function buildStoryWizardCommitFailure(err) {
  const technical = err?.message != null ? String(err.message) : String(err ?? "");
  return buildStructuredWorkflowFailure({
    errorCode: "STORY_WIZARD_COMMIT_FAILED",
    errorStage: WORKFLOW_ERROR_STAGE.STORY_WIZARD_COMMIT,
    errorMessageUser:
      technical.length > 220
        ? `${technical.slice(0, 200)}…`
        : technical || "Impossibile creare il progetto da questa traccia.",
    errorMessageTechnical: technical,
    isRecoverable: true,
    suggestedAction: SUGGESTED_ACTION.GO_BACK,
  });
}

/**
 * @param {string} kind
 * @param {object} payload
 */
export function logConsumerReliabilityEvent(kind, payload) {
  if (typeof console !== "undefined" && console.info) {
    console.info(`[AXSTUDIO · reliability · ${kind}]`, payload);
  }
}
