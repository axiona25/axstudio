/**
 * Elenco Capitoli dentro un Progetto narrativo (workspace) — ordinamento drag & drop.
 * UX consumer-safe: percorso capitolo, consegna film capitolo, recovery coerente con Home / Editor.
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { HiFilm, HiPlus, HiBars3, HiTrash, HiPlay, HiArrowPath } from "react-icons/hi2";
import {
  loadScenografiaProjectById,
  saveScenografiaProjectById,
  upsertScenografiaProjectInIndex,
  ensureWorkspace,
  emptyScenografiaProjectPayload,
  createChapterId,
  summarizeChapterHubCard,
  summarizeScenografiaWorkspaceForIndex,
  normalizeChapterSortOrders,
  pickChapterPosterThumbnailUrl,
  SCENOGRAFIA_UI_STATUS_LABEL,
  mergeChapterDataWithProjectCharacterPool,
  runAndPersistFilmOutputVerification,
} from "../services/scenografieProjectPersistence.js";
import {
  reconcileWorkspaceFilmOutputState,
  deriveChapterMontageConsumerSummary,
  deriveFinalOutputSimplePresentation,
  FILM_DELIVERY_LABEL_IT,
  FILM_DELIVERY_STATE,
  FILM_OUTPUT_READINESS,
  buildFinalFilmPlaybackCandidates,
  mergePlaybackEntriesChapterFirst,
  describeFinalFilmPlaybackMoment,
} from "../services/scenografieConsumerReliability.js";
import { computeChapterCompletionGaps } from "../services/scenografieOperationalReadiness.js";

const AX = {
  bg: "#0a0a0f",
  surface: "#13131a",
  card: "#1a1a24",
  border: "#23232e",
  text: "#f4f4f8",
  text2: "#a1a1b5",
  muted: "#6b6b80",
  electric: "#29b6ff",
  violet: "#7b4dff",
  gradPrimary: "linear-gradient(135deg, #29b6ff 0%, #7b4dff 100%)",
};

const STATUS_COLOR = {
  planning: AX.muted,
  character_approval: "#c084fc",
  scene_approval: "#fbbf24",
  clip_approval: "#fb923c",
  timeline_approval: "#22d3ee",
  final_film_ready: "#4ade80",
  video_production: AX.electric,
  final_montage: "#38bdf8",
  completed: "#94a3b8",
};

/**
 * @param {object|null} workspaceFilm
 * @param {string} chapterId
 * @param {number} chaptersCount
 */
function workspaceChapterRoleHint(workspaceFilm, chapterId, chaptersCount) {
  if (!workspaceFilm || chaptersCount <= 1) return null;
  const cid = chapterId != null ? String(chapterId).trim() : "";
  const src =
    workspaceFilm.pickedOutputSourceChapterId != null
      ? String(workspaceFilm.pickedOutputSourceChapterId).trim()
      : "";
  const rec =
    workspaceFilm.primaryChapterId != null ? String(workspaceFilm.primaryChapterId).trim() : "";
  const latest =
    workspaceFilm.reconcileMeta?.latestPlayableChapterId != null
      ? String(workspaceFilm.reconcileMeta.latestPlayableChapterId).trim()
      : "";
  const bits = [];
  if (cid && src && cid === src) {
    bits.push("Questo capitolo contiene il file che AXSTUDIO usa in Home per la riproduzione.");
  }
  if (cid && rec && cid === rec && chaptersCount > 1) {
    bits.push("Capitolo suggerito per sistemare montaggio o stati incoerenti nel progetto.");
  }
  if (cid && latest && cid === latest && src && cid !== src) {
    bits.push("Qui c’è il render «playable» più recente, ma la Home potrebbe mostrare un altro capitolo.");
  }
  if (bits.length) return bits.join(" ");
  return workspaceFilm.multiChapterFilmHint || null;
}

const btnSecondary = {
  padding: "8px 12px",
  borderRadius: 10,
  border: `1px solid ${AX.border}`,
  background: AX.surface,
  color: AX.text2,
  fontWeight: 700,
  fontSize: 11,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
};

/**
 * @param {{ workspaceId: string, onOpenChapter: (chapterId: string, ordinal: number, deepLink?: object|null) => void }} props
 */
export default function ScenografieChapterHub({ workspaceId, onOpenChapter }) {
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dragIndex, setDragIndex] = useState(null);
  const [filmVerifyBusy, setFilmVerifyBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const w = await loadScenografiaProjectById(workspaceId);
      setWorkspace(w);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sortedChapters = useMemo(() => {
    if (!workspace?.chapters?.length) return [];
    return [...workspace.chapters].sort(
      (a, b) => (a.sortOrder - b.sortOrder) || String(a.id).localeCompare(String(b.id))
    );
  }, [workspace]);

  const workspaceFilm = useMemo(() => {
    if (!workspace || !ensureWorkspace(workspace)) return null;
    return reconcileWorkspaceFilmOutputState(workspace);
  }, [workspace]);

  const workspacePlaybackCandidates = useMemo(() => {
    if (!workspace || !ensureWorkspace(workspace)) return { entries: [] };
    return buildFinalFilmPlaybackCandidates(workspace);
  }, [workspace]);

  const workspaceFilmSummary = useMemo(() => {
    if (!workspace || !ensureWorkspace(workspace)) return null;
    return summarizeScenografiaWorkspaceForIndex(workspace);
  }, [workspace]);

  const runWorkspaceFilmVerify = useCallback(async () => {
    if (!workspaceId) return;
    setFilmVerifyBusy(true);
    try {
      await runAndPersistFilmOutputVerification(workspaceId);
      await refresh();
    } finally {
      setFilmVerifyBusy(false);
    }
  }, [workspaceId, refresh]);

  const persistWorkspace = useCallback(
    async (next) => {
      if (!workspaceId) return;
      normalizeChapterSortOrders(next);
      await saveScenografiaProjectById(workspaceId, next);
      await upsertScenografiaProjectInIndex(workspaceId, next);
      setWorkspace(next);
    },
    [workspaceId]
  );

  const addChapter = useCallback(async () => {
    const w = ensureWorkspace(await loadScenografiaProjectById(workspaceId));
    if (!w) return;
    const maxOrd = w.chapters.reduce((m, c) => Math.max(m, typeof c.sortOrder === "number" ? c.sortOrder : 0), -1);
    const next = {
      ...w,
      chapters: [
        ...w.chapters,
        {
          id: createChapterId(),
          sortOrder: maxOrd + 1,
          chapterTitle: "",
          data: emptyScenografiaProjectPayload(),
        },
      ],
    };
    await persistWorkspace(next);
  }, [workspaceId, persistWorkspace]);

  const reorderChapters = useCallback(
    async (fromIdx, toIdx) => {
      if (!workspace || fromIdx == null || toIdx == null || fromIdx === toIdx) return;
      const list = [...sortedChapters];
      const [moved] = list.splice(fromIdx, 1);
      list.splice(toIdx, 0, moved);
      const next = {
        ...workspace,
        chapters: list.map((c, i) => ({ ...c, sortOrder: i })),
      };
      await persistWorkspace(next);
    },
    [workspace, sortedChapters, persistWorkspace]
  );

  const updateChapterTitle = useCallback(
    async (chapterId, title) => {
      if (!workspace) return;
      const next = {
        ...workspace,
        chapters: workspace.chapters.map((c) => (c.id === chapterId ? { ...c, chapterTitle: title } : c)),
      };
      await persistWorkspace(next);
    },
    [workspace, persistWorkspace]
  );

  const deleteChapter = useCallback(
    async (chapterId, ordinal) => {
      if (!workspace || sortedChapters.length <= 1) return;
      const label = ordinal ? `Capitolo ${ordinal}` : "Questo capitolo";
      const ok = window.confirm(
        `${label}: eliminare il capitolo dal progetto?\n\nI contenuti del capitolo (piano, scene, clip, timeline) verranno rimossi. L’azione non è annullabile.`
      );
      if (!ok) return;
      const next = {
        ...workspace,
        chapters: workspace.chapters.filter((c) => c.id !== chapterId),
      };
      await persistWorkspace(next);
    },
    [workspace, sortedChapters.length, persistWorkspace]
  );

  const chaptersCount = sortedChapters.length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "0 24px 28px" }}>
      <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${AX.border}` }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
            rowGap: 10,
            minHeight: 44,
          }}
        >
          <h2
            style={{
              margin: 0,
              flex: "1 1 160px",
              fontSize: 18,
              fontWeight: 800,
              color: AX.text,
              display: "flex",
              alignItems: "center",
              gap: 10,
              minWidth: 0,
            }}
          >
            <HiFilm size={22} style={{ color: AX.violet, flexShrink: 0 }} />
            Capitoli
          </h2>
          <button
            type="button"
            onClick={() => void addChapter()}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "none",
              background: AX.gradPrimary,
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
              marginLeft: "auto",
            }}
          >
            <HiPlus size={18} />
            Nuovo capitolo
          </button>
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 13, color: AX.text2, maxWidth: 820, lineHeight: 1.55 }}>
          Trascina le righe per l’ordine narrativo. Ogni capitolo ha il proprio montaggio; la{" "}
          <strong style={{ color: AX.text }}>consegna film del progetto</strong> (Home / indice) sintetizza i capitoli — qui
          vedi stato operativo, output di questo capitolo e il passo successivo consigliato.
        </p>
      </div>

      {workspaceFilmSummary?.completedFilmUrl ? (
        <div
          style={{
            margin: "0 0 16px",
            padding: "12px 14px",
            borderRadius: 12,
            background: "rgba(41,182,255,0.07)",
            border: "1px solid rgba(41,182,255,0.28)",
            fontSize: 12,
            color: AX.text2,
            lineHeight: 1.5,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <strong style={{ color: AX.text }}>File film (consegna progetto):</strong>{" "}
            {workspaceFilmSummary.filmVerificationEffective?.userLineIt ||
              "Nessuna verifica rete/player ancora eseguita su questo URL."}
            {workspaceFilmSummary.filmOutputVerificationCheckedAt ? (
              <span style={{ display: "block", fontSize: 11, color: AX.muted, marginTop: 4 }}>
                Ultimo controllo:{" "}
                {new Date(workspaceFilmSummary.filmOutputVerificationCheckedAt).toLocaleString("it-IT")}
                {workspaceFilmSummary.filmOutputVerificationMethod
                  ? ` · ${workspaceFilmSummary.filmOutputVerificationMethod}`
                  : ""}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void runWorkspaceFilmVerify()}
            disabled={filmVerifyBusy}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "none",
              background: filmVerifyBusy ? AX.border : AX.gradPrimary,
              color: "#fff",
              fontWeight: 800,
              fontSize: 12,
              cursor: filmVerifyBusy ? "wait" : "pointer",
              flexShrink: 0,
            }}
          >
            {filmVerifyBusy ? "Verifica…" : "Verifica file finale"}
          </button>
        </div>
      ) : null}

      {loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: AX.muted }}>
          Caricamento capitoli…
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sortedChapters.map((ch, idx) => {
            const sum = summarizeChapterHubCard(ch.data || {}, workspace);
            const merged = mergeChapterDataWithProjectCharacterPool(ch.data || {}, workspace);
            const gaps = computeChapterCompletionGaps(merged);
            const montage = deriveChapterMontageConsumerSummary(merged);
            const montageSimple = deriveFinalOutputSimplePresentation(montage.confidence, {
              hasUrl: Boolean(montage.outputUrl),
              filmDeliveryState: montage.filmDeliveryState,
              filmOutputReadiness: montage.readiness,
            });
            const montagePlaybackMoment = describeFinalFilmPlaybackMoment(
              montageSimple.tier,
              montage.readiness,
              workspaceFilmSummary?.filmVerificationEffective ?? null,
            );
            const chapterPlaybackMerged = mergePlaybackEntriesChapterFirst(
              montage.outputUrl,
              ch.id,
              workspacePlaybackCandidates,
            );
            const homeFilmUrl =
              workspaceFilm?.completedFilmUrl != null && String(workspaceFilm.completedFilmUrl).trim()
                ? String(workspaceFilm.completedFilmUrl).trim()
                : null;
            const chapterOut =
              montage.outputUrl != null && String(montage.outputUrl).trim()
                ? String(montage.outputUrl).trim()
                : null;
            const showHomeFilmLink =
              Boolean(homeFilmUrl) &&
              Boolean(chapterOut) &&
              homeFilmUrl !== chapterOut &&
              chaptersCount > 1;
            const posterUrl = pickChapterPosterThumbnailUrl(ch.data || {}, {
              chapterOrdinal: idx + 1,
              chapterTitle: ch.chapterTitle,
              workspaceTitle: String(workspace?.narrativeProjectTitle || workspace?.projectTitle || "").trim(),
              workspaceDescription: String(
                workspace?.narrativeProjectDescription || workspace?.projectDescription || ""
              ).trim(),
            });
            const st = sum.uiStatus || "planning";
            const stColor = STATUS_COLOR[st] || AX.muted;
            const stLabel = SCENOGRAFIA_UI_STATUS_LABEL[st] || st;
            const pendingFirst = gaps.items?.find((it) => !it.ok) || null;
            const resumeDeepLink = pendingFirst?.deepLink || null;
            const roleHint = workspaceChapterRoleHint(workspaceFilm, ch.id, chaptersCount);
            const canTryPlayback =
              Boolean(montage.outputUrl) &&
              montage.readiness !== FILM_OUTPUT_READINESS.MONTAGE_FAILED &&
              montage.readiness !== FILM_OUTPUT_READINESS.MISSING_OUTPUT;
            const fmp = String(merged.finalMontagePhase || "none").trim();
            const showMontageJump =
              fmp === "assembly" ||
              fmp === "done" ||
              montage.readiness === FILM_OUTPUT_READINESS.MONTAGE_FAILED ||
              montage.readiness === FILM_OUTPUT_READINESS.MISSING_OUTPUT ||
              montage.readiness === FILM_OUTPUT_READINESS.IN_PROGRESS ||
              montage.readiness === FILM_OUTPUT_READINESS.DEGRADED ||
              montage.readiness === FILM_OUTPUT_READINESS.URL_STALE_PHASE ||
              montage.filmDeliveryState === FILM_DELIVERY_STATE.MONTAGE_FAILED ||
              montage.filmDeliveryState === FILM_DELIVERY_STATE.DELIVERED_MISSING_OUTPUT ||
              montage.filmDeliveryState === FILM_DELIVERY_STATE.MONTAGE_IN_PROGRESS;

            return (
              <div
                key={ch.id}
                draggable
                onDragStart={() => setDragIndex(idx)}
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={() => {
                  if (dragIndex != null) {
                    void reorderChapters(dragIndex, idx);
                  }
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 52px minmax(0, 1fr) minmax(152px, 192px)",
                  gap: 12,
                  alignItems: "stretch",
                  padding: "14px 16px",
                  borderRadius: 14,
                  border: `1px solid ${AX.border}`,
                  background: AX.card,
                  cursor: "grab",
                }}
              >
                <span style={{ color: AX.muted, display: "flex", alignItems: "center" }} title="Trascina per riordinare">
                  <HiBars3 size={20} />
                </span>
                <div
                  title={posterUrl ? "Anteprima capitolo" : "Nessuna immagine ancora"}
                  style={{
                    width: 52,
                    height: 72,
                    flexShrink: 0,
                    borderRadius: 10,
                    overflow: "hidden",
                    border: `1px solid ${AX.border}`,
                    background: posterUrl ? "#000" : `linear-gradient(160deg, rgba(41,182,255,0.35), rgba(123,77,255,0.45))`,
                    alignSelf: "center",
                  }}
                >
                  {posterUrl ? (
                    <img
                      src={posterUrl}
                      alt=""
                      draggable={false}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  ) : null}
                </div>
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 800,
                      color: AX.text,
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span style={{ color: AX.electric, fontWeight: 800 }}>Capitolo {idx + 1}</span>
                    <span style={{ color: AX.text2, fontWeight: 800 }} aria-hidden>
                      —
                    </span>
                    <input
                      type="text"
                      value={ch.chapterTitle || ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setWorkspace((prev) => {
                          if (!prev) return prev;
                          return {
                            ...prev,
                            chapters: prev.chapters.map((c) => (c.id === ch.id ? { ...c, chapterTitle: v } : c)),
                          };
                        });
                      }}
                      onBlur={(e) => void updateChapterTitle(ch.id, e.target.value.trim())}
                      placeholder={sum.displayTitle || "Nome capitolo"}
                      title="Modifica nome capitolo"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        flex: "1 1 140px",
                        minWidth: 120,
                        maxWidth: "min(100%, 420px)",
                        padding: "4px 8px",
                        borderRadius: 8,
                        border: `1px solid ${AX.border}`,
                        background: AX.surface,
                        color: AX.text,
                        fontSize: 14,
                        fontWeight: 700,
                      }}
                    />
                    {st !== "clip_approval" && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: `${stColor}22`,
                          color: stColor,
                          border: `1px solid ${stColor}44`,
                        }}
                      >
                        {stLabel}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11, color: AX.muted }}>
                    <span>
                      <strong style={{ color: AX.text2 }}>{sum.scenesInPlan ?? 0}</strong> scene
                    </span>
                    <span>
                      <strong style={{ color: AX.text2 }}>{sum.characterCount ?? 0}</strong> personaggi
                    </span>
                    <span>
                      <strong style={{ color: AX.text2 }}>{sum.clipsCount ?? 0}</strong> clip
                    </span>
                    <span>
                      <strong style={{ color: AX.text2 }}>{sum.videoSecondsApprox || 0}</strong>s timeline
                    </span>
                    <span style={{ color: AX.text2 }}>
                      Dettaglio consegna: <strong style={{ color: AX.text }}>{montage.deliveryLabelIt}</strong>
                    </span>
                  </div>

                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      background: "rgba(41,182,255,0.06)",
                      border: `1px solid rgba(41,182,255,0.22)`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        color: AX.muted,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        marginBottom: 4,
                      }}
                    >
                      Percorso capitolo
                    </div>
                    <div style={{ fontSize: 12, color: AX.text2, lineHeight: 1.45 }}>{gaps.headline}</div>
                    {pendingFirst?.nextHint ? (
                      <div style={{ fontSize: 12, color: AX.electric, marginTop: 6, lineHeight: 1.45 }}>
                        <strong>Prossimo passo:</strong> {pendingFirst.nextHint}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "#86efac", marginTop: 6, lineHeight: 1.45 }}>
                        Controlli principali ok per questo capitolo.
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      background: "rgba(74,222,128,0.06)",
                      border: `1px solid rgba(74,222,128,0.28)`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        color: AX.muted,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        marginBottom: 4,
                      }}
                    >
                      Film finale (capitolo) · sintesi
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: AX.text, lineHeight: 1.35 }}>
                      {montageSimple.primaryLine}
                    </div>
                    {montageSimple.detailLine ? (
                      <div style={{ fontSize: 11, color: AX.text2, marginTop: 4, lineHeight: 1.45 }}>
                        {montageSimple.detailLine}
                      </div>
                    ) : null}
                    {montage.hasExecutionWarnings ? (
                      <div style={{ fontSize: 11, color: "#fb923c", marginTop: 6, lineHeight: 1.45 }}>
                        <strong>Attenzione:</strong> piano di montaggio con avvisi su questo capitolo.
                      </div>
                    ) : null}
                    <div style={{ fontSize: 11, color: AX.electric, marginTop: 6, lineHeight: 1.45 }}>
                      <strong>Prossimo passo:</strong> {montageSimple.nextStepLine || montage.confidence.nextStep}
                    </div>
                    <div style={{ fontSize: 10, color: AX.muted, marginTop: 4, lineHeight: 1.45 }}>
                      Montaggio: {montage.montageNextStep}
                    </div>
                    <details style={{ marginTop: 8, fontSize: 10, color: AX.muted, lineHeight: 1.45 }}>
                      <summary style={{ cursor: "pointer", fontWeight: 700, color: AX.text2, userSelect: "none" }}>
                        Dettaglio tecnico
                      </summary>
                      <div style={{ marginTop: 6 }}>{montageSimple.technicalHeadline}</div>
                      {montage.userHint ? <div style={{ marginTop: 4 }}>{montage.userHint}</div> : null}
                    </details>
                  </div>

                  <div
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      background: "rgba(41,182,255,0.07)",
                      border: "1px solid rgba(41,182,255,0.25)",
                      fontSize: 11,
                      color: AX.text2,
                      lineHeight: 1.45,
                    }}
                  >
                    <strong style={{ color: "#7dd3fc" }}>Playback:</strong> {montagePlaybackMoment.headline}
                    <div style={{ marginTop: 4, fontSize: 10, color: AX.muted }}>{montagePlaybackMoment.subline}</div>
                    {chapterPlaybackMerged.entries.length > 1 ? (
                      <div style={{ marginTop: 6, fontSize: 10, color: AX.muted }}>
                        {chapterPlaybackMerged.entries.length} indirizzi MP4 distinti risultano salvati nel progetto: «Guarda
                        output» apre questo capitolo; dalla Home puoi provare la sintesi o altre sorgenti.
                      </div>
                    ) : null}
                  </div>

                  {roleHint ? (
                    <div
                      style={{
                        fontSize: 11,
                        color: AX.muted,
                        lineHeight: 1.45,
                        padding: "8px 10px",
                        borderRadius: 10,
                        background: "rgba(123,77,255,0.06)",
                        border: `1px solid rgba(123,77,255,0.22)`,
                      }}
                    >
                      <strong style={{ color: AX.text2 }}>Nel film del progetto:</strong> {roleHint}
                    </div>
                  ) : null}

                  {chaptersCount > 1 && workspaceFilm && !roleHint ? (
                    <div style={{ fontSize: 10, color: AX.muted, lineHeight: 1.45 }}>
                      Film complessivo:{" "}
                      <strong style={{ color: AX.text2 }}>
                        {FILM_DELIVERY_LABEL_IT[workspaceFilm.filmDeliveryState] || workspaceFilm.filmDeliveryState}
                      </strong>
                      {workspaceFilm.multiChapterFilmHint ? ` · ${workspaceFilm.multiChapterFilmHint}` : ""}
                    </div>
                  ) : null}
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    justifyContent: "flex-start",
                    alignItems: "stretch",
                  }}
                >
                  <button
                    type="button"
                    draggable={false}
                    onClick={() => onOpenChapter(ch.id, idx + 1, null)}
                    style={{
                      ...btnSecondary,
                      border: "none",
                      background: AX.gradPrimary,
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: 12,
                    }}
                  >
                    Apri capitolo
                  </button>
                  {resumeDeepLink ? (
                    <button
                      type="button"
                      draggable={false}
                      onClick={() => onOpenChapter(ch.id, idx + 1, resumeDeepLink)}
                      style={{
                        ...btnSecondary,
                        border: `1px solid rgba(41,182,255,0.45)`,
                        background: "rgba(41,182,255,0.08)",
                        color: AX.electric,
                      }}
                    >
                      Riprendi da qui
                    </button>
                  ) : null}
                  {showMontageJump ? (
                    <button
                      type="button"
                      draggable={false}
                      onClick={() => onOpenChapter(ch.id, idx + 1, { focus: "montage" })}
                      style={{
                        ...btnSecondary,
                        border: `1px solid rgba(123,77,255,0.45)`,
                        background: "rgba(123,77,255,0.08)",
                        color: "#c4b5fd",
                      }}
                    >
                      Vai al montaggio
                    </button>
                  ) : null}
                  {canTryPlayback ? (
                    <button
                      type="button"
                      draggable={false}
                      title={`${montagePlaybackMoment.headline}. Se non si apre, prova nuova scheda o la Home.`}
                      onClick={() => {
                        try {
                          window.open(montage.outputUrl, "_blank", "noopener,noreferrer");
                        } catch {
                          /* ignore */
                        }
                      }}
                      style={{
                        ...btnSecondary,
                        color: "#86efac",
                        border: `1px solid rgba(74,222,128,0.35)`,
                      }}
                    >
                      <HiPlay size={14} />
                      Guarda output
                    </button>
                  ) : null}
                  {montage.outputUrl && !canTryPlayback ? (
                    <button
                      type="button"
                      draggable={false}
                      title="Apre il file in una nuova scheda per verificarlo al di fuori di AXSTUDIO."
                      onClick={() => {
                        try {
                          window.open(montage.outputUrl, "_blank", "noopener,noreferrer");
                        } catch {
                          /* ignore */
                        }
                      }}
                      style={btnSecondary}
                    >
                      Verifica file
                    </button>
                  ) : null}
                  {showHomeFilmLink ? (
                    <button
                      type="button"
                      draggable={false}
                      title="Link sintetizzato per la Home (può differire dal file di questo capitolo)."
                      onClick={() => {
                        try {
                          window.open(homeFilmUrl, "_blank", "noopener,noreferrer");
                        } catch {
                          /* ignore */
                        }
                      }}
                      style={{
                        ...btnSecondary,
                        border: `1px solid rgba(41,182,255,0.4)`,
                        background: "rgba(41,182,255,0.08)",
                        color: AX.electric,
                      }}
                    >
                      Apri link sintesi Home
                    </button>
                  ) : null}
                  <button type="button" draggable={false} onClick={() => void refresh()} style={btnSecondary}>
                    <HiArrowPath size={14} />
                    Ricalcola stato
                  </button>
                  <button
                    type="button"
                    draggable={false}
                    onClick={() => void deleteChapter(ch.id, idx + 1)}
                    disabled={sortedChapters.length <= 1}
                    aria-label="Elimina capitolo"
                    title={
                      sortedChapters.length <= 1 ? "Serve almeno un capitolo nel progetto" : "Elimina capitolo"
                    }
                    style={{
                      ...btnSecondary,
                      color: sortedChapters.length <= 1 ? AX.muted : "#f87171",
                      borderColor: sortedChapters.length <= 1 ? `${AX.border}88` : "rgba(248,113,113,0.35)",
                      cursor: sortedChapters.length <= 1 ? "not-allowed" : "pointer",
                      opacity: sortedChapters.length <= 1 ? 0.45 : 1,
                    }}
                  >
                    <HiTrash size={14} />
                    Elimina
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
