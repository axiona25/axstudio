/**
 * Hub principale Scenografie — griglia Progetti (workspace) stile locandine.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { HiFilm, HiPlus, HiTrash, HiXMark, HiSparkles, HiPencilSquare } from "react-icons/hi2";
import {
  loadScenografiaProjectsIndex,
  migrateLegacyScenografiaToMultiIfNeeded,
  createScenografiaProjectId,
  loadScenografiaProjectById,
  saveScenografiaProjectById,
  upsertScenografiaProjectInIndex,
  deleteScenografiaProjectById,
  buildScenografiaWorkspaceFromWizard,
  ensureWorkspace,
  indexSummaryNeedsLightReconcile,
} from "../services/scenografieProjectPersistence.js";
import { FILM_DELIVERY_STATE, FILM_OUTPUT_READINESS } from "../services/scenografieConsumerReliability.js";
import { buildProjectStyleFromImagePreset } from "../services/scenografieProjectStyle.js";
import {
  buildProjectPosterPromptPack,
  executeOfficialProjectPosterFlux,
  PROJECT_POSTER_STATUS,
} from "../services/scenografieProjectPoster.js";
import { MODULE_REGISTRY, MODULE_IDS } from "../config/moduleProviderRegistry.js";
import ScenografieStoryProjectWizard from "./ScenografieStoryProjectWizard.js";
import ScenografieProjectStartChoiceModal from "./ScenografieProjectStartChoiceModal.js";
import {
  ProjectCreationModalHeader,
  ProjectStylePresetGrid,
  modalOverlayStyle,
  modalDialogStyle,
  modalGradientBarStyle,
  labelStyle,
  inputFieldStyle,
  textareaFieldStyle,
  footerDividerStyle,
  btnSecondaryFooter,
  btnPrimaryFooter,
} from "./ProjectCreationModalUi.js";

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

/** Catalogo hub: una sola riga sintetica sul film finale (niente copy consumer lungo). */
function hubCardFilmFinaleLine(summary) {
  const s = summary && typeof summary === "object" ? summary : {};
  const filmDel = s.filmDeliveryState != null ? String(s.filmDeliveryState).trim() : "";
  if (!filmDel || filmDel === FILM_DELIVERY_STATE.NOT_READY) return null;
  const hasFilmUrl = Boolean(s.completedFilmUrl != null && String(s.completedFilmUrl).trim());
  const filmReadiness = String(s.filmOutputReadiness || "").trim() || FILM_OUTPUT_READINESS.MISSING_OUTPUT;
  const canPlay =
    hasFilmUrl &&
    filmReadiness !== FILM_OUTPUT_READINESS.MONTAGE_FAILED &&
    filmReadiness !== FILM_OUTPUT_READINESS.MISSING_OUTPUT;
  return `Film finale: ${canPlay ? "disponibile" : "non disponibile"}`;
}

/**
 * @param {{ onOpenWorkspace: (workspaceId: string, projectNumber: number) => void, imageStylePresets?: Array<{ id: string, label: string, prompt: string, negative_prompt?: string }> }} props
 */
export default function ScenografieProjectHub({ onOpenWorkspace, imageStylePresets = [] }) {
  const [index, setIndex] = useState({ version: 1, projects: [] });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPresetId, setNewPresetId] = useState("");
  const [createError, setCreateError] = useState("");
  /** @type {'idle'|'saving'|'poster'|'done'} */
  const [createPhase, setCreatePhase] = useState("idle");
  const [storyWizardOpen, setStoryWizardOpen] = useState(false);
  /** Primo bivio: Film guidato vs Film libero (prima della modale creazione o del wizard). */
  const [startChoiceModalOpen, setStartChoiceModalOpen] = useState(false);
  /** Dopo commit wizard riuscito: onClose del wizard non deve riaprire la modale di scelta (navigazione verso progetto). */
  const suppressStartChoiceAfterWizardCommitRef = useRef(false);

  const defaultPresetId = useMemo(() => {
    const list = imageStylePresets || [];
    const cine = list.find((p) => p.id === "cinematic");
    return (cine || list[0])?.id || "";
  }, [imageStylePresets]);
  /** @type {{ id: string, title: string, projectNumber: number } | null} */
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  /** Modifica metadati progetto madre (titolo / descrizione). */
  const [editProjectId, setEditProjectId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLoadBusy, setEditLoadBusy] = useState(false);
  const [editSaveBusy, setEditSaveBusy] = useState(false);
  const [editError, setEditError] = useState("");

  const refresh = useCallback(async () => {
    await migrateLegacyScenografiaToMultiIfNeeded();
    let idx = await loadScenografiaProjectsIndex();
    const stale = (idx.projects || []).filter((p) => indexSummaryNeedsLightReconcile(p.summary)).slice(0, 8);
    if (stale.length) {
      await Promise.all(
        stale.map(async (p) => {
          try {
            const raw = await loadScenografiaProjectById(p.id);
            await upsertScenografiaProjectInIndex(p.id, raw);
          } catch {
            /* ignore */
          }
        }),
      );
      idx = await loadScenografiaProjectsIndex();
    }
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

  useEffect(() => {
    if (!createModalOpen) return;
    setCreateError("");
    if (!imageStylePresets.length) return;
    if (!newPresetId || !imageStylePresets.some((p) => p.id === newPresetId)) {
      setNewPresetId(defaultPresetId || imageStylePresets[0].id);
    }
  }, [createModalOpen, defaultPresetId, imageStylePresets, newPresetId]);

  const openCreateModal = useCallback(() => {
    setNewTitle("");
    setNewDescription("");
    setNewPresetId(defaultPresetId || "");
    setCreateError("");
    setCreatePhase("idle");
    setCreateModalOpen(true);
  }, [defaultPresetId]);

  const openStartChoiceModal = useCallback(() => {
    if (creating || !imageStylePresets.length) return;
    setCreateError("");
    setStartChoiceModalOpen(true);
  }, [creating, imageStylePresets.length]);

  const closeStartChoiceModal = useCallback(() => {
    if (creating) return;
    setStartChoiceModalOpen(false);
  }, [creating]);

  const handleStartChoiceGuided = useCallback(() => {
    setStartChoiceModalOpen(false);
    if (!creating) setStoryWizardOpen(true);
  }, [creating]);

  const handleStartChoiceFree = useCallback(() => {
    setStartChoiceModalOpen(false);
    openCreateModal();
  }, [openCreateModal]);

  const cancelCreateModal = useCallback(() => {
    if (creating) return;
    setCreatePhase("idle");
    setCreateModalOpen(false);
    setStartChoiceModalOpen(true);
  }, [creating]);

  const closeStoryWizardModal = useCallback(() => {
    if (creating) return;
    setStoryWizardOpen(false);
    if (!suppressStartChoiceAfterWizardCommitRef.current) {
      setStartChoiceModalOpen(true);
    }
    suppressStartChoiceAfterWizardCommitRef.current = false;
  }, [creating]);

  const cancelDeleteProject = useCallback(() => {
    if (!deleteBusy) setDeleteConfirm(null);
  }, [deleteBusy]);

  const closeEditProjectModal = useCallback(() => {
    if (editSaveBusy) return;
    setEditProjectId(null);
    setEditError("");
    setEditTitle("");
    setEditDescription("");
  }, [editSaveBusy]);

  const openEditProjectModal = useCallback(async (projectId) => {
    setEditError("");
    setEditProjectId(projectId);
    setEditLoadBusy(true);
    try {
      const raw = await loadScenografiaProjectById(projectId);
      const ws = ensureWorkspace(raw);
      if (!ws) throw new Error("Progetto non disponibile.");
      setEditTitle(String(ws.narrativeProjectTitle || ws.projectTitle || "").trim());
      setEditDescription(String(ws.narrativeProjectDescription || ws.projectDescription || "").trim());
    } catch (e) {
      setEditError(e?.message || "Impossibile caricare il progetto.");
      setEditProjectId(null);
    } finally {
      setEditLoadBusy(false);
    }
  }, []);

  const saveEditedProject = useCallback(
    async (regeneratePoster) => {
      if (!editProjectId || editSaveBusy) return;
      const title = editTitle.trim();
      if (!title) {
        setEditError("Il titolo progetto è obbligatorio.");
        return;
      }
      setEditSaveBusy(true);
      setEditError("");
      try {
        let ws = ensureWorkspace(await loadScenografiaProjectById(editProjectId));
        if (!ws) throw new Error("Progetto non trovato.");
        const origT = String(ws.narrativeProjectTitle || ws.projectTitle || "").trim();
        const origD = String(ws.narrativeProjectDescription || ws.projectDescription || "").trim();
        const description = editDescription.trim();
        const textChanged = title !== origT || description !== origD;
        const hadPoster = !!(ws.projectPosterUrl || ws.posterImageUrl);
        const tNow = new Date().toISOString();
        ws = {
          ...ws,
          narrativeProjectTitle: title,
          projectTitle: title,
          narrativeProjectDescription: description,
          projectDescription: description,
          updatedAt: tNow,
        };
        if (!regeneratePoster && textChanged && hadPoster) {
          ws.projectPosterOutdated = true;
        }
        if (regeneratePoster) {
          const pack = buildProjectPosterPromptPack({ workspace: ws });
          const gStyle = ws.globalProjectStyle;
          const posterStyleSnap = gStyle
            ? { presetId: gStyle.presetId, label: gStyle.label, isAnimated: gStyle.isAnimated === true }
            : ws.projectPosterStyle;
          ws = {
            ...ws,
            projectPosterPrompt: pack.positivePrompt,
            projectPosterStatus: PROJECT_POSTER_STATUS.GENERATING,
            posterGenerationStatus: PROJECT_POSTER_STATUS.GENERATING,
            projectPosterStyle: posterStyleSnap || ws.projectPosterStyle,
            projectPosterMetadata: pack.metadata,
            projectPosterOutdated: false,
          };
          await saveScenografiaProjectById(editProjectId, ws);
          await upsertScenografiaProjectInIndex(editProjectId, ws);
          try {
            const { imageUrl } = await executeOfficialProjectPosterFlux(pack, () => {});
            const tUp = new Date().toISOString();
            ws = {
              ...ws,
              posterImageUrl: imageUrl,
              projectPosterUrl: imageUrl,
              projectPosterStatus: PROJECT_POSTER_STATUS.READY,
              posterGenerationStatus: PROJECT_POSTER_STATUS.READY,
              projectPosterUpdatedAt: tUp,
              updatedAt: tUp,
            };
          } catch (e) {
            if (typeof console !== "undefined" && console.warn) console.warn("[Scenografie] rigenera locandina:", e);
            const tUp = new Date().toISOString();
            ws = {
              ...ws,
              projectPosterStatus: PROJECT_POSTER_STATUS.FAILED,
              posterGenerationStatus: PROJECT_POSTER_STATUS.FAILED,
              projectPosterUpdatedAt: tUp,
              updatedAt: tUp,
            };
          }
        }
        await saveScenografiaProjectById(editProjectId, ws);
        await upsertScenografiaProjectInIndex(editProjectId, ws);
        setEditProjectId(null);
        setEditError("");
        setEditTitle("");
        setEditDescription("");
        await refresh();
      } catch (e) {
        setEditError(e?.message || "Salvataggio non riuscito.");
      } finally {
        setEditSaveBusy(false);
      }
    },
    [editProjectId, editTitle, editDescription, editSaveBusy, refresh],
  );

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

  const confirmCreateProject = useCallback(async () => {
    const title = newTitle.trim();
    const description = newDescription.trim();
    if (!title || !description || !newPresetId) return;
    const preset = imageStylePresets.find((p) => p.id === newPresetId);
    if (!preset) {
      setCreateError("Seleziona uno stile grafico valido.");
      return;
    }
    setCreating(true);
    setCreateError("");
    setCreatePhase("saving");
    const id = createScenografiaProjectId();
    try {
      const projectStyle = buildProjectStyleFromImagePreset(preset, { descriptionHint: description });
      let workspace = buildScenografiaWorkspaceFromWizard({ title, description, projectStyle });
      await saveScenografiaProjectById(id, workspace);
      await upsertScenografiaProjectInIndex(id, workspace);

      const pack = buildProjectPosterPromptPack({ workspace });
      const posterStyleSnap = {
        presetId: projectStyle.presetId,
        label: projectStyle.label,
        isAnimated: projectStyle.isAnimated === true,
      };
      workspace = {
        ...workspace,
        projectPosterPrompt: pack.positivePrompt,
        projectPosterStatus: PROJECT_POSTER_STATUS.GENERATING,
        posterGenerationStatus: PROJECT_POSTER_STATUS.GENERATING,
        projectPosterStyle: posterStyleSnap,
        projectPosterMetadata: pack.metadata,
        globalProjectStyle: projectStyle,
        updatedAt: new Date().toISOString(),
      };
      await saveScenografiaProjectById(id, workspace);
      await upsertScenografiaProjectInIndex(id, workspace);
      setCreatePhase("poster");
      try {
        const { imageUrl } = await executeOfficialProjectPosterFlux(pack, () => {});
        const tUp = new Date().toISOString();
        workspace = {
          ...workspace,
          posterImageUrl: imageUrl,
          projectPosterUrl: imageUrl,
          projectPosterStatus: PROJECT_POSTER_STATUS.READY,
          posterGenerationStatus: PROJECT_POSTER_STATUS.READY,
          projectPosterUpdatedAt: tUp,
          updatedAt: tUp,
        };
        await saveScenografiaProjectById(id, workspace);
        await upsertScenografiaProjectInIndex(id, workspace);
      } catch (e) {
        if (typeof console !== "undefined" && console.warn) console.warn("[Scenografie] locandina:", e);
        const tUp = new Date().toISOString();
        workspace = {
          ...workspace,
          projectPosterStatus: PROJECT_POSTER_STATUS.FAILED,
          posterGenerationStatus: PROJECT_POSTER_STATUS.FAILED,
          projectPosterUpdatedAt: tUp,
          updatedAt: tUp,
        };
        await saveScenografiaProjectById(id, workspace);
        await upsertScenografiaProjectInIndex(id, workspace);
      }
      setCreatePhase("done");
      await refresh();
      setCreateModalOpen(false);
      setCreatePhase("idle");
      const idxAfter = await loadScenografiaProjectsIndex();
      const ord = Math.max(1, (idxAfter.projects || []).length);
      onOpenWorkspace(id, ord);
    } catch (e) {
      setCreateError(e?.message || "Creazione progetto non riuscita.");
      setCreatePhase("idle");
    } finally {
      setCreating(false);
    }
  }, [newTitle, newDescription, newPresetId, imageStylePresets, onOpenWorkspace, refresh]);

  const handleStoryWizardCommitted = useCallback(
    async (workspace) => {
      if (!workspace || creating) return;
      setCreating(true);
      setCreateError("");
      setCreatePhase("saving");
      const id = createScenografiaProjectId();
      const title = String(workspace.narrativeProjectTitle || workspace.projectTitle || "").trim();
      const description = String(workspace.narrativeProjectDescription || workspace.projectDescription || "").trim();
      const projectStyle = workspace.globalProjectStyle;
      try {
        let ws = { ...workspace };
        await saveScenografiaProjectById(id, ws);
        await upsertScenografiaProjectInIndex(id, ws);

        const pack = buildProjectPosterPromptPack({ workspace: ws });
        const posterStyleSnap = projectStyle
          ? {
              presetId: projectStyle.presetId,
              label: projectStyle.label,
              isAnimated: projectStyle.isAnimated === true,
            }
          : null;
        ws = {
          ...ws,
          projectPosterPrompt: pack.positivePrompt,
          projectPosterStatus: PROJECT_POSTER_STATUS.GENERATING,
          posterGenerationStatus: PROJECT_POSTER_STATUS.GENERATING,
          projectPosterStyle: posterStyleSnap,
          projectPosterMetadata: pack.metadata,
          globalProjectStyle: projectStyle,
          updatedAt: new Date().toISOString(),
        };
        await saveScenografiaProjectById(id, ws);
        await upsertScenografiaProjectInIndex(id, ws);
        setCreatePhase("poster");
        try {
          const { imageUrl } = await executeOfficialProjectPosterFlux(pack, () => {});
          const tUp = new Date().toISOString();
          ws = {
            ...ws,
            posterImageUrl: imageUrl,
            projectPosterUrl: imageUrl,
            projectPosterStatus: PROJECT_POSTER_STATUS.READY,
            posterGenerationStatus: PROJECT_POSTER_STATUS.READY,
            projectPosterUpdatedAt: tUp,
            updatedAt: tUp,
          };
          await saveScenografiaProjectById(id, ws);
          await upsertScenografiaProjectInIndex(id, ws);
        } catch (e) {
          if (typeof console !== "undefined" && console.warn) console.warn("[Scenografie] locandina story wizard:", e);
          const tUp = new Date().toISOString();
          ws = {
            ...ws,
            projectPosterStatus: PROJECT_POSTER_STATUS.FAILED,
            posterGenerationStatus: PROJECT_POSTER_STATUS.FAILED,
            projectPosterUpdatedAt: tUp,
            updatedAt: tUp,
          };
          await saveScenografiaProjectById(id, ws);
          await upsertScenografiaProjectInIndex(id, ws);
        }
        setCreatePhase("done");
        await refresh();
        setCreatePhase("idle");
        const idxAfter = await loadScenografiaProjectsIndex();
        const ord = Math.max(1, (idxAfter.projects || []).length);
        suppressStartChoiceAfterWizardCommitRef.current = true;
        onOpenWorkspace(id, ord);
      } catch (e) {
        setCreateError(e?.message || "Creazione da traccia non riuscita.");
        setCreatePhase("idle");
        throw e;
      } finally {
        setCreating(false);
      }
    },
    [creating, onOpenWorkspace, refresh]
  );

  const projectsSorted = [...(index.projects || [])].sort((a, b) =>
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "0 24px 28px" }}>
      <style>
        {`
        .scenografie-hub-catalog-grid {
          display: grid;
          width: 100%;
          box-sizing: border-box;
          gap: 10px;
          align-content: start;
          justify-items: stretch;
          grid-template-columns: 1fr;
        }
        @media (min-width: 420px) {
          .scenografie-hub-catalog-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (min-width: 720px) {
          .scenografie-hub-catalog-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
        @media (min-width: 960px) {
          .scenografie-hub-catalog-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        }
        @media (min-width: 1200px) {
          .scenografie-hub-catalog-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
        }
        @media (min-width: 1440px) {
          .scenografie-hub-catalog-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); }
        }
        `}
      </style>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 22 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: AX.text, margin: 0, display: "flex", alignItems: "center", gap: 10, letterSpacing: "-0.02em" }}>
            <HiFilm size={24} style={{ color: AX.violet }} />
            Elenco Film
          </h2>
          <p style={{ fontSize: 12, fontWeight: 700, color: AX.electric, margin: "8px 0 0", letterSpacing: "0.02em", maxWidth: 640, lineHeight: 1.45 }}>
            {MODULE_REGISTRY[MODULE_IDS.SCENOGRAFIE].ui.headerSubtitle}
          </p>
          <p style={{ fontSize: 13, color: AX.text2, marginTop: 8, maxWidth: 560, lineHeight: 1.55 }}>
            Ogni scheda è un <strong style={{ color: AX.text }}>progetto narrativo</strong>: locandina, più capitoli con scene, personaggi e clip. Apri un progetto per gestire i capitoli in ordine.
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            onClick={openStartChoiceModal}
            disabled={creating || !imageStylePresets.length}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background: AX.gradPrimary,
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              cursor: creating || !imageStylePresets.length ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              boxShadow: "0 4px 20px rgba(41,182,255,0.2)",
              opacity: !imageStylePresets.length ? 0.5 : 1,
            }}
          >
            <HiPlus size={18} />
            Nuovo progetto
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
            onClick={openStartChoiceModal}
            disabled={creating || !imageStylePresets.length}
            style={{
              padding: "12px 22px",
              borderRadius: 10,
              border: "none",
              background: AX.gradPrimary,
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              cursor: creating || !imageStylePresets.length ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              opacity: !imageStylePresets.length ? 0.5 : 1,
            }}
          >
            <HiPlus size={18} />
            Nuovo progetto
          </button>
        </div>
      ) : (
        <div className="scenografie-hub-catalog-grid">
          {projectsSorted.map((p, idx) => {
            const n = projectsSorted.length - idx;
            const s = p.summary || {};
            const displayTitle = s.displayTitle || "Senza titolo";
            const poster = typeof s.posterImageUrl === "string" && s.posterImageUrl.trim() ? s.posterImageUrl.trim() : null;
            const posterSt = s.projectPosterStatus || s.posterGenerationStatus || (poster ? "ready" : "none");
            const posterOutdated = s.projectPosterOutdated === true;
            const chaptersCount = s.chaptersCount != null ? s.chaptersCount : 1;
            const finaleLine = hubCardFilmFinaleLine(s);
            const finaleOk = finaleLine === "Film finale: disponibile";
            const initial = displayTitle.trim().charAt(0).toUpperCase() || "?";
            const metaBits = [
              `${chaptersCount} ${chaptersCount === 1 ? "capitolo" : "capitoli"}`,
              finaleLine,
            ].filter(Boolean);
            const metaText = metaBits.join(" · ");
            return (
              <div
                key={p.id}
                style={{
                  borderRadius: 12,
                  border: `1px solid ${AX.border}`,
                  background: AX.card,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
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
                  onClick={() => onOpenWorkspace(p.id, n)}
                  style={{
                    textAlign: "left",
                    cursor: "pointer",
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    flex: "0 0 auto",
                    minHeight: 0,
                    width: "100%",
                    color: "inherit",
                    font: "inherit",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      aspectRatio: "2 / 3",
                      width: "100%",
                      background: poster ? "#000" : `linear-gradient(160deg, rgba(41,182,255,0.35), rgba(123,77,255,0.45))`,
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    {poster ? (
                      <img src={poster} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    ) : (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 56,
                          fontWeight: 900,
                          color: "rgba(255,255,255,0.35)",
                          letterSpacing: "-0.04em",
                          gap: 8,
                          padding: 12,
                        }}
                      >
                        {posterSt === "failed" ? (
                          <>
                            <HiSparkles size={36} style={{ opacity: 0.5 }} />
                            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textAlign: "center", lineHeight: 1.4, maxWidth: 160 }}>
                              Locandina non generata
                            </span>
                          </>
                        ) : posterSt === "generating" ? (
                          <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
                            Locandina…
                          </span>
                        ) : (
                          initial
                        )}
                      </div>
                    )}
                    {poster && posterOutdated ? (
                      <div
                        style={{
                          position: "absolute",
                          left: 8,
                          right: 8,
                          bottom: 8,
                          pointerEvents: "none",
                          fontSize: 10,
                          fontWeight: 800,
                          textAlign: "center",
                          padding: "6px 8px",
                          borderRadius: 8,
                          background: "rgba(251,191,36,0.92)",
                          color: "#1a1003",
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
                        }}
                      >
                        Locandina da rigenerare
                      </div>
                    ) : null}
                    <div
                      style={{
                        position: "absolute",
                        left: 10,
                        top: 10,
                        pointerEvents: "none",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          color: "#fff",
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          textShadow: "0 1px 8px rgba(0,0,0,0.75)",
                        }}
                      >
                        Progetto #{n}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "8px 10px 7px",
                      flex: "0 0 auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      minHeight: 0,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: AX.text,
                        lineHeight: 1.25,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        wordBreak: "break-word",
                      }}
                    >
                      {displayTitle}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: finaleOk ? "#86efac" : AX.text2,
                        lineHeight: 1.3,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={metaText}
                    >
                      {metaText}
                    </div>
                  </div>
                </button>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "6px 8px",
                    borderTop: `1px solid ${AX.border}`,
                    background: "rgba(0,0,0,0.22)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      color: AX.muted,
                      minWidth: 0,
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={p.updatedAt ? new Date(p.updatedAt).toLocaleString("it-IT") : undefined}
                  >
                    {p.updatedAt
                      ? `Agg. ${new Date(p.updatedAt).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "2-digit" })}`
                      : "\u00a0"}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      aria-label={`Modifica progetto ${displayTitle}`}
                      title="Modifica titolo e descrizione"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void openEditProjectModal(p.id);
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        border: `1px solid ${AX.border}`,
                        background: AX.surface,
                        color: AX.electric,
                        cursor: "pointer",
                        transition: "background 0.15s ease, border-color 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(41,182,255,0.12)";
                        e.currentTarget.style.borderColor = "rgba(41,182,255,0.45)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = AX.surface;
                        e.currentTarget.style.borderColor = AX.border;
                      }}
                    >
                      <HiPencilSquare size={16} />
                    </button>
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
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 32,
                        height: 32,
                        borderRadius: 8,
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
                      <HiTrash size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {createModalOpen && (
        <div role="presentation" className="ax-modal-touch-lock" style={modalOverlayStyle} onClick={cancelCreateModal}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="scenografie-create-project-title"
            onClick={(e) => e.stopPropagation()}
            style={modalDialogStyle(720)}
          >
            <div style={modalGradientBarStyle} />
            <ProjectCreationModalHeader
              eyebrow="AXSTUDIO · FILM STUDIO"
              title="Nuovo progetto"
              titleId="scenografie-create-project-title"
              titleAdornment={<HiFilm size={26} style={{ color: AX.electric, flexShrink: 0 }} aria-hidden />}
              subtitle={
                <>
                  Creazione <strong style={{ color: AX.text }}>libera</strong>: titolo, descrizione e stile globale. Alla creazione generiamo la{" "}
                  <strong style={{ color: AX.text }}>locandina</strong> del progetto.
                </>
              }
              onClose={cancelCreateModal}
              closeDisabled={creating}
            />

            <div style={{ padding: "8px 24px 0", display: "flex", flexDirection: "column", gap: 16, flex: 1, minHeight: 0, overflowY: "auto" }}>
              <div>
                <label htmlFor="scenografie-free-title" style={labelStyle}>
                  Titolo progetto <span style={{ color: "#f87171" }}>*</span>
                </label>
                <input
                  id="scenografie-free-title"
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Es. La notte del faro"
                  disabled={creating}
                  style={inputFieldStyle}
                />
              </div>
              <div>
                <label htmlFor="scenografie-free-desc" style={labelStyle}>
                  Descrizione progetto <span style={{ color: "#f87171" }}>*</span>
                </label>
                <textarea
                  id="scenografie-free-desc"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Tema, ambientazione, tono narrativo…"
                  disabled={creating}
                  rows={4}
                  style={{ ...textareaFieldStyle, minHeight: 100 }}
                />
              </div>
              <div>
                <div style={{ ...labelStyle, marginBottom: 10 }}>Stile grafico globale <span style={{ color: "#f87171" }}>*</span></div>
                <ProjectStylePresetGrid
                  presets={imageStylePresets}
                  value={newPresetId}
                  onChange={setNewPresetId}
                  disabled={creating}
                />
              </div>
            </div>

            <div style={{ padding: "16px 24px 20px", flexShrink: 0 }}>
              {creating && createPhase === "saving" && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: "rgba(41,182,255,0.08)",
                    border: "1px solid rgba(41,182,255,0.35)",
                    fontSize: 12,
                    color: AX.electric,
                    fontWeight: 600,
                  }}
                >
                  Salvataggio progetto…
                </div>
              )}
              {creating && createPhase === "poster" && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: "rgba(123,77,255,0.1)",
                    border: "1px solid rgba(123,77,255,0.35)",
                    fontSize: 12,
                    color: "#c4b5fd",
                    fontWeight: 600,
                    lineHeight: 1.45,
                  }}
                >
                  Generazione locandina ufficiale (cover stile catalogo streaming)…
                </div>
              )}

              {createError && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.35)",
                    fontSize: 12,
                    color: "#fca5a5",
                  }}
                >
                  {createError}
                </div>
              )}

              <div style={{ ...footerDividerStyle, display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end" }}>
                <button type="button" onClick={cancelCreateModal} disabled={creating} style={{ ...btnSecondaryFooter, cursor: creating ? "not-allowed" : "pointer" }}>
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={() => void confirmCreateProject()}
                  disabled={
                    creating ||
                    !newTitle.trim() ||
                    !newDescription.trim() ||
                    !newPresetId ||
                    !imageStylePresets.some((p) => p.id === newPresetId)
                  }
                  style={btnPrimaryFooter(
                    creating ||
                      !newTitle.trim() ||
                      !newDescription.trim() ||
                      !newPresetId ||
                      !imageStylePresets.some((p) => p.id === newPresetId),
                  )}
                >
                  {creating ? "Creazione…" : "Crea progetto"}
                </button>
              </div>
              <p style={{ margin: "14px 0 0", fontSize: 11, color: AX.muted, lineHeight: 1.5, textAlign: "center", maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
                Il titolo non viene scritto sull&apos;immagine. Dopo la creazione puoi modificare metadati e rigenerare la locandina dalla scheda progetto.
              </p>
            </div>
          </div>
        </div>
      )}

      {editProjectId && (
        <div
          role="presentation"
          className="ax-modal-touch-lock"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            background: "rgba(6,6,12,0.82)",
            backdropFilter: "blur(10px)",
          }}
          onClick={() => !editSaveBusy && !editLoadBusy && closeEditProjectModal()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="scenografie-edit-project-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 480,
              borderRadius: 18,
              background: AX.card,
              border: `1px solid ${AX.border}`,
              boxShadow: "0 28px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(41,182,255,0.08)",
              overflow: "hidden",
            }}
          >
            <div style={{ height: 3, background: AX.gradPrimary, width: "100%" }} />
            <div style={{ padding: "22px 24px 20px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: AX.muted, letterSpacing: "0.1em", marginBottom: 6 }}>AXSTUDIO · SCENOGRAFIE</div>
                  <h2 id="scenografie-edit-project-title" style={{ margin: 0, fontSize: 20, fontWeight: 800, color: AX.text, letterSpacing: "-0.02em" }}>
                    Modifica progetto
                  </h2>
                  <p style={{ margin: "10px 0 0", fontSize: 13, color: AX.text2, lineHeight: 1.5 }}>
                    Titolo e descrizione guidano la locandina e la copertina di fallback. Se cambi il titolo senza rigenerare, la locandina viene segnata come da aggiornare.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Chiudi"
                  onClick={closeEditProjectModal}
                  disabled={editSaveBusy || editLoadBusy}
                  style={{
                    flexShrink: 0,
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    border: `1px solid ${AX.border}`,
                    background: AX.surface,
                    color: AX.text2,
                    cursor: editSaveBusy || editLoadBusy ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <HiXMark size={20} />
                </button>
              </div>

              {editLoadBusy ? (
                <div style={{ padding: "24px 0", textAlign: "center", color: AX.muted, fontSize: 14 }}>Caricamento…</div>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: AX.muted, marginBottom: 8, letterSpacing: "0.06em" }}>
                        Titolo progetto <span style={{ color: "#f87171" }}>*</span>
                      </label>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        disabled={editSaveBusy}
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          padding: "12px 14px",
                          borderRadius: 12,
                          border: `1px solid ${AX.border}`,
                          background: AX.surface,
                          color: AX.text,
                          fontSize: 14,
                          outline: "none",
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: AX.muted, marginBottom: 8, letterSpacing: "0.06em" }}>
                        Descrizione progetto (opzionale)
                      </label>
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        disabled={editSaveBusy}
                        rows={4}
                        placeholder="Tema, tono, pubblico…"
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          padding: "12px 14px",
                          borderRadius: 12,
                          border: `1px solid ${AX.border}`,
                          background: AX.surface,
                          color: AX.text,
                          fontSize: 14,
                          resize: "vertical",
                          minHeight: 100,
                          outline: "none",
                          lineHeight: 1.5,
                        }}
                      />
                    </div>
                  </div>
                  {editError ? (
                    <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.35)", fontSize: 12, color: "#fca5a5" }}>
                      {editError}
                    </div>
                  ) : null}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end", marginTop: 22 }}>
                    <button
                      type="button"
                      onClick={closeEditProjectModal}
                      disabled={editSaveBusy}
                      style={{
                        padding: "10px 18px",
                        borderRadius: 10,
                        border: `1px solid ${AX.border}`,
                        background: AX.surface,
                        color: AX.text2,
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: editSaveBusy ? "not-allowed" : "pointer",
                      }}
                    >
                      Annulla
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveEditedProject(false)}
                      disabled={editSaveBusy || !editTitle.trim()}
                      style={{
                        padding: "10px 18px",
                        borderRadius: 10,
                        border: `1px solid ${AX.border}`,
                        background: AX.surface,
                        color: AX.text,
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: editSaveBusy || !editTitle.trim() ? "not-allowed" : "pointer",
                        opacity: editSaveBusy || !editTitle.trim() ? 0.5 : 1,
                      }}
                    >
                      {editSaveBusy ? "Salvataggio…" : "Salva"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveEditedProject(true)}
                      disabled={editSaveBusy || !editTitle.trim()}
                      style={{
                        padding: "10px 18px",
                        borderRadius: 10,
                        border: "none",
                        background: AX.gradPrimary,
                        color: "#fff",
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: editSaveBusy || !editTitle.trim() ? "not-allowed" : "pointer",
                        opacity: editSaveBusy || !editTitle.trim() ? 0.5 : 1,
                        boxShadow: "0 4px 20px rgba(41,182,255,0.25)",
                      }}
                    >
                      {editSaveBusy ? "Locandina…" : "Salva e rigenera locandina"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div
          role="presentation"
          className="ax-modal-touch-lock"
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

      <ScenografieProjectStartChoiceModal
        open={startChoiceModalOpen}
        onClose={closeStartChoiceModal}
        onChooseGuided={handleStartChoiceGuided}
        onChooseFree={handleStartChoiceFree}
        disabled={creating}
      />

      <ScenografieStoryProjectWizard
        open={storyWizardOpen}
        onClose={closeStoryWizardModal}
        imageStylePresets={imageStylePresets}
        defaultPresetId={defaultPresetId}
        onCommitted={handleStoryWizardCommitted}
      />
    </div>
  );
}
