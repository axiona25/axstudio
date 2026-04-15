/**
 * Hub principale Scenografie — griglia progetti (stile AXSTUDIO).
 */

import React, { useState, useCallback, useEffect } from "react";
import { HiFilm, HiPlus, HiArrowPath, HiTrash } from "react-icons/hi2";
import {
  loadScenografiaProjectsIndex,
  migrateLegacyScenografiaToMultiIfNeeded,
  createScenografiaProjectId,
  saveScenografiaProjectById,
  upsertScenografiaProjectInIndex,
  emptyScenografiaProjectPayload,
  SCENOGRAFIA_UI_STATUS_LABEL,
  deleteScenografiaProjectById,
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
  magenta: "#ff4fa3",
  gradPrimary: "linear-gradient(135deg, #29b6ff 0%, #7b4dff 100%)",
  gradLogo: "linear-gradient(135deg,#29b6ff,#7b4dff,#ff4fa3)",
};

const STATUS_COLOR = {
  planning: AX.muted,
  character_approval: "#c084fc",
  scene_approval: "#fbbf24",
  clip_approval: "#fb923c",
  timeline_approval: "#22d3ee",
  final_film_ready: "#4ade80",
  video_ready: "#4ade80",
  video_production: AX.electric,
  final_montage: "#38bdf8",
  completed: "#94a3b8",
};

/**
 * @param {{ onOpenProject: (id: string, projectNumber: number) => void }} props
 */
export default function ScenografieProjectHub({ onOpenProject }) {
  const [index, setIndex] = useState({ version: 1, projects: [] });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  /** @type {{ id: string, title: string, projectNumber: number } | null} */
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const refresh = useCallback(async () => {
    await migrateLegacyScenografiaToMultiIfNeeded();
    const idx = await loadScenografiaProjectsIndex();
    setIndex(idx);
  }, []);

  useEffect(() => {
    let c = false;
    void (async () => {
      setLoading(true);
      await refresh();
      if (!c) setLoading(false);
    })();
    return () => {
      c = true;
    };
  }, [refresh]);

  const cancelDeleteProject = useCallback(() => {
    if (!deleteBusy) setDeleteConfirm(null);
  }, [deleteBusy]);

  const confirmDeleteProject = useCallback(async () => {
    if (!deleteConfirm?.id || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteScenografiaProjectById(deleteConfirm.id);
      setDeleteConfirm(null);
      await refresh();
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteConfirm, deleteBusy, refresh]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const id = createScenografiaProjectId();
      const payload = emptyScenografiaProjectPayload();
      await saveScenografiaProjectById(id, payload);
      await upsertScenografiaProjectInIndex(id, payload);
      await refresh();
      const idxAfter = await loadScenografiaProjectsIndex();
      const ord = Math.max(1, (idxAfter.projects || []).length);
      onOpenProject(id, ord);
    } finally {
      setCreating(false);
    }
  }, [onOpenProject, refresh]);

  const projectsSorted = [...(index.projects || [])].sort((a, b) =>
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "0 24px 28px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 22 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: AX.text, margin: 0, display: "flex", alignItems: "center", gap: 10, letterSpacing: "-0.02em" }}>
            <HiFilm size={24} style={{ color: AX.violet }} />
            Scenografie
          </h2>
          <p style={{ fontSize: 13, color: AX.text2, marginTop: 8, maxWidth: 560, lineHeight: 1.55 }}>
            Progetti narrativi separati: apri una cartella per piano, character master, scene e approvazioni. Ogni progetto è salvato in modo indipendente.
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: `1px solid ${AX.border}`,
              background: AX.surface,
              color: AX.text2,
              fontWeight: 600,
              fontSize: 13,
              cursor: loading ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <HiArrowPath size={16} />
            Aggiorna elenco
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background: AX.gradPrimary,
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              cursor: creating ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              boxShadow: "0 4px 20px rgba(41,182,255,0.2)",
            }}
          >
            <HiPlus size={18} />
            Nuovo progetto scenografico
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: AX.muted, fontSize: 14 }}>
          Caricamento progetti…
        </div>
      ) : projectsSorted.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 16,
            border: `1px dashed ${AX.border}`,
            background: AX.surface,
            padding: 40,
            textAlign: "center",
          }}
        >
          <HiFilm size={44} style={{ color: AX.muted, marginBottom: 14 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: AX.text, marginBottom: 8 }}>Nessun progetto ancora</div>
          <div style={{ fontSize: 13, color: AX.text2, marginBottom: 20, maxWidth: 400 }}>
            Crea il primo progetto: potrai definire personaggi, scene e approvare tutto prima della produzione video.
          </div>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            style={{
              padding: "12px 22px",
              borderRadius: 10,
              border: "none",
              background: AX.gradPrimary,
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              cursor: creating ? "wait" : "pointer",
            }}
          >
            Crea progetto
          </button>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 16,
            alignContent: "start",
          }}
        >
          {projectsSorted.map((p, idx) => {
            const n = projectsSorted.length - idx;
            const s = p.summary || {};
            const st = s.uiStatus || "planning";
            const stLabel = SCENOGRAFIA_UI_STATUS_LABEL[st] || st;
            const stColor = STATUS_COLOR[st] || AX.muted;
            const displayTitle = s.displayTitle || "Senza titolo";
            return (
              <div
                key={p.id}
                style={{
                  borderRadius: 16,
                  border: `1px solid ${AX.border}`,
                  background: AX.card,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 168,
                  transition: "border-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease",
                  boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(41,182,255,0.45)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = AX.border;
                  e.currentTarget.style.transform = "none";
                }}
              >
                <button
                  type="button"
                  onClick={() => onOpenProject(p.id, n)}
                  style={{
                    textAlign: "left",
                    cursor: "pointer",
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    flex: 1,
                    minHeight: 0,
                    width: "100%",
                    color: "inherit",
                    font: "inherit",
                  }}
                >
                  <div style={{ height: 3, width: "100%", background: AX.gradLogo }} />
                  <div style={{ padding: "16px 16px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          color: AX.electric,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                        }}
                      >
                        Progetto #{n}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "4px 8px",
                          borderRadius: 999,
                          background: `${stColor}22`,
                          color: stColor,
                          border: `1px solid ${stColor}44`,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {stLabel}
                      </span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: AX.text, lineHeight: 1.35, marginBottom: 12, minHeight: 40 }}>
                      {displayTitle}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12, color: AX.text2 }}>
                      <div>
                        <span style={{ color: AX.muted, display: "block", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 }}>Personaggi</span>
                        <strong style={{ color: AX.text }}>{s.characterCount ?? 0}</strong>
                      </div>
                      <div>
                        <span style={{ color: AX.muted, display: "block", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 }}>Scene generate</span>
                        <strong style={{ color: AX.text }}>{s.scenesGenerated ?? 0}</strong>
                        <span style={{ color: AX.muted }}> / {s.scenesInPlan ?? 0} in piano</span>
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <span style={{ color: AX.muted, display: "block", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 }}>Clip video</span>
                        <strong style={{ color: AX.text }}>{s.clipsCount ?? 0}</strong>
                      </div>
                    </div>
                  </div>
                </button>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "10px 14px 12px",
                    borderTop: `1px solid ${AX.border}`,
                    background: "rgba(0,0,0,0.2)",
                  }}
                >
                  <span style={{ fontSize: 10, color: AX.muted, minWidth: 0, flex: 1 }}>
                    {p.updatedAt ? `Aggiornato ${new Date(p.updatedAt).toLocaleString()}` : "\u00a0"}
                  </span>
                  <button
                    type="button"
                    aria-label={`Elimina progetto ${displayTitle}`}
                    title="Elimina progetto"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDeleteConfirm({ id: p.id, title: displayTitle, projectNumber: n });
                    }}
                    style={{
                      flexShrink: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      border: `1px solid rgba(239,68,68,0.35)`,
                      background: "rgba(239,68,68,0.1)",
                      color: "#f87171",
                      cursor: "pointer",
                      transition: "background 0.15s ease, border-color 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(239,68,68,0.2)";
                      e.currentTarget.style.borderColor = "rgba(239,68,68,0.55)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(239,68,68,0.1)";
                      e.currentTarget.style.borderColor = "rgba(239,68,68,0.35)";
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
      {deleteConfirm && (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            background: "rgba(6,6,12,0.78)",
            backdropFilter: "blur(8px)",
          }}
          onClick={cancelDeleteProject}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="scenografie-delete-project-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 440,
              borderRadius: 16,
              background: AX.card,
              border: `1px solid ${AX.border}`,
              boxShadow: "0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(239,68,68,0.12)",
              overflow: "hidden",
            }}
          >
            <div style={{ height: 3, background: "linear-gradient(90deg, #f87171, #fb923c)", width: "100%" }} />
            <div style={{ padding: "22px 24px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: "rgba(239,68,68,0.12)",
                    border: "1px solid rgba(239,68,68,0.35)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <HiTrash size={20} style={{ color: "#f87171" }} />
                </div>
                <h2 id="scenografie-delete-project-title" style={{ margin: 0, fontSize: 18, fontWeight: 800, color: AX.text, letterSpacing: "-0.02em" }}>
                  Eliminare questo progetto?
                </h2>
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: AX.text2 }}>
                <strong style={{ color: AX.text }}>Progetto #{deleteConfirm.projectNumber}</strong>
                {" — "}
                <span style={{ color: AX.text }}>{deleteConfirm.title}</span>
                <br />
                <span style={{ fontSize: 13, color: AX.muted }}>
                  Verrà rimosso dalla griglia e cancellato in modo permanente (file o localStorage). Non è annullabile.
                </span>
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end", marginTop: 24 }}>
                <button
                  type="button"
                  onClick={cancelDeleteProject}
                  disabled={deleteBusy}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 10,
                    border: `1px solid ${AX.border}`,
                    background: AX.surface,
                    color: AX.text2,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: deleteBusy ? "not-allowed" : "pointer",
                    opacity: deleteBusy ? 0.6 : 1,
                  }}
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={() => void confirmDeleteProject()}
                  disabled={deleteBusy}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 10,
                    border: "none",
                    background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: deleteBusy ? "wait" : "pointer",
                    boxShadow: "0 4px 20px rgba(239,68,68,0.3)",
                    opacity: deleteBusy ? 0.85 : 1,
                  }}
                >
                  {deleteBusy ? "Eliminazione…" : "Sì, elimina progetto"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
