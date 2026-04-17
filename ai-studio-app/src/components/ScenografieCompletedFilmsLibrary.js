/**
 * Home — libreria film Scenografie: consegne guardabili, quasi pronte e da recuperare.
 */

import React, { useState, useEffect, useCallback } from "react";
import { HiFilm, HiPlay, HiXMark, HiArrowPath } from "react-icons/hi2";
import {
  loadScenografiaProjectsIndex,
  loadScenografiaProjectById,
  ensureWorkspace,
  summarizeScenografiaWorkspaceForIndex,
  runAndPersistFilmOutputVerification,
} from "../services/scenografieProjectPersistence.js";
import {
  FILM_OUTPUT_READINESS,
  FILM_DELIVERY_LABEL_IT,
  FILM_DELIVERY_STATE,
  workspaceEligibleForCompletedFilmsLibrary,
  deriveConsumerFilmConfidence,
  deriveFinalOutputSimplePresentation,
  FINAL_OUTPUT_SIMPLE_TIER,
  buildFinalFilmPlaybackCandidates,
  describeFinalFilmPlaybackMoment,
  humanizeHtml5VideoElementError,
} from "../services/scenografieConsumerReliability.js";

const AX = {
  surface: "#13131a",
  border: "#23232e",
  text: "#f4f4f8",
  text2: "#a1a1b5",
  muted: "#6b6b80",
  electric: "#29b6ff",
  gradPrimary: "linear-gradient(135deg, #29b6ff 0%, #7b4dff 100%)",
};

/** Etichetta breve per badge card (italiano consumer). */
function filmReadinessBadgeLabel(readiness) {
  switch (readiness) {
    case FILM_OUTPUT_READINESS.PLAYABLE:
      return "Pronto da guardare";
    case FILM_OUTPUT_READINESS.DEGRADED:
      return "Probabilmente pronto · avvisi";
    case FILM_OUTPUT_READINESS.URL_STALE_PHASE:
    case FILM_OUTPUT_READINESS.UNVERIFIED_URL:
      return "Da verificare · link salvato";
    case FILM_OUTPUT_READINESS.MONTAGE_FAILED:
      return "Da rigenerare · montaggio";
    case FILM_OUTPUT_READINESS.IN_PROGRESS:
      return "Da verificare · montaggio in corso";
    case FILM_OUTPUT_READINESS.MISSING_OUTPUT:
    default:
      return "Non disponibile · senza file";
  }
}

function deliveryBadgeLabel(filmDeliveryState, readinessFallback) {
  const d = filmDeliveryState != null ? String(filmDeliveryState).trim() : "";
  if (d && FILM_DELIVERY_LABEL_IT[d]) return FILM_DELIVERY_LABEL_IT[d];
  return filmReadinessBadgeLabel(readinessFallback);
}

/** Una riga sintetica da `filmReconcileMeta` (senza duplicare il box «fiducia» quando possibile). */
function filmReconcileRiskLineIt(meta) {
  const m = meta && typeof meta === "object" ? meta : {};
  const r = Array.isArray(m.staleUnverifiedReasons) ? m.staleUnverifiedReasons : [];
  if (!r.length) return null;
  if (r.includes("later_montage_failure_vs_shown_file")) {
    return "Montaggio fallito dopo il file mostrato: non considerare il link come ultima verità.";
  }
  if (r.includes("recovery_targets_fix_chapter_not_newest_playable")) {
    return "Capitolo da sistemare e capitolo col file più recente possono non coincidere.";
  }
  if (r.includes("chapter_failure_after_saved_url")) {
    return "Su almeno un capitolo c’è un errore successivo al salvataggio del link.";
  }
  return null;
}

function filmCardAccent(filmDeliveryState, readiness, hasUrl) {
  if (filmDeliveryState === FILM_DELIVERY_STATE.MONTAGE_FAILED || readiness === FILM_OUTPUT_READINESS.MONTAGE_FAILED) {
    return "#fb7185";
  }
  if (
    filmDeliveryState === FILM_DELIVERY_STATE.DELIVERED_MISSING_OUTPUT ||
    readiness === FILM_OUTPUT_READINESS.MISSING_OUTPUT ||
    !hasUrl
  ) {
    return "#fbbf24";
  }
  if (
    filmDeliveryState === FILM_DELIVERY_STATE.DELIVERED_FRAGILE ||
    filmDeliveryState === FILM_DELIVERY_STATE.DELIVERED_UNVERIFIED ||
    filmDeliveryState === FILM_DELIVERY_STATE.MULTI_CHAPTER_NO_CONSOLIDATED ||
    readiness === FILM_OUTPUT_READINESS.DEGRADED ||
    readiness === FILM_OUTPUT_READINESS.URL_STALE_PHASE
  ) {
    return "#fbbf24";
  }
  return "#4ade80";
}

/** Una sola azione principale per ridurre ambiguità CTA. */
function completedFilmPrimaryKind(r) {
  const hm = r.filmVerificationEffective?.headlineModifier;
  if (r.canTryPlayback && (hm === "verifica_fallita" || hm === "verifica_obsoleta")) {
    return "verify_final";
  }
  if (r.canTryPlayback) return "watch";
  if (
    r.simple?.tier === FINAL_OUTPUT_SIMPLE_TIER.REGENERATE ||
    r.filmOutputReadiness === FILM_OUTPUT_READINESS.MONTAGE_FAILED
  ) {
    return r.suggestMontageJump ? "montage" : "project";
  }
  if (r.simple?.tier === FINAL_OUTPUT_SIMPLE_TIER.NOT_AVAILABLE) {
    return r.suggestMontageJump ? "montage" : "project";
  }
  if (r.hasUrl && (r.simple?.tier === FINAL_OUTPUT_SIMPLE_TIER.NEEDS_CHECK || r.simple?.tier === FINAL_OUTPUT_SIMPLE_TIER.LIKELY_READY)) {
    return "verify";
  }
  return "project";
}

/**
 * @param {{ homeActive?: boolean, onOpenScenografieProject?: (projectId: string, deepLink?: object|null) => void }} props
 */
export default function ScenografieCompletedFilmsLibrary({ homeActive = true, onOpenScenografieProject }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [player, setPlayer] = useState(null);
  const [playbackError, setPlaybackError] = useState(null);
  const [playerReloadKey, setPlayerReloadKey] = useState(0);
  const [verifyBusyId, setVerifyBusyId] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const idx = await loadScenografiaProjectsIndex();
      const projects = idx.projects || [];
      const candidates = projects.filter((p) => workspaceEligibleForCompletedFilmsLibrary(p.summary || {}));
      const enriched = await Promise.all(
        candidates.map(async (p) => {
          let sum = p.summary && typeof p.summary === "object" ? { ...p.summary } : {};
          let playbackEntries = [];
          try {
            const raw = await loadScenografiaProjectById(p.id);
            const ws = ensureWorkspace(raw);
            if (ws) {
              sum = summarizeScenografiaWorkspaceForIndex(ws);
              playbackEntries = buildFinalFilmPlaybackCandidates(ws).entries;
            }
          } catch {
            /* ignore */
          }

          const url = sum.completedFilmUrl != null && String(sum.completedFilmUrl).trim() ? String(sum.completedFilmUrl).trim() : null;
          const dur = sum.completedFilmDurationSec ?? null;
          const readiness = sum.filmOutputReadiness || FILM_OUTPUT_READINESS.UNVERIFIED_URL;
          const hint = sum.filmUserHint || null;
          const lastFailure = sum.lastFilmWorkflowFailure || null;
          const filmDeliveryState = sum.filmDeliveryState || FILM_DELIVERY_STATE.NOT_READY;
          const primaryChapterId =
            sum.filmPrimaryChapterId != null && String(sum.filmPrimaryChapterId).trim()
              ? String(sum.filmPrimaryChapterId).trim()
              : null;
          const playableSourceChapterId =
            sum.filmPlayableSourceChapterId != null && String(sum.filmPlayableSourceChapterId).trim()
              ? String(sum.filmPlayableSourceChapterId).trim()
              : null;
          const filmReconcileMeta = sum.filmReconcileMeta && typeof sum.filmReconcileMeta === "object" ? sum.filmReconcileMeta : null;
          const partialFailure = sum.filmHasPartialMontageFailure === true;
          const filmOutputTrust = sum.filmOutputTrust != null ? String(sum.filmOutputTrust).trim() : "";
          const filmVerificationEffective =
            sum.filmVerificationEffective && typeof sum.filmVerificationEffective === "object"
              ? sum.filmVerificationEffective
              : null;
          const confidence = deriveConsumerFilmConfidence({
            filmDeliveryState,
            filmOutputReadiness: readiness,
            filmOutputTrust,
            hasUrl: Boolean(url),
            completedFilmUrl: url,
            filmReconcileMeta,
          });
          const simple = deriveFinalOutputSimplePresentation(confidence, {
            hasUrl: Boolean(url),
            filmDeliveryState,
            filmOutputReadiness: readiness,
            filmVerificationEffective,
          });
          const playbackMoment = describeFinalFilmPlaybackMoment(simple.tier, readiness, filmVerificationEffective);
          if (!playbackEntries.length && url) {
            playbackEntries = [{ url, sourceLabel: "Film finale · link indicizzato (Home)", chapterId: playableSourceChapterId || null }];
          }
          const riskLine = filmReconcileRiskLineIt(filmReconcileMeta);

          const hasUrl = Boolean(url);
          const canTryPlayback =
            hasUrl &&
            readiness !== FILM_OUTPUT_READINESS.MONTAGE_FAILED &&
            readiness !== FILM_OUTPUT_READINESS.MISSING_OUTPUT;

          const suggestMontageJump =
            readiness === FILM_OUTPUT_READINESS.MONTAGE_FAILED ||
            readiness === FILM_OUTPUT_READINESS.MISSING_OUTPUT ||
            readiness === FILM_OUTPUT_READINESS.IN_PROGRESS ||
            readiness === FILM_OUTPUT_READINESS.DEGRADED ||
            readiness === FILM_OUTPUT_READINESS.URL_STALE_PHASE ||
            filmDeliveryState === FILM_DELIVERY_STATE.MONTAGE_FAILED ||
            filmDeliveryState === FILM_DELIVERY_STATE.DELIVERED_MISSING_OUTPUT ||
            filmDeliveryState === FILM_DELIVERY_STATE.MULTI_CHAPTER_NO_CONSOLIDATED ||
            filmDeliveryState === FILM_DELIVERY_STATE.MONTAGE_IN_PROGRESS;

          let statusExplain = null;
          if (partialFailure && hasUrl) {
            statusExplain =
              "Un capitolo ha avuto problemi di montaggio, ma c’è comunque un file da provare: verifica nel progetto.";
          } else if (lastFailure?.errorMessageUser) {
            statusExplain = `Ultimo errore: ${lastFailure.errorMessageUser}`;
          } else if (readiness === FILM_OUTPUT_READINESS.IN_PROGRESS) {
            statusExplain =
              "Montaggio probabilmente ancora in corso o non salvato: riapri il progetto sullo stesso dispositivo se serve.";
          } else if (readiness === FILM_OUTPUT_READINESS.URL_STALE_PHASE) {
            statusExplain = "C’è un file ma il capitolo non risulta chiuso: conviene riaprire e confermare in Scenografie.";
          } else if (filmDeliveryState === FILM_DELIVERY_STATE.MULTI_CHAPTER_NO_CONSOLIDATED) {
            statusExplain =
              sum.multiChapterFilmHint ||
              "Più capitoli: controlla che il montaggio e la chiusura siano allineati su quello giusto.";
          }

          const montageDeepLink = primaryChapterId
            ? { focus: "montage", chapterId: primaryChapterId }
            : { focus: "montage" };
          const showOpenChapterWithFile =
            Boolean(playableSourceChapterId) &&
            Boolean(primaryChapterId) &&
            playableSourceChapterId !== primaryChapterId;

          return {
            id: p.id,
            title: sum.displayTitle || "Senza titolo",
            poster: sum.posterImageUrl || null,
            updatedAt: p.updatedAt || "",
            filmUrl: url,
            durationSec: dur,
            filmOutputReadiness: readiness,
            filmDeliveryState,
            filmUserHint: hint,
            lastFilmWorkflowFailure: lastFailure,
            hasUrl,
            canTryPlayback,
            suggestMontageJump,
            statusExplain,
            primaryChapterId,
            playableSourceChapterId,
            montageDeepLink,
            showOpenChapterWithFile,
            filmReconcileMeta,
            riskLine,
            simple,
            filmVerificationEffective,
            playbackEntries,
            playbackMoment,
            chaptersCount: sum.chaptersCount ?? 0,
            chaptersCompleted: sum.filmChaptersCompletedCount ?? 0,
            confidence,
          };
        }),
      );
      setRows(enriched);
    } finally {
      setLoading(false);
    }
  }, []);

  const runCardVerification = useCallback(async (projectId) => {
    if (!projectId) return;
    setVerifyBusyId(projectId);
    try {
      await runAndPersistFilmOutputVerification(projectId);
      await refresh();
    } finally {
      setVerifyBusyId(null);
    }
  }, [refresh]);

  useEffect(() => {
    if (!homeActive) return;
    void refresh();
  }, [homeActive, refresh]);

  useEffect(() => {
    if (!homeActive) return undefined;
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
    };
  }, [homeActive, refresh]);

  if (!homeActive || loading || rows.length === 0) return null;

  const playableCount = rows.filter((r) => r.canTryPlayback).length;
  const fragileCount = rows.length - playableCount;

  return (
    <>
      <h2
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: AX.muted,
          margin: "8px 0 8px",
          flexShrink: 0,
        }}
      >
        Film completati · percorso Scenografie
      </h2>
      <p style={{ fontSize: 11, color: AX.muted, margin: "0 0 14px", lineHeight: 1.45, flexShrink: 0 }}>
        Stesso percorso dell’hub Scenografie. Sopra ogni scheda trovi una sintesi in cinque livelli (es. «Pronto da
        guardare», «Da verificare»); sotto, dettaglio e azione consigliata. Stato ricalcolato dal file progetto.
      </p>
      {fragileCount > 0 ? (
        <p style={{ fontSize: 11, color: AX.muted, margin: "0 0 14px", lineHeight: 1.45, flexShrink: 0 }}>
          {playableCount > 0
            ? `${playableCount} pronti per la riproduzione · ${fragileCount} con avviso o senza file (le schede restano visibili: leggi il badge sotto ogni titolo).`
            : `Alcuni progetti risultano avanzati ma il file non è utilizzabile da qui: apri il capitolo suggerito in Scenografie per sistemare o rigenerare.`}
        </p>
      ) : (
        <p style={{ fontSize: 11, color: AX.muted, margin: "0 0 14px", lineHeight: 1.45, flexShrink: 0 }}>
          I link video dipendono dal servizio remoto. «Montaggio in corso» o «file assente» si risolvono riaprendo il
          progetto; «Vai al montaggio» apre il capitolo più utile quando possibile.
        </p>
      )}
      <div style={{ marginBottom: 12, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => void refresh()}
          style={{
            padding: "8px 14px",
            borderRadius: 10,
            border: `1px solid ${AX.border}`,
            background: "rgba(20,20,28,0.6)",
            color: AX.text2,
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <HiArrowPath size={16} />
          Aggiorna elenco
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 14,
          marginBottom: 28,
          flexShrink: 0,
        }}
      >
        {rows.map((r) => {
          const primaryKind = completedFilmPrimaryKind(r);
          return (
          <div
            key={r.id}
            style={{
              borderRadius: 16,
              border: `1px solid ${r.canTryPlayback ? AX.border : "rgba(251,191,36,0.35)"}`,
              background: AX.surface,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              opacity: 1,
            }}
          >
            <div style={{ aspectRatio: "2/3", background: "#0a0a0f", position: "relative" }}>
              {r.poster ? (
                <img alt="" src={r.poster} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <HiFilm size={36} style={{ color: AX.muted }} />
                </div>
              )}
              <div
                style={{
                  position: "absolute",
                  bottom: 8,
                  left: 8,
                  right: 8,
                  fontSize: 10,
                  fontWeight: 800,
                  color: filmCardAccent(r.filmDeliveryState, r.filmOutputReadiness, r.hasUrl),
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  textShadow: "0 1px 4px rgba(0,0,0,0.8)",
                }}
              >
                {r.simple?.primaryLine || deliveryBadgeLabel(r.filmDeliveryState, r.filmOutputReadiness)}
              </div>
            </div>
            <div style={{ padding: 12, flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: AX.text, lineHeight: 1.3 }}>{r.title}</div>
              <div style={{ fontSize: 11, color: AX.muted }}>
                {r.durationSec != null ? `~${Math.round(r.durationSec)}s` : "Durata n/d"}
                {r.updatedAt
                  ? ` · ${new Date(r.updatedAt).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" })}`
                  : ""}
                {r.chaptersCount > 1 ? ` · ${r.chaptersCompleted}/${r.chaptersCount} capitoli completati` : null}
              </div>
              <div
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: "rgba(74,222,128,0.06)",
                  border: "1px solid rgba(74,222,128,0.25)",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 800, color: AX.muted, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                  Film finale · sintesi
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: AX.text, lineHeight: 1.35, marginTop: 4 }}>{r.simple.primaryLine}</div>
                {r.simple.detailLine ? (
                  <div style={{ fontSize: 11, color: AX.text2, marginTop: 6, lineHeight: 1.45 }}>{r.simple.detailLine}</div>
                ) : null}
                {r.riskLine ? (
                  <div style={{ fontSize: 10, color: "#fb923c", marginTop: 6, lineHeight: 1.4 }}>
                    <strong>Attenzione:</strong> {r.riskLine}
                  </div>
                ) : null}
                {r.simple.nextStepLine ? (
                  <div style={{ fontSize: 11, color: AX.electric, marginTop: 6, lineHeight: 1.45 }}>
                    <strong>Prossimo passo:</strong> {r.simple.nextStepLine}
                  </div>
                ) : null}
                {r.simple.verificationLine ? (
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, lineHeight: 1.45 }}>
                    <strong>Verifica reale:</strong> {r.simple.verificationLine}
                    {r.filmVerificationEffective?.checkedAt ? (
                      <span style={{ display: "block", fontSize: 10, color: AX.muted, marginTop: 4 }}>
                        Ultimo controllo:{" "}
                        {new Date(r.filmVerificationEffective.checkedAt).toLocaleString("it-IT")}
                        {r.filmVerificationEffective.method ? ` · ${r.filmVerificationEffective.method}` : ""}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <details style={{ marginTop: 8, fontSize: 10, color: AX.muted, lineHeight: 1.45 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 700, color: AX.text2, userSelect: "none" }}>
                    Dettaglio tecnico
                  </summary>
                  <div style={{ marginTop: 6 }}>{r.simple.technicalHeadline}</div>
                  {r.filmUserHint ? <div style={{ marginTop: 4 }}>{r.filmUserHint}</div> : null}
                  <div style={{ marginTop: 4, fontSize: 9, opacity: 0.9 }}>
                    {FILM_DELIVERY_LABEL_IT[r.filmDeliveryState] || r.filmDeliveryState} ·{" "}
                    {filmReadinessBadgeLabel(r.filmOutputReadiness)}
                  </div>
                </details>
              </div>
              {r.statusExplain ? (
                <p style={{ fontSize: 10, color: AX.muted, margin: 0, lineHeight: 1.4 }}>{r.statusExplain}</p>
              ) : null}
              {!r.canTryPlayback ? (
                <p style={{ fontSize: 10, color: "#fbbf24", margin: 0, lineHeight: 1.4 }}>
                  {r.lastFilmWorkflowFailure?.errorMessageUser ||
                    "Non disponibile da qui: apri il progetto o rigenera il montaggio."}
                </p>
              ) : null}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
                {primaryKind === "verify_final" ? (
                  <button
                    type="button"
                    onClick={() => void runCardVerification(r.id)}
                    disabled={verifyBusyId === r.id}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "none",
                      background: AX.gradPrimary,
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: 13,
                      cursor: verifyBusyId === r.id ? "wait" : "pointer",
                      opacity: verifyBusyId === r.id ? 0.85 : 1,
                    }}
                  >
                    {verifyBusyId === r.id ? "Verifica in corso…" : "Verifica file finale"}
                  </button>
                ) : null}
                {primaryKind === "watch" || primaryKind === "verify_final" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPlaybackError(null);
                      setPlayerReloadKey((k) => k + 1);
                      setPlayer({
                        id: r.id,
                        title: r.title,
                        entries: r.playbackEntries && r.playbackEntries.length ? r.playbackEntries : [],
                        activeIndex: 0,
                        openedAtIso: new Date().toISOString(),
                        filmOutputReadiness: r.filmOutputReadiness,
                        montageDeepLink: r.montageDeepLink,
                        primaryChapterId: r.primaryChapterId,
                        playableSourceChapterId: r.playableSourceChapterId,
                        showOpenChapterWithFile: r.showOpenChapterWithFile,
                        simplePrimary: r.simple.primaryLine,
                        playbackMoment: describeFinalFilmPlaybackMoment(
                          r.simple.tier,
                          r.filmOutputReadiness,
                          r.filmVerificationEffective,
                        ),
                      });
                    }}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: primaryKind === "verify_final" ? `1px solid ${AX.border}` : "none",
                      background: primaryKind === "verify_final" ? "transparent" : AX.gradPrimary,
                      color: primaryKind === "verify_final" ? AX.electric : "#fff",
                      fontWeight: 800,
                      fontSize: 13,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    <HiPlay size={18} />
                    Guarda ora
                  </button>
                ) : null}
                {primaryKind === "watch" && r.hasUrl ? (
                  <button
                    type="button"
                    onClick={() => void runCardVerification(r.id)}
                    disabled={verifyBusyId === r.id}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: `1px solid rgba(41,182,255,0.4)`,
                      background: "rgba(41,182,255,0.08)",
                      color: AX.electric,
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: verifyBusyId === r.id ? "wait" : "pointer",
                    }}
                  >
                    {verifyBusyId === r.id ? "Verifica…" : "Verifica file finale"}
                  </button>
                ) : null}
                {primaryKind === "verify" ? (
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        window.open(r.filmUrl, "_blank", "noopener,noreferrer");
                      } catch {
                        /* ignore */
                      }
                    }}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "none",
                      background: AX.gradPrimary,
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    Verifica file
                  </button>
                ) : null}
                {primaryKind === "montage" && typeof onOpenScenografieProject === "function" ? (
                  <button
                    type="button"
                    onClick={() => onOpenScenografieProject(r.id, r.montageDeepLink)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "none",
                      background: AX.gradPrimary,
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    Vai al montaggio
                  </button>
                ) : null}
                {primaryKind === "project" && typeof onOpenScenografieProject === "function" ? (
                  <button
                    type="button"
                    onClick={() => onOpenScenografieProject(r.id, r.primaryChapterId ? { chapterId: r.primaryChapterId } : null)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "none",
                      background: AX.gradPrimary,
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    Apri progetto
                  </button>
                ) : null}

                {typeof onOpenScenografieProject === "function" ? (
                  <>
                    {primaryKind !== "project" ? (
                      <button
                        type="button"
                        onClick={() => onOpenScenografieProject(r.id, r.primaryChapterId ? { chapterId: r.primaryChapterId } : null)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 10,
                          border: `1px solid ${AX.border}`,
                          background: "transparent",
                          color: AX.electric,
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        Apri progetto
                      </button>
                    ) : null}
                    {r.suggestMontageJump && primaryKind !== "montage" ? (
                      <button
                        type="button"
                        onClick={() => onOpenScenografieProject(r.id, r.montageDeepLink)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 10,
                          border: `1px solid rgba(123,77,255,0.45)`,
                          background: "rgba(123,77,255,0.08)",
                          color: "#c4b5fd",
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        Vai al montaggio
                      </button>
                    ) : null}
                    {r.showOpenChapterWithFile && r.playableSourceChapterId ? (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenScenografieProject(r.id, { chapterId: r.playableSourceChapterId, focus: "montage" })
                        }
                        style={{
                          padding: "8px 12px",
                          borderRadius: 10,
                          border: `1px solid rgba(74,222,128,0.4)`,
                          background: "rgba(74,222,128,0.06)",
                          color: "#86efac",
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        Apri capitolo con il file
                      </button>
                    ) : null}
                  </>
                ) : null}
                {primaryKind === "watch" && r.hasUrl ? (
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        window.open(r.filmUrl, "_blank", "noopener,noreferrer");
                      } catch {
                        /* ignore */
                      }
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: `1px solid ${AX.border}`,
                      background: "transparent",
                      color: AX.text2,
                      fontWeight: 600,
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Apri link in nuova scheda
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void refresh()}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: `1px solid ${AX.border}`,
                    background: "rgba(20,20,28,0.6)",
                    color: AX.muted,
                    fontWeight: 600,
                    fontSize: 11,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <HiArrowPath size={14} />
                  Ricalcola stato
                </button>
              </div>
            </div>
          </div>
        );
        })}
      </div>

      {player && (
        <div
          className="ax-modal-touch-lock"
          role="dialog"
          aria-modal="true"
          aria-label="Riproduzione film"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1500,
            background: "rgba(6,6,12,0.85)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => {
            setPlayer(null);
            setPlaybackError(null);
            setPlayerReloadKey((k) => k + 1);
          }}
        >
          <div style={{ width: "min(900px, 100%)", maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
            {(() => {
              const entries = Array.isArray(player.entries) ? player.entries : [];
              const ix = Math.min(
                Math.max(0, Number(player.activeIndex) || 0),
                Math.max(0, entries.length - 1),
              );
              const cur = entries[ix];
              const activeUrl = cur?.url || "";
              const hasAlt = ix < entries.length - 1;
              const moment = player.playbackMoment;
              const errHint =
                playbackError && typeof playbackError === "object" ? playbackError.browserHint : null;
              const errAt =
                playbackError && typeof playbackError === "object" && playbackError.atIso
                  ? new Date(playbackError.atIso).toLocaleString("it-IT")
                  : null;
              return (
                <>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12, gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{player.title}</div>
                      {moment ? (
                        <div
                          style={{
                            marginTop: 8,
                            padding: "10px 12px",
                            borderRadius: 10,
                            background: "rgba(41,182,255,0.12)",
                            border: "1px solid rgba(41,182,255,0.35)",
                            fontSize: 12,
                            color: "rgba(255,255,255,0.88)",
                            lineHeight: 1.5,
                          }}
                        >
                          <strong style={{ color: "#7dd3fc" }}>{moment.headline}</strong>
                          <div style={{ marginTop: 4, opacity: 0.95 }}>{moment.subline}</div>
                        </div>
                      ) : null}
                      {player.simplePrimary ? (
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)", marginTop: 8, lineHeight: 1.4 }}>
                          Sintesi stato: <strong style={{ color: "#86efac" }}>{player.simplePrimary}</strong>
                        </div>
                      ) : null}
                      {cur ? (
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.62)", marginTop: 8, lineHeight: 1.45 }}>
                          <strong style={{ color: "rgba(255,255,255,0.85)" }}>Sorgente in uso:</strong> {cur.sourceLabel}
                          {entries.length > 1 ? (
                            <span>
                              {" "}
                              · {entries.length - 1 - ix} altra/e sorgente/i salvata/e oltre a questa
                            </span>
                          ) : null}
                          {player.openedAtIso ? (
                            <span>
                              {" "}
                              · play avviato: {new Date(player.openedAtIso).toLocaleString("it-IT")}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      aria-label="Chiudi"
                      onClick={() => {
                        setPlayer(null);
                        setPlaybackError(null);
                        setPlayerReloadKey((k) => k + 1);
                      }}
                      style={{
                        padding: 8,
                        borderRadius: 10,
                        border: `1px solid ${AX.border}`,
                        background: AX.surface,
                        color: AX.text,
                        cursor: "pointer",
                      }}
                    >
                      <HiXMark size={22} />
                    </button>
                  </div>
                  {playbackError ? (
                    <div
                      style={{
                        padding: 14,
                        borderRadius: 12,
                        background: "rgba(127,29,29,0.35)",
                        border: "1px solid rgba(248,113,113,0.45)",
                        color: "#fecaca",
                        fontSize: 13,
                        lineHeight: 1.5,
                        marginBottom: 12,
                      }}
                    >
                      <strong>Il lettore incorporato non è riuscito a riprodurre il file.</strong>
                      <div style={{ marginTop: 8 }}>
                        Non è un vicolo cieco: spesso il problema è il link remoto (scadenza), la rete o un limite del browser —
                        non necessariamente il progetto.
                      </div>
                      {errHint ? (
                        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.95 }}>
                          <strong>Indizio dal browser:</strong> {errHint}
                        </div>
                      ) : null}
                      {errAt ? (
                        <div style={{ marginTop: 6, fontSize: 11, opacity: 0.85 }}>Ultimo tentativo: {errAt}</div>
                      ) : null}
                      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.92 }}>
                        <strong>Passi utili:</strong> riprova qui, apri in nuova scheda (spesso aggira blocchi del player), prova un
                        altro MP4 salvato se ce n’è uno, poi verifica dal montaggio nel progetto.
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
                        <button
                          type="button"
                          onClick={() => {
                            setPlaybackError(null);
                            setPlayerReloadKey((k) => k + 1);
                          }}
                          style={{
                            padding: "8px 14px",
                            borderRadius: 10,
                            border: "none",
                            background: AX.gradPrimary,
                            color: "#fff",
                            fontWeight: 800,
                            fontSize: 12,
                            cursor: "pointer",
                          }}
                        >
                          Riprova qui
                        </button>
                        {hasAlt ? (
                          <button
                            type="button"
                            onClick={() => {
                              setPlayer((prev) =>
                                prev ? { ...prev, activeIndex: ix + 1 } : prev,
                              );
                              setPlaybackError(null);
                              setPlayerReloadKey((k) => k + 1);
                            }}
                            style={{
                              padding: "8px 14px",
                              borderRadius: 10,
                              border: "1px solid rgba(74,222,128,0.45)",
                              background: "rgba(74,222,128,0.12)",
                              color: "#bbf7d0",
                              fontWeight: 700,
                              fontSize: 12,
                              cursor: "pointer",
                            }}
                          >
                            Prova altra sorgente salvata
                          </button>
                        ) : null}
                        {activeUrl ? (
                          <button
                            type="button"
                            onClick={() => {
                              try {
                                window.open(activeUrl, "_blank", "noopener,noreferrer");
                              } catch {
                                /* ignore */
                              }
                            }}
                            style={{
                              padding: "8px 14px",
                              borderRadius: 10,
                              border: `1px solid ${AX.border}`,
                              background: AX.surface,
                              color: AX.electric,
                              fontWeight: 700,
                              fontSize: 12,
                              cursor: "pointer",
                            }}
                          >
                            Apri in nuova scheda
                          </button>
                        ) : null}
                        {typeof onOpenScenografieProject === "function" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                onOpenScenografieProject(player.id, player.montageDeepLink || { focus: "montage" });
                                setPlayer(null);
                                setPlaybackError(null);
                              }}
                              style={{
                                padding: "8px 14px",
                                borderRadius: 10,
                                border: "1px solid rgba(196,181,253,0.5)",
                                background: "rgba(123,77,255,0.2)",
                                color: "#e9d5ff",
                                fontWeight: 700,
                                fontSize: 12,
                                cursor: "pointer",
                              }}
                            >
                              Vai al montaggio
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onOpenScenografieProject(player.id, null);
                                setPlayer(null);
                                setPlaybackError(null);
                              }}
                              style={{
                                padding: "8px 14px",
                                borderRadius: 10,
                                border: `1px solid ${AX.border}`,
                                background: "rgba(20,20,28,0.9)",
                                color: AX.text2,
                                fontWeight: 700,
                                fontSize: 12,
                                cursor: "pointer",
                              }}
                            >
                              Apri progetto
                            </button>
                            {player.showOpenChapterWithFile && player.playableSourceChapterId ? (
                              <button
                                type="button"
                                onClick={() => {
                                  onOpenScenografieProject(player.id, {
                                    chapterId: player.playableSourceChapterId,
                                    focus: "montage",
                                  });
                                  setPlayer(null);
                                  setPlaybackError(null);
                                }}
                                style={{
                                  padding: "8px 14px",
                                  borderRadius: 10,
                                  border: "1px solid rgba(74,222,128,0.4)",
                                  background: "rgba(74,222,128,0.08)",
                                  color: "#86efac",
                                  fontWeight: 700,
                                  fontSize: 12,
                                  cursor: "pointer",
                                }}
                              >
                                Apri capitolo con il file
                              </button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <video
                    key={`${player.id}-${playerReloadKey}-${ix}`}
                    src={activeUrl || undefined}
                    controls
                    autoPlay
                    playsInline
                    onLoadedData={() => setPlaybackError(null)}
                    onError={(e) => {
                      const v = e?.target;
                      setPlaybackError({
                        browserHint: humanizeHtml5VideoElementError(v),
                        atIso: new Date().toISOString(),
                      });
                    }}
                    style={{ width: "100%", maxHeight: "calc(90vh - 60px)", borderRadius: 12, background: "#000" }}
                  />
                  {!playbackError && activeUrl ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            window.open(activeUrl, "_blank", "noopener,noreferrer");
                          } catch {
                            /* ignore */
                          }
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 8,
                          border: `1px solid ${AX.border}`,
                          background: "rgba(20,20,28,0.75)",
                          color: AX.text2,
                          fontWeight: 600,
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        Apri in nuova scheda (stessa sorgente)
                      </button>
                      {hasAlt ? (
                        <button
                          type="button"
                          onClick={() => {
                            setPlayer((prev) => (prev ? { ...prev, activeIndex: ix + 1 } : prev));
                            setPlaybackError(null);
                            setPlayerReloadKey((k) => k + 1);
                          }}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 8,
                            border: "1px solid rgba(74,222,128,0.35)",
                            background: "rgba(74,222,128,0.06)",
                            color: "#86efac",
                            fontWeight: 600,
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                        >
                          Passa a sorgente alternativa
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </>
  );
}
