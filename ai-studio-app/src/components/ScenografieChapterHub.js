/**
 * Elenco Capitoli dentro un Progetto narrativo (workspace) — ordinamento drag & drop.
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { HiFilm, HiPlus, HiBars3, HiTrash } from "react-icons/hi2";
import {
  loadScenografiaProjectById,
  saveScenografiaProjectById,
  upsertScenografiaProjectInIndex,
  ensureWorkspace,
  emptyScenografiaProjectPayload,
  createChapterId,
  summarizeChapterHubCard,
  normalizeChapterSortOrders,
  pickChapterPosterThumbnailUrl,
  SCENOGRAFIA_UI_STATUS_LABEL,
} from "../services/scenografieProjectPersistence.js";

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
 * @param {{ workspaceId: string, onOpenChapter: (chapterId: string, ordinal: number) => void }} props
 */
export default function ScenografieChapterHub({ workspaceId, onOpenChapter }) {
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dragIndex, setDragIndex] = useState(null);

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
        <p style={{ margin: "12px 0 0", fontSize: 13, color: AX.text2, maxWidth: 720, lineHeight: 1.55 }}>
          Trascina le righe per l’ordine narrativo: la numerazione «Capitolo 1…» segue l’ordine qui sotto.
        </p>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: AX.muted }}>
          Caricamento capitoli…
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sortedChapters.map((ch, idx) => {
              const sum = summarizeChapterHubCard(ch.data || {}, workspace);
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
                    gridTemplateColumns: "auto auto 1fr max-content",
                    gap: 12,
                    alignItems: "center",
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
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 800,
                        color: AX.text,
                        marginBottom: 6,
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <button
                        type="button"
                        title="Apri capitolo"
                        onClick={() => onOpenChapter(ch.id, idx + 1)}
                        style={{
                          border: "none",
                          background: "none",
                          padding: "2px 0",
                          margin: 0,
                          font: "inherit",
                          fontWeight: 800,
                          color: AX.electric,
                          cursor: "pointer",
                          textDecoration: "none",
                          borderRadius: 4,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.textDecoration = "underline";
                          e.currentTarget.style.textDecorationColor = "rgba(41,182,255,0.6)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.textDecoration = "none";
                        }}
                      >
                        Capitolo {idx + 1}
                      </button>
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
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: AX.text2 }}>
                      <span>
                        <strong style={{ color: AX.text }}>{sum.scenesInPlan ?? 0}</strong> scene in piano
                      </span>
                      <span>
                        <strong style={{ color: AX.text }}>{sum.characterCount ?? 0}</strong> personaggi
                      </span>
                      <span>
                        <strong style={{ color: AX.text }}>{sum.clipsCount ?? 0}</strong> clip
                      </span>
                      <span>
                        <strong style={{ color: AX.text }}>{sum.videoSecondsApprox || 0}</strong>s video (timeline)
                      </span>
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
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, justifySelf: "end" }}>
                    <button
                      type="button"
                      onClick={() => void deleteChapter(ch.id, idx + 1)}
                      disabled={sortedChapters.length <= 1}
                      aria-label="Elimina capitolo"
                      title={
                        sortedChapters.length <= 1
                          ? "Serve almeno un capitolo nel progetto"
                          : "Elimina capitolo"
                      }
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 42,
                        height: 40,
                        padding: 0,
                        borderRadius: 10,
                        border: `1px solid ${sortedChapters.length <= 1 ? `${AX.border}88` : AX.border}`,
                        background: AX.surface,
                        color: sortedChapters.length <= 1 ? AX.muted : "#f87171",
                        cursor: sortedChapters.length <= 1 ? "not-allowed" : "pointer",
                        opacity: sortedChapters.length <= 1 ? 0.45 : 1,
                        transition: "border-color 0.15s ease, background 0.15s ease, color 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        if (sortedChapters.length <= 1) return;
                        e.currentTarget.style.background = "rgba(248,113,113,0.12)";
                        e.currentTarget.style.borderColor = "rgba(248,113,113,0.45)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = AX.surface;
                        e.currentTarget.style.borderColor = AX.border;
                      }}
                    >
                      <HiTrash size={18} />
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
