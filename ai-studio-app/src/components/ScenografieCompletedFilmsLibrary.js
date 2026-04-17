/**
 * Home — libreria film Scenografie: consegne guardabili, quasi pronte e da recuperare.
 */

import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react";
import {
  HiFilm,
  HiPlay,
  HiXMark,
  HiArrowPath,
  HiMagnifyingGlass,
  HiArrowTopRightOnSquare,
  HiRectangleStack,
  HiShieldCheck,
} from "react-icons/hi2";
import {
  loadScenografiaProjectsIndex,
  loadScenografiaProjectById,
  ensureWorkspace,
  summarizeScenografiaWorkspaceForIndex,
  runAndPersistFilmOutputVerification,
} from "../services/scenografieProjectPersistence.js";
import {
  FILM_OUTPUT_READINESS,
  FILM_DELIVERY_STATE,
  workspaceEligibleForCompletedFilmsLibrary,
  deriveConsumerFilmConfidence,
  deriveFinalOutputSimplePresentation,
  FINAL_OUTPUT_SIMPLE_TIER,
  buildFinalFilmPlaybackCandidates,
  describeFinalFilmPlaybackMoment,
  humanizeHtml5VideoElementError,
} from "../services/scenografieConsumerReliability.js";
import { shelfGridContentMinHeight } from "../home/shelfGridMetrics.js";
import { HOME_SHELF_EMPTY_WRAP } from "../home/shelfHomeLayoutStyles.js";
import { HOME_SHELF_VIEW_MODE } from "../home/homeShelfViewMode.js";
import { buildHomeGridLayoutDebugPayload, logHomeGridLayoutDebug } from "../home/shelfLayoutDebug.js";

const AX = {
  surface: "#13131a",
  border: "#23232e",
  text: "#f4f4f8",
  text2: "#a1a1b5",
  muted: "#6b6b80",
  electric: "#29b6ff",
  gradPrimary: "linear-gradient(135deg, #29b6ff 0%, #7b4dff 100%)",
};

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

/** Metadati capitoli: una sola stringa compatta per la riga sotto il titolo. */
function filmChaptersMetaLine(r) {
  const n = r.chaptersCount ?? 0;
  if (n <= 0) return "";
  if (n === 1) return "1 cap.";
  const done = r.chaptersCompleted ?? 0;
  return `${done}/${n} cap.`;
}

/** Stato sintetico file finale guardabile da Home (no paragrafi tecnici). */
function filmFinalAvailabilityShort(r) {
  if (r.canTryPlayback) return { label: "Disponibile", ok: true };
  return { label: "Non disponibile", ok: false };
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
 * @param {{ homeActive?: boolean, suppressWhenTabNotFilm?: boolean, onOpenScenografieProject?: (projectId: string, deepLink?: object|null) => void, onFilmsPresenceChange?: (meta: { loading: boolean, hasFilms: boolean }) => void, simplifiedHomeCards?: boolean, fixedFourColumnHomeGrid?: boolean, homeViewMode?: "grid"|"list", homeGridCols?: number, homeGridVisibleRows?: number, homeGridGap?: number, homeShelfMetrics?: { cellHeight: number, cellWidth: number, columns: number, visibleRows: number, gap: number } | null, homeShelfViewportInnerW?: number, titleSearch?: string }} props
 */
export default function ScenografieCompletedFilmsLibrary({
  homeActive = true,
  suppressWhenTabNotFilm = false,
  onOpenScenografieProject,
  onFilmsPresenceChange,
  simplifiedHomeCards = false,
  fixedFourColumnHomeGrid = false,
  homeViewMode = "grid",
  homeGridCols = 4,
  homeGridVisibleRows = 3,
  homeGridGap = 10,
  homeShelfMetrics = null,
  homeShelfViewportInnerW = 0,
  titleSearch = "",
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [player, setPlayer] = useState(null);
  const [playbackError, setPlaybackError] = useState(null);
  const [playerReloadKey, setPlayerReloadKey] = useState(0);
  const [verifyBusyId, setVerifyBusyId] = useState(null);
  const filmShelfGridRef = useRef(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setRows([]);
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

  const openPlayerForRow = useCallback((r) => {
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
  }, []);

  useEffect(() => {
    if (!homeActive) return;
    if (suppressWhenTabNotFilm) return;
    void refresh();
  }, [homeActive, suppressWhenTabNotFilm, refresh]);

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

  useEffect(() => {
    if (typeof onFilmsPresenceChange !== "function" || !homeActive) return;
    if (suppressWhenTabNotFilm) {
      onFilmsPresenceChange({ loading: true, hasFilms: false });
      return;
    }
    onFilmsPresenceChange({ loading, hasFilms: rows.length > 0 });
  }, [homeActive, suppressWhenTabNotFilm, loading, rows.length, onFilmsPresenceChange]);

  const rowsToShow = useMemo(() => {
    const n = typeof titleSearch === "string" ? titleSearch.trim().toLowerCase() : "";
    if (!n) return rows;
    return rows.filter((r) => {
      const blob = [
        r.title,
        r.simple?.primaryLine,
        r.simple?.detailLine,
        r.simple?.technicalHeadline,
        r.filmUserHint,
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      return blob.includes(n);
    });
  }, [rows, titleSearch]);

  useLayoutEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (!homeActive || suppressWhenTabNotFilm || !fixedFourColumnHomeGrid) return;
    if (homeViewMode !== HOME_SHELF_VIEW_MODE.grid || !homeShelfMetrics) return;
    if (rowsToShow.length === 0) return;
    const gridEl = filmShelfGridRef.current;
    if (!gridEl) return;
    const firstTile = gridEl.firstElementChild;
    const firstInner = firstTile?.querySelector?.("[data-ax-shelf-tile-inner]");
    logHomeGridLayoutDebug(
      buildHomeGridLayoutDebugPayload(
        "film",
        rowsToShow.length,
        homeGridCols,
        homeShelfMetrics.cellWidth,
        gridEl,
        firstTile instanceof HTMLElement ? firstTile : null,
        firstInner instanceof HTMLElement ? firstInner : null,
        { containerInnerWidth: homeShelfViewportInnerW },
      ),
    );
  }, [
    homeActive,
    suppressWhenTabNotFilm,
    fixedFourColumnHomeGrid,
    homeViewMode,
    homeShelfMetrics,
    rowsToShow.length,
    homeGridCols,
    homeShelfViewportInnerW,
  ]);

  if (!homeActive || loading) return null;
  if (rows.length === 0) return null;
  if (suppressWhenTabNotFilm) return null;

  /** Home vetrina: celle ad altezza fissa da ResizeObserver (scroll solo oltre le righe previste). */
  const shelfCellH =
    fixedFourColumnHomeGrid && homeShelfMetrics && Number.isFinite(homeShelfMetrics.cellHeight)
      ? homeShelfMetrics.cellHeight
      : 0;
  const homeListMode = fixedFourColumnHomeGrid && homeViewMode === HOME_SHELF_VIEW_MODE.list;
  const useShelfCell = simplifiedHomeCards && shelfCellH > 0;
  const cardRadius = useShelfCell ? Math.max(5, Math.min(14, Math.round(shelfCellH * 0.11))) : 18;
  const badgeFont = useShelfCell ? Math.max(7, Math.min(11, Math.round(shelfCellH * 0.095))) : 11;
  const titleFont = useShelfCell ? Math.max(9, Math.min(15, Math.round(shelfCellH * 0.14))) : 16;
  const metaFont = useShelfCell ? Math.max(8, Math.min(11, Math.round(shelfCellH * 0.08))) : 11;
  const showFilmFooter = !useShelfCell || shelfCellH >= 76;

  const gridMinHeight =
    fixedFourColumnHomeGrid && homeShelfMetrics
      ? shelfGridContentMinHeight(rowsToShow.length, homeGridCols, homeShelfMetrics.cellHeight, homeGridGap)
      : undefined;

  /** Vista elenco Home: righe cliccabili (stesso datasource di `rowsToShow`). */
  const listInner = homeListMode ? (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        flex: "0 0 auto",
        alignSelf: "stretch",
        boxSizing: "border-box",
      }}
    >
      {rowsToShow.map((r) => {
        const primaryKind = completedFilmPrimaryKind(r);
        const fin = filmFinalAvailabilityShort(r);
        const ch = filmChaptersMetaLine(r);
        const sub = [
          ch || null,
          `Finale: ${fin.label}`,
          r.updatedAt
            ? new Date(r.updatedAt).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" })
            : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const rowAct = () => {
          if (primaryKind === "watch" || primaryKind === "verify_final") {
            openPlayerForRow(r);
            return;
          }
          if (primaryKind === "verify" && r.filmUrl) {
            try {
              window.open(r.filmUrl, "_blank", "noopener,noreferrer");
            } catch {
              /* ignore */
            }
            return;
          }
          if (typeof onOpenScenografieProject === "function") {
            onOpenScenografieProject(r.id, { focus: "project" });
          }
        };
        return (
          <button
            key={r.id}
            type="button"
            onClick={rowAct}
            title={r.title}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              width: "100%",
              minWidth: 0,
              padding: "8px 12px",
              borderRadius: 10,
              border: `1px solid ${AX.border}`,
              background: "rgba(16,18,26,0.78)",
              cursor: "pointer",
              textAlign: "left",
              boxSizing: "border-box",
              transition: "border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = AX.electric;
              e.currentTarget.style.background = "rgba(41,182,255,0.06)";
              e.currentTarget.style.boxShadow = "0 4px 18px rgba(0,0,0,0.28)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = AX.border;
              e.currentTarget.style.background = "rgba(16,18,26,0.78)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div
              style={{
                width: 44,
                aspectRatio: "27/40",
                flexShrink: 0,
                borderRadius: 8,
                overflow: "hidden",
                background: "#0a0a0f",
                border: `1px solid ${AX.border}`,
                boxSizing: "border-box",
              }}
            >
              {r.poster ? (
                <img alt="" src={r.poster} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", display: "block" }} />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <HiFilm size={22} style={{ color: AX.muted }} />
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: AX.text,
                  lineHeight: 1.25,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.title}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: AX.muted,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {sub || "Film Scenografie"}
              </div>
            </div>
            <span
              style={{
                flexShrink: 0,
                maxWidth: "36%",
                fontSize: 10,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                lineHeight: 1.25,
                padding: "5px 8px",
                borderRadius: 6,
                color: fin.ok ? "#86efac" : "#fbbf24",
                background: "rgba(0,0,0,0.35)",
                border: `1px solid ${fin.ok ? "rgba(74,222,128,0.35)" : "rgba(251,191,36,0.45)"}`,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {fin.label}
            </span>
          </button>
        );
      })}
    </div>
  ) : null;

  const gridInner = (
        <div
          ref={filmShelfGridRef}
          data-ax-home-shelf-grid="film"
          style={{
            display: "grid",
            gridTemplateColumns: fixedFourColumnHomeGrid
              ? `repeat(${homeGridCols}, ${homeShelfMetrics ? homeShelfMetrics.cellWidth : 0}px)`
              : "repeat(auto-fill, minmax(min(100%, 360px), 1fr))",
            gap: fixedFourColumnHomeGrid ? homeGridGap : 20,
            marginBottom: 0,
            flexShrink: 0,
            ...(fixedFourColumnHomeGrid && homeShelfMetrics
              ? {
                  flex: "0 0 auto",
                  alignSelf: "flex-start",
                  boxSizing: "border-box",
                  width: "max-content",
                  justifyContent: "start",
                  justifyItems: "start",
                  gridAutoRows: `${homeShelfMetrics.cellHeight}px`,
                  minHeight: gridMinHeight,
                  alignContent: "start",
                }
              : {}),
          }}
        >
        {rowsToShow.map((r) => {
          const primaryKind = completedFilmPrimaryKind(r);
          const fin = filmFinalAvailabilityShort(r);
          const chLine = filmChaptersMetaLine(r);
          const iconSz = useShelfCell ? Math.max(14, Math.min(20, Math.round(shelfCellH * 0.12))) : 18;
          const actionBtn = useShelfCell ? Math.max(28, Math.min(40, Math.round(shelfCellH * 0.26))) : 36;
          const microShelfClick = () => {
            if (primaryKind === "watch" || primaryKind === "verify_final") {
              openPlayerForRow(r);
              return;
            }
            if (typeof onOpenScenografieProject === "function") {
              onOpenScenografieProject(r.id, { focus: "project" });
            }
          };
          const posterInteractive = useShelfCell && showFilmFooter;
          return (
          <div
            key={r.id}
            data-ax-shelf-tile={useShelfCell ? "film" : undefined}
            role={useShelfCell && !showFilmFooter ? "button" : undefined}
            tabIndex={useShelfCell && !showFilmFooter ? 0 : undefined}
            onKeyDown={
              useShelfCell && !showFilmFooter
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      microShelfClick();
                    }
                  }
                : undefined
            }
            onClick={useShelfCell && !showFilmFooter ? microShelfClick : undefined}
            style={{
              borderRadius: cardRadius,
              border: `1px solid ${r.canTryPlayback ? AX.border : "rgba(251,191,36,0.35)"}`,
              background: AX.surface,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              opacity: 1,
              boxShadow: useShelfCell ? "0 8px 20px rgba(0,0,0,0.28)" : "0 18px 40px rgba(0,0,0,0.35)",
              ...(useShelfCell
                ? {
                    width: homeShelfMetrics.cellWidth,
                    minWidth: homeShelfMetrics.cellWidth,
                    maxWidth: homeShelfMetrics.cellWidth,
                    justifySelf: "start",
                    height: "100%",
                    minHeight: 0,
                    cursor: "pointer",
                    boxSizing: "border-box",
                  }
                : {}),
            }}
          >
            {/* Locandina: area dominante; chip stato compatto (no paragrafi tecnici). */}
            <div
              role={posterInteractive ? "button" : undefined}
              tabIndex={posterInteractive ? 0 : undefined}
              onKeyDown={
                posterInteractive
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        microShelfClick();
                      }
                    }
                  : undefined
              }
              onClick={posterInteractive ? () => microShelfClick() : undefined}
              data-ax-shelf-tile-inner={useShelfCell ? true : undefined}
              style={
                useShelfCell
                  ? {
                      flex: "1 1 0",
                      minHeight: 0,
                      width: "100%",
                      minWidth: 0,
                      background: "#0a0a0f",
                      position: "relative",
                      cursor: posterInteractive ? "pointer" : undefined,
                    }
                  : {
                      aspectRatio: "2 / 3",
                      minHeight: 200,
                      background: "#0a0a0f",
                      position: "relative",
                      cursor: posterInteractive ? "pointer" : undefined,
                    }
              }
            >
              {r.poster ? (
                <img alt="" src={r.poster} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", display: "block" }} />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <HiFilm size={useShelfCell ? Math.max(20, Math.round(shelfCellH * 0.45)) : 48} style={{ color: AX.muted }} />
                </div>
              )}
              <div
                style={{
                  position: "absolute",
                  bottom: useShelfCell ? Math.max(6, Math.round(shelfCellH * 0.06)) : 10,
                  right: useShelfCell ? Math.max(6, Math.round(shelfCellH * 0.06)) : 10,
                  left: "auto",
                  maxWidth: "58%",
                  pointerEvents: "none",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    fontSize: badgeFont,
                    fontWeight: 800,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    textShadow: "0 1px 6px rgba(0,0,0,0.85)",
                    padding: "4px 9px",
                    borderRadius: 999,
                    border: fin.ok ? "1px solid rgba(74,222,128,0.45)" : "1px solid rgba(251,191,36,0.4)",
                    background: "rgba(6,6,10,0.72)",
                    backdropFilter: "blur(6px)",
                    color: fin.ok ? "#bbf7d0" : "#fde68a",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {fin.label}
                </span>
              </div>
            </div>
            {showFilmFooter ? (
            <div
              style={{
                padding: useShelfCell ? `${Math.max(6, Math.round(shelfCellH * 0.07))}px ${Math.max(8, Math.round(shelfCellH * 0.08))}px` : "12px 14px 14px",
                flex: useShelfCell ? "0 0 auto" : 1,
                display: "flex",
                flexDirection: "column",
                gap: useShelfCell ? Math.max(3, Math.round(shelfCellH * 0.04)) : 8,
                minHeight: 0,
                borderTop: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div
                style={{
                  fontSize: titleFont,
                  fontWeight: 800,
                  color: AX.text,
                  lineHeight: 1.2,
                  letterSpacing: "-0.02em",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  wordBreak: "break-word",
                }}
              >
                {r.title}
              </div>
              <div
                style={{
                  fontSize: metaFont,
                  color: AX.muted,
                  lineHeight: 1.3,
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "4px 8px",
                }}
              >
                {chLine ? <span>{chLine}</span> : null}
                {chLine ? <span style={{ opacity: 0.35 }}>·</span> : null}
                <span style={{ color: fin.ok ? "rgba(134,239,172,0.95)" : AX.text2 }}>Finale: {fin.label}</span>
                {r.updatedAt ? (
                  <span style={{ fontSize: Math.max(9, metaFont - 1), opacity: 0.75 }}>
                    · {new Date(r.updatedAt).toLocaleDateString("it-IT", { day: "numeric", month: "short" })}
                  </span>
                ) : null}
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: useShelfCell ? 4 : 6,
                  marginTop: "auto",
                  paddingTop: useShelfCell ? 4 : 6,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {primaryKind === "verify_final" ? (
                  <button
                    type="button"
                    title={verifyBusyId === r.id ? "Verifica in corso…" : "Verifica file finale"}
                    aria-label={verifyBusyId === r.id ? "Verifica in corso" : "Verifica file finale"}
                    disabled={verifyBusyId === r.id}
                    onClick={() => void runCardVerification(r.id)}
                    style={{
                      width: actionBtn,
                      height: actionBtn,
                      borderRadius: Math.max(8, Math.round(actionBtn * 0.22)),
                      border: `1px solid rgba(41,182,255,0.45)`,
                      background: "rgba(41,182,255,0.12)",
                      color: AX.electric,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: verifyBusyId === r.id ? "wait" : "pointer",
                      opacity: verifyBusyId === r.id ? 0.75 : 1,
                      flexShrink: 0,
                    }}
                  >
                    <HiShieldCheck size={iconSz} />
                  </button>
                ) : null}
                {(primaryKind === "watch" || primaryKind === "verify_final") && r.canTryPlayback ? (
                  <button
                    type="button"
                    title="Riproduci"
                    aria-label="Riproduci"
                    onClick={() => openPlayerForRow(r)}
                    style={{
                      width: actionBtn,
                      height: actionBtn,
                      borderRadius: Math.max(8, Math.round(actionBtn * 0.22)),
                      border: "none",
                      background: AX.gradPrimary,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <HiPlay size={iconSz} />
                  </button>
                ) : null}
                {primaryKind === "watch" && r.hasUrl ? (
                  <button
                    type="button"
                    title="Verifica file finale"
                    aria-label="Verifica file finale"
                    disabled={verifyBusyId === r.id}
                    onClick={() => void runCardVerification(r.id)}
                    style={{
                      width: actionBtn,
                      height: actionBtn,
                      borderRadius: Math.max(8, Math.round(actionBtn * 0.22)),
                      border: `1px solid rgba(41,182,255,0.35)`,
                      background: "rgba(41,182,255,0.08)",
                      color: AX.electric,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: verifyBusyId === r.id ? "wait" : "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <HiShieldCheck size={Math.round(iconSz * 0.92)} />
                  </button>
                ) : null}
                {primaryKind === "verify" && r.filmUrl ? (
                  <button
                    type="button"
                    title="Apri file in nuova scheda"
                    aria-label="Apri file in nuova scheda"
                    onClick={() => {
                      try {
                        window.open(r.filmUrl, "_blank", "noopener,noreferrer");
                      } catch {
                        /* ignore */
                      }
                    }}
                    style={{
                      width: actionBtn,
                      height: actionBtn,
                      borderRadius: Math.max(8, Math.round(actionBtn * 0.22)),
                      border: "none",
                      background: AX.gradPrimary,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <HiArrowTopRightOnSquare size={iconSz} />
                  </button>
                ) : null}
                {primaryKind === "watch" && r.hasUrl ? (
                  <button
                    type="button"
                    title="Apri link in nuova scheda"
                    aria-label="Apri link in nuova scheda"
                    onClick={() => {
                      try {
                        window.open(r.filmUrl, "_blank", "noopener,noreferrer");
                      } catch {
                        /* ignore */
                      }
                    }}
                    style={{
                      width: actionBtn,
                      height: actionBtn,
                      borderRadius: Math.max(8, Math.round(actionBtn * 0.22)),
                      border: `1px solid ${AX.border}`,
                      background: "rgba(20,20,28,0.75)",
                      color: AX.text2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <HiArrowTopRightOnSquare size={Math.round(iconSz * 0.9)} />
                  </button>
                ) : null}
                {typeof onOpenScenografieProject === "function" && r.showOpenChapterWithFile && r.playableSourceChapterId ? (
                  <button
                    type="button"
                    title="Apri capitolo con il file"
                    aria-label="Apri capitolo con il file"
                    onClick={() => onOpenScenografieProject(r.id, { chapterId: r.playableSourceChapterId, focus: "montage" })}
                    style={{
                      width: actionBtn,
                      height: actionBtn,
                      borderRadius: Math.max(8, Math.round(actionBtn * 0.22)),
                      border: "1px solid rgba(74,222,128,0.4)",
                      background: "rgba(74,222,128,0.08)",
                      color: "#86efac",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <HiFilm size={Math.round(iconSz * 0.92)} />
                  </button>
                ) : null}
                {typeof onOpenScenografieProject === "function" ? (
                  primaryKind === "montage" ? (
                    <button
                      type="button"
                      title="Apri montaggio"
                      aria-label="Apri montaggio"
                      onClick={() => onOpenScenografieProject(r.id, r.montageDeepLink)}
                      style={{
                        width: actionBtn,
                        height: actionBtn,
                        borderRadius: Math.max(8, Math.round(actionBtn * 0.22)),
                        border: `1px solid rgba(251,191,36,0.45)`,
                        background: "rgba(251,191,36,0.08)",
                        color: "#fcd34d",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      <HiFilm size={iconSz} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      title="Apri progetto"
                      aria-label="Apri progetto"
                      onClick={() => onOpenScenografieProject(r.id, { focus: "project" })}
                      style={{
                        width: actionBtn,
                        height: actionBtn,
                        borderRadius: Math.max(8, Math.round(actionBtn * 0.22)),
                        border: `1px solid ${AX.border}`,
                        background: "rgba(20,20,28,0.85)",
                        color: AX.text2,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      <HiRectangleStack size={iconSz} />
                    </button>
                  )
                ) : null}
                <button
                  type="button"
                  title="Aggiorna stato"
                  aria-label="Aggiorna stato film"
                  onClick={() => void refresh()}
                  style={{
                    width: actionBtn,
                    height: actionBtn,
                    borderRadius: Math.max(8, Math.round(actionBtn * 0.22)),
                    border: `1px solid ${AX.border}`,
                    background: "rgba(20,20,28,0.6)",
                    color: AX.muted,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <HiArrowPath size={Math.round(iconSz * 0.88)} />
                </button>
              </div>
            </div>
            ) : null}
          </div>
        );
        })}
        </div>
  );

  return (
    <>
      {rowsToShow.length === 0 ? (
        <div
          style={{
            ...(fixedFourColumnHomeGrid ? HOME_SHELF_EMPTY_WRAP : {}),
            padding: "22px 16px",
            textAlign: "center",
            color: AX.muted,
            fontSize: 13,
            borderRadius: 14,
            border: `1px dashed ${AX.border}`,
            background: "rgba(10,10,15,0.4)",
            boxSizing: "border-box",
          }}
        >
          <HiMagnifyingGlass size={32} style={{ opacity: 0.45, marginBottom: 10 }} aria-hidden />
          <p style={{ margin: 0, fontWeight: 700, color: AX.text2 }}>Nessun film in elenco</p>
          <p style={{ margin: "8px 0 0", lineHeight: 1.5, maxWidth: 400, marginLeft: "auto", marginRight: "auto" }}>
            Nessun titolo corrisponde a «{titleSearch.trim()}». Modifica la ricerca nella barra in alto.
          </p>
        </div>
      ) : fixedFourColumnHomeGrid && homeViewMode === HOME_SHELF_VIEW_MODE.list ? (
        listInner
      ) : fixedFourColumnHomeGrid ? (
        /* Scrollport esterno (Home): il genitore ha overflow-y; qui solo griglia misurata. */
        homeShelfMetrics ? gridInner : null
      ) : (
        gridInner
      )}

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
                        {typeof onOpenScenografieProject === "function" &&
                        simplifiedHomeCards &&
                        player.showOpenChapterWithFile &&
                        player.playableSourceChapterId ? (
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
                        {typeof onOpenScenografieProject === "function" && !simplifiedHomeCards ? (
                          <>
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
