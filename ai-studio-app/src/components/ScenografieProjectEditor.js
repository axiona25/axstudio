/**
 * Editor singolo progetto Scenografie — piano, master, scene, approvazioni, passaggio video.
 */

import React, { useState, useRef, useCallback, useLayoutEffect, useEffect, useMemo } from "react";
import {
  HiSparkles,
  HiCheck,
  HiXMark,
  HiArrowPath,
  HiPhoto,
  HiUser,
  HiFilm,
  HiPlus,
  HiChevronUp,
  HiChevronDown,
  HiVideoCamera,
} from "react-icons/hi2";
import {
  planScenografia,
  planScenografiaContinue,
  validatePlan,
  getCharactersNeedingMaster,
  characterRoleLabelIt,
  CHARACTER_ROLE,
} from "../services/scenografiePlanner.js";
import {
  loadScenografiaProjectById,
  saveScenografiaProjectById,
  upsertScenografiaProjectInIndex,
  deleteScenografiaProjectById,
  scenografiaProjectFilePath,
  emptyScenografiaProjectPayload,
  deriveScenografiaUiStatus,
  SCENOGRAFIA_UI_STATUS_LABEL,
} from "../services/scenografieProjectPersistence.js";
import {
  createMasterCharacter,
  generateSceneBase,
  lockCharacterIdentity,
  repairCharacterScene,
  editScenografiaSceneWithPrompt,
  imageUrlToBase64,
} from "../services/imagePipeline.js";
import { isAnimatedStyle } from "../services/imagePrompts.js";
import { buildProjectStyleFromPlan, composeGlobalVisualStyle } from "../services/scenografieProjectStyle.js";
import {
  normalizeSceneVideoClip,
  newSceneVideoClipId,
  SCENE_VIDEO_CLIP_STATUS,
  SCENE_VIDEO_CLIP_STATUS_LABEL,
  allActiveScenesApproved,
  allCharacterMastersApprovedForVideo,
  clipsReadyForFinalMontage,
  buildMontagePlanFromTimeline,
  buildSuggestedTimelineEntries,
  getApprovedActiveScenes,
  normalizeTimelinePlan,
  timelineNarrativeApproved,
} from "../services/scenografieVideoWorkflow.js";

const AX = {
  bg: "#0a0a0f", surface: "#13131a", card: "#1a1a24", border: "#23232e",
  text: "#f4f4f8", text2: "#a1a1b5", muted: "#6b6b80",
  electric: "#29b6ff", violet: "#7b4dff", magenta: "#ff4fa3",
  gradPrimary: "linear-gradient(135deg, #29b6ff 0%, #7b4dff 100%)",
  gradLogo: "linear-gradient(135deg,#29b6ff,#7b4dff,#ff4fa3)",
};

const PROMPT_TEXTAREA_MIN_PX = 240;
const PROMPT_TEXTAREA_MAX_PX = 520;

function normCharName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Mappa id personaggio del nuovo piano → URL master preservati per nome. */
function mergePreservedMastersByName(plan, byName) {
  const out = {};
  (plan?.characters || []).forEach((c) => {
    const url = byName[normCharName(c.name)];
    if (url) out[c.id] = url;
  });
  return out;
}

/** Riassunto breve per testata (max ~2 righe equivalenti). */
function deriveShortDescription(plan, prompt) {
  const sum = plan?.summary_it != null && String(plan.summary_it).trim();
  if (sum) {
    const t = String(plan.summary_it).trim().replace(/\s+/g, " ");
    return t.length > 220 ? `${t.slice(0, 217)}…` : t;
  }
  const raw = typeof prompt === "string" ? prompt.trim() : "";
  if (!raw) return "";
  const flat = raw.replace(/\s+/g, " ");
  const first = flat.split(/(?<=[.!?])\s+/)[0] || flat;
  return first.length > 200 ? `${first.slice(0, 197)}…` : first;
}

/** Suggerimento placeholder nome progetto se l’utente non ne ha impostato uno. */
function fallbackProjectTitlePlaceholder(plan, prompt) {
  const sum = plan?.summary_it && String(plan.summary_it).trim();
  if (sum) {
    const t = String(plan.summary_it).trim().replace(/\s+/g, " ");
    return t.length > 52 ? `${t.slice(0, 50)}…` : t;
  }
  const t0 = plan?.scenes?.[0]?.title_it;
  if (t0) {
    const t = String(t0).trim();
    return t.length > 52 ? `${t.slice(0, 50)}…` : t;
  }
  const pr = typeof prompt === "string" && prompt.trim();
  if (pr) {
    const t = pr.replace(/\s+/g, " ");
    return t.length > 48 ? `${t.slice(0, 46)}…` : t;
  }
  return "Progetto scenografico";
}

function normalizeSceneResultRow(r) {
  if (!r || typeof r !== "object" || !r.sceneId) return r;
  const hist = Array.isArray(r.editHistory) ? r.editHistory.slice(-8) : [];
  return {
    sceneId: r.sceneId,
    title: r.title,
    imageUrl: r.imageUrl,
    approved: r.approved === true,
    approvedAt: r.approvedAt ?? null,
    lastEditPrompt: r.lastEditPrompt ?? null,
    editHistory: hist,
    lastUpdatedAt: r.lastUpdatedAt ?? null,
  };
}

export function ScenografieProjectEditor({
  projectId,
  projectNumber = 1,
  onBack,
  onGoToVideoProduction,
  onSave,
  generatedImages,
  setGeneratedImages,
  imageStatus,
  setImageStatus,
  imageProgress,
  setImageProgress,
  imageStylePresets = [],
}) {
  const [prompt, setPrompt] = useState("");
  /** Nome progetto scenografico (persistito). */
  const [projectTitle, setProjectTitle] = useState("");
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState("");
  const [executing, setExecuting] = useState(false);
  const [executionLog, setExecutionLog] = useState([]);
  const [masterImages, setMasterImages] = useState({});
  /** Allineato a masterImages per skip nel batch senza attendere il re-render. */
  const masterImagesRef = useRef({});
  masterImagesRef.current = masterImages;
  /** URL master per nome normalizzato — sopravvive a nuovi piano con id diversi. */
  const [masterByCharName, setMasterByCharName] = useState({});
  const [sceneResults, setSceneResults] = useState([]);
  const [enableRepair, setEnableRepair] = useState(false);
  /** Stile visivo globale del progetto Scenografie (unico, dopo approvazione bloccato). */
  const [projectStyle, setProjectStyle] = useState(null);
  const [projectStyleLocked, setProjectStyleLocked] = useState(false);
  /** Scene selezionate per rigenerazione mirata (id piano). */
  const [selectedSceneIds, setSelectedSceneIds] = useState([]);
  const [persistReady, setPersistReady] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [newProjectConfirmOpen, setNewProjectConfirmOpen] = useState(false);
  /** plan | character_gen | character_approval | scene_gen | complete */
  const [scenografiaPhase, setScenografiaPhase] = useState("plan");
  /** none | production | completed — navigazione verso sezione video libera */
  const [scenografiaVideoPhase, setScenografiaVideoPhase] = useState("none");
  /** none | assembly | done — produzione filmato finale + auto-montaggio (struttura). */
  const [finalMontagePhase, setFinalMontagePhase] = useState("none");
  const [finalMontagePlan, setFinalMontagePlan] = useState({
    orderedClipIds: [],
    orderedTimelineEntryIds: [],
    narrativeBeatNotes: "",
  });
  const [timelinePlan, setTimelinePlan] = useState({ approved: false, approvedAt: null, entries: [] });
  const dragTimelineIdxRef = useRef(null);
  /** Clip video per scena (URL da collegare al motore). */
  const [sceneVideoClips, setSceneVideoClips] = useState([]);
  const [modifyingClipId, setModifyingClipId] = useState(null);
  const [modifyClipDraft, setModifyClipDraft] = useState("");
  const [characterApprovalMap, setCharacterApprovalMap] = useState({});
  const [regeneratingCharId, setRegeneratingCharId] = useState(null);
  /** Durante «Genera master personaggi», quale card è in elaborazione. */
  const [batchMasterCharId, setBatchMasterCharId] = useState(null);
  /** Id scene del piano rimosse dal progetto (non rigenerate finché restano qui). */
  const [deletedSceneIds, setDeletedSceneIds] = useState([]);
  const [sceneCardFocusId, setSceneCardFocusId] = useState(null);
  const [modifyingSceneId, setModifyingSceneId] = useState(null);
  const [modifyDraftPrompt, setModifyDraftPrompt] = useState("");
  const [sceneEditBusyId, setSceneEditBusyId] = useState(null);
  const [hoveredSceneId, setHoveredSceneId] = useState(null);
  const abortRef = useRef(false);
  /** Se true, al prossimo `handleExecute` si riusano i master esistenti (niente createMaster salvo mancanze). */
  const reuseMastersRef = useRef(false);
  /** ALL | NEW_ONLY | SELECTED — cosa elabora `handleExecute`. */
  const sceneExecuteModeRef = useRef("ALL");
  /** Se valorizzato, `SELECTED` usa solo questo id (evita race su setState). */
  const singleSceneOverrideRef = useRef(null);
  const promptTextareaRef = useRef(null);
  /** Snapshot per salvataggio immediato (es. passaggio video). */
  const persistSnapshotRef = useRef(null);

  const syncPromptTextareaHeight = useCallback(() => {
    const el = promptTextareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const sh = el.scrollHeight;
    const next = Math.min(Math.max(sh, PROMPT_TEXTAREA_MIN_PX), PROMPT_TEXTAREA_MAX_PX);
    el.style.height = `${next}px`;
    el.style.overflowY = sh > PROMPT_TEXTAREA_MAX_PX ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    syncPromptTextareaHeight();
  }, [prompt, syncPromptTextareaHeight]);

  useEffect(() => {
    let cancelled = false;
    setPersistReady(false);
    void (async () => {
      try {
        const d = projectId ? await loadScenografiaProjectById(projectId) : null;
        if (cancelled) return;
        if (d) {
          if (typeof d.prompt === "string") setPrompt(d.prompt);
          if (typeof d.scenografiaProjectTitle === "string") setProjectTitle(d.scenografiaProjectTitle);
          else setProjectTitle("");
          if (d.plan) {
            try {
              const planCopy = JSON.parse(JSON.stringify(d.plan));
              const v = validatePlan(planCopy);
              setPlan(v.valid ? planCopy : d.plan);
            } catch {
              setPlan(d.plan);
            }
          }
          if (d.projectStyle) setProjectStyle(d.projectStyle);
          if (typeof d.projectStyleLocked === "boolean") setProjectStyleLocked(d.projectStyleLocked);
          if (d.masterImages && typeof d.masterImages === "object") setMasterImages(d.masterImages);
          if (d.masterByCharName && typeof d.masterByCharName === "object") setMasterByCharName(d.masterByCharName);
          if (Array.isArray(d.sceneResults)) {
            setSceneResults(d.sceneResults.map((r) => normalizeSceneResultRow(r)));
          }
          if (Array.isArray(d.deletedSceneIds)) setDeletedSceneIds(d.deletedSceneIds);
          if (Array.isArray(d.executionLog)) setExecutionLog(d.executionLog);
          if (typeof d.enableRepair === "boolean") setEnableRepair(d.enableRepair);
          if (Array.isArray(d.selectedSceneIds)) setSelectedSceneIds(d.selectedSceneIds);
          if (d.updatedAt) setLastSavedAt(d.updatedAt);
          if (typeof d.scenografiaVideoPhase === "string" && ["none", "production", "completed"].includes(d.scenografiaVideoPhase)) {
            setScenografiaVideoPhase(d.scenografiaVideoPhase);
          } else {
            setScenografiaVideoPhase("none");
          }
          if (typeof d.finalMontagePhase === "string" && ["none", "assembly", "done"].includes(d.finalMontagePhase)) {
            setFinalMontagePhase(d.finalMontagePhase);
          } else {
            setFinalMontagePhase("none");
          }
          if (d.finalMontagePlan && typeof d.finalMontagePlan === "object") {
            setFinalMontagePlan({
              orderedClipIds: Array.isArray(d.finalMontagePlan.orderedClipIds) ? d.finalMontagePlan.orderedClipIds : [],
              orderedTimelineEntryIds: Array.isArray(d.finalMontagePlan.orderedTimelineEntryIds)
                ? d.finalMontagePlan.orderedTimelineEntryIds
                : [],
              narrativeBeatNotes:
                typeof d.finalMontagePlan.narrativeBeatNotes === "string" ? d.finalMontagePlan.narrativeBeatNotes : "",
            });
          } else {
            setFinalMontagePlan({ orderedClipIds: [], orderedTimelineEntryIds: [], narrativeBeatNotes: "" });
          }
          if (d.timelinePlan && typeof d.timelinePlan === "object") {
            setTimelinePlan(normalizeTimelinePlan(d.timelinePlan));
          } else {
            setTimelinePlan({ approved: false, approvedAt: null, entries: [] });
          }
          if (Array.isArray(d.sceneVideoClips)) {
            setSceneVideoClips(d.sceneVideoClips.map((c) => normalizeSceneVideoClip(c)).filter(Boolean));
          } else {
            setSceneVideoClips([]);
          }
          if (d.runtimeHints && typeof d.runtimeHints === "object") {
            if (typeof d.runtimeHints.sceneExecuteMode === "string") {
              sceneExecuteModeRef.current = d.runtimeHints.sceneExecuteMode;
            }
            if (typeof d.runtimeHints.reuseMastersNext === "boolean") {
              reuseMastersRef.current = d.runtimeHints.reuseMastersNext;
            }
          }
          const phases = ["plan", "character_gen", "character_approval", "scene_gen", "complete"];
          let phase =
            typeof d.scenografiaPhase === "string" && phases.includes(d.scenografiaPhase)
              ? d.scenografiaPhase
              : null;
          if (phase === "character_gen") phase = "character_approval";
          let approvals =
            d.characterApprovalMap && typeof d.characterApprovalMap === "object"
              ? { ...d.characterApprovalMap }
              : {};
          if (d.plan && Object.keys(approvals).length === 0) {
            const needMaster = getCharactersNeedingMaster(d.plan);
            const masters = d.masterImages || {};
            const hasScenes = Array.isArray(d.sceneResults) && d.sceneResults.length > 0;
            const allMastered = needMaster.length > 0 && needMaster.every((c) => masters[c.id]);
            if (!phase) {
              if (hasScenes && allMastered) phase = "complete";
              else if (allMastered) phase = "character_approval";
              else phase = "plan";
            }
            if (allMastered) {
              needMaster.forEach((c) => {
                if (masters[c.id] && !approvals[c.id]) {
                  approvals[c.id] = hasScenes
                    ? { approved: true, approvedAt: d.updatedAt || new Date().toISOString(), version: 1 }
                    : { approved: false, approvedAt: null, version: 1 };
                }
              });
            }
          }
          if (phase) setScenografiaPhase(phase);
          setCharacterApprovalMap(approvals);
        } else {
          const b = emptyScenografiaProjectPayload();
          setPrompt(b.prompt || "");
          setProjectTitle(b.scenografiaProjectTitle || "");
          setPlan(null);
          setProjectStyle(null);
          setProjectStyleLocked(false);
          setMasterImages({});
          setMasterByCharName({});
          setSceneResults([]);
          setDeletedSceneIds([]);
          setExecutionLog([]);
          setEnableRepair(!!b.enableRepair);
          setSelectedSceneIds([]);
          setScenografiaPhase("plan");
          setScenografiaVideoPhase("none");
          setFinalMontagePhase("none");
          setFinalMontagePlan({ orderedClipIds: [], orderedTimelineEntryIds: [], narrativeBeatNotes: "" });
          setTimelinePlan({ approved: false, approvedAt: null, entries: [] });
          setSceneVideoClips([]);
          setModifyingClipId(null);
          setModifyClipDraft("");
          setCharacterApprovalMap({});
          sceneExecuteModeRef.current = "ALL";
          reuseMastersRef.current = false;
        }
      } finally {
        if (!cancelled) {
          setTimeout(() => {
            if (!cancelled) setPersistReady(true);
          }, 0);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!persistReady || !projectId) return;
    const t = setTimeout(() => {
      void (async () => {
        const payload = {
          prompt,
          scenografiaProjectTitle: projectTitle,
          plan,
          projectStyle,
          projectStyleLocked,
          masterImages,
          masterByCharName,
          sceneResults,
          executionLog,
          enableRepair,
          selectedSceneIds,
          deletedSceneIds,
          scenografiaPhase,
          characterApprovalMap,
          scenografiaVideoPhase,
          sceneVideoClips,
          finalMontagePhase,
          finalMontagePlan,
          timelinePlan,
          runtimeHints: {
            sceneExecuteMode: sceneExecuteModeRef.current,
            reuseMastersNext: reuseMastersRef.current,
          },
        };
        const ok = await saveScenografiaProjectById(projectId, payload);
        if (ok) {
          await upsertScenografiaProjectInIndex(projectId, payload);
          setLastSavedAt(new Date().toISOString());
        }
      })();
    }, 400);
    return () => clearTimeout(t);
  }, [
    persistReady,
    projectId,
    prompt,
    projectTitle,
    plan,
    projectStyle,
    projectStyleLocked,
    masterImages,
    masterByCharName,
    sceneResults,
    executionLog,
    enableRepair,
    selectedSceneIds,
    deletedSceneIds,
    scenografiaPhase,
    characterApprovalMap,
    scenografiaVideoPhase,
    sceneVideoClips,
    finalMontagePhase,
    finalMontagePlan,
    timelinePlan,
  ]);

  useEffect(() => {
    persistSnapshotRef.current = {
      prompt,
      scenografiaProjectTitle: projectTitle,
      plan,
      projectStyle,
      projectStyleLocked,
      masterImages,
      masterByCharName,
      sceneResults,
      executionLog,
      enableRepair,
      selectedSceneIds,
      deletedSceneIds,
      scenografiaPhase,
      characterApprovalMap,
      scenografiaVideoPhase,
      sceneVideoClips,
      finalMontagePhase,
      finalMontagePlan,
      timelinePlan,
      runtimeHints: {
        sceneExecuteMode: sceneExecuteModeRef.current,
        reuseMastersNext: reuseMastersRef.current,
      },
    };
  }, [
    prompt,
    projectTitle,
    plan,
    projectStyle,
    projectStyleLocked,
    masterImages,
    masterByCharName,
    sceneResults,
    executionLog,
    enableRepair,
    selectedSceneIds,
    deletedSceneIds,
    scenografiaPhase,
    characterApprovalMap,
    scenografiaVideoPhase,
    sceneVideoClips,
    finalMontagePhase,
    finalMontagePlan,
    timelinePlan,
  ]);

  useEffect(() => {
    if (!plan?.scenes) return;
    const ids = new Set(plan.scenes.map((s) => s.id));
    setSelectedSceneIds((prev) => prev.filter((id) => ids.has(id)));
    setDeletedSceneIds((prev) => prev.filter((id) => ids.has(id)));
  }, [plan]);

  const addLog = useCallback((msg) => {
    setExecutionLog((prev) => [...prev, { time: new Date().toLocaleTimeString(), msg }]);
  }, []);

  /** Solo piano e scene: i master restano in memoria per il prossimo analizza / genera. */
  const resetPlanKeepMasters = useCallback(() => {
    setPlan(null);
    setProjectStyle(null);
    setProjectStyleLocked(false);
    setSceneResults([]);
    setExecutionLog([]);
    setPlanError("");
    setSelectedSceneIds([]);
    reuseMastersRef.current = false;
    sceneExecuteModeRef.current = "ALL";
    setScenografiaPhase("plan");
    setCharacterApprovalMap({});
    setRegeneratingCharId(null);
    setDeletedSceneIds([]);
    setSceneCardFocusId(null);
    setModifyingSceneId(null);
    setModifyDraftPrompt("");
    setSceneEditBusyId(null);
    setHoveredSceneId(null);
  }, []);

  const openNewProjectConfirm = useCallback(() => {
    setNewProjectConfirmOpen(true);
  }, []);

  const cancelNewProjectConfirm = useCallback(() => {
    setNewProjectConfirmOpen(false);
  }, []);

  const confirmNewProjectReset = useCallback(() => {
    setNewProjectConfirmOpen(false);
    void (async () => {
      await deleteScenografiaProjectById(projectId);
      onBack?.();
    })();
  }, [projectId, onBack]);

  useEffect(() => {
    if (!newProjectConfirmOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") cancelNewProjectConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newProjectConfirmOpen, cancelNewProjectConfirm]);

  /** Estende il piano (nuove scene / sviluppi) senza perdere master né scene già ok. */
  const handlePlanContinue = async () => {
    if (!plan || !prompt.trim()) return;
    setPlanning(true);
    setPlanError("");
    reuseMastersRef.current = false;
    sceneExecuteModeRef.current = "ALL";

    try {
      const result = await planScenografiaContinue(plan, prompt.trim());
      if (!result) {
        setPlanError("Impossibile aggiornare il piano. Riprova.");
        return;
      }
      const validation = validatePlan(result);
      if (!validation.valid) {
        setPlanError(validation.error);
        return;
      }
      const validIds = new Set((result.scenes || []).map((s) => s.id));
      setDeletedSceneIds((prev) => prev.filter((id) => validIds.has(id)));
      setSceneResults((prev) => prev.filter((r) => validIds.has(r.sceneId)));
      setPlan(result);
      if (!projectStyleLocked) {
        setProjectStyle(buildProjectStyleFromPlan(result, imageStylePresets));
      }
      setMasterImages((prev) => {
        const fromNames = mergePreservedMastersByName(result, masterByCharName);
        const merged = { ...fromNames };
        (result.characters || []).forEach((c) => {
          if (!merged[c.id] && prev[c.id]) merged[c.id] = prev[c.id];
        });
        return merged;
      });
      setCharacterApprovalMap((prev) => {
        const next = { ...prev };
        (result.characters || []).forEach((c) => {
          if (next[c.id] == null) next[c.id] = { approved: false, approvedAt: null, version: 0 };
        });
        Object.keys(next).forEach((k) => {
          if (!(result.characters || []).some((x) => x.id === k)) delete next[k];
        });
        return next;
      });
      setScenografiaPhase("plan");
    } catch (err) {
      setPlanError(err.message || "Errore durante l'estensione del piano");
    } finally {
      setPlanning(false);
    }
  };

  const handlePlan = async (preserveMasters = false) => {
    if (!prompt.trim()) return;
    setPlanning(true);
    setPlanError("");
    setPlan(null);
    setExecutionLog([]);
    setSceneResults([]);
    setSelectedSceneIds([]);
    setDeletedSceneIds([]);
    setScenografiaPhase("plan");
    if (!preserveMasters) {
      setProjectStyle(null);
      setProjectStyleLocked(false);
      setMasterImages({});
      setMasterByCharName({});
      setCharacterApprovalMap({});
    } else {
      setProjectStyleLocked(false);
    }
    reuseMastersRef.current = false;

    try {
      const result = await planScenografia(prompt.trim());
      if (!result) {
        setPlanError("Impossibile analizzare il prompt. Riprova con più dettagli.");
        return;
      }
      const validation = validatePlan(result);
      if (!validation.valid) {
        setPlanError(validation.error);
        return;
      }
      setPlan(result);
      setProjectStyle(buildProjectStyleFromPlan(result, imageStylePresets));
      if (preserveMasters) {
        setMasterImages((prev) => {
          const fromNames = mergePreservedMastersByName(result, masterByCharName);
          const merged = { ...fromNames };
          (result.characters || []).forEach((c) => {
            if (!merged[c.id] && prev[c.id]) merged[c.id] = prev[c.id];
          });
          return merged;
        });
        setCharacterApprovalMap((prev) => {
          const next = { ...prev };
          (result.characters || []).forEach((c) => {
            if (next[c.id] == null) next[c.id] = { approved: false, approvedAt: null, version: 0 };
          });
          Object.keys(next).forEach((k) => {
            if (!(result.characters || []).some((x) => x.id === k)) delete next[k];
          });
          return next;
        });
      }
    } catch (err) {
      setPlanError(err.message || "Errore durante l'analisi");
    } finally {
      setPlanning(false);
    }
  };

  const handleExecute = async () => {
    if (!plan) return;
    const charsNeedingMaster = getCharactersNeedingMaster(plan);
    const missingMaster = charsNeedingMaster.filter((c) => !masterImages[c.id]);
    if (missingMaster.length > 0) {
      setPlanError(
        `Genera il master per ogni personaggio richiesto (${missingMaster.map((c) => c.name).join(", ")}) con «Genera personaggio» sulla card o «Genera master personaggi», poi approva tutti.`
      );
      return;
    }
    const approvedOk =
      charsNeedingMaster.length > 0 &&
      charsNeedingMaster.every(
        (c) => characterApprovalMap[c.id]?.approved === true && !!masterImages[c.id]
      );
    if (!approvedOk) {
      setPlanError(
        "Approva tutti i personaggi con master (protagonisti e ricorrenti): ognuno deve avere «Approva personaggio» prima di generare le scene."
      );
      return;
    }

    const lockedStyle =
      projectStyle || buildProjectStyleFromPlan(plan, imageStylePresets);
    const globalStyleNote = composeGlobalVisualStyle(lockedStyle).slice(0, 900);

    const hadScenesBefore = sceneResults.length > 0;
    const explicitReuseMasters = reuseMastersRef.current;
    reuseMastersRef.current = false;

    const exMode = sceneExecuteModeRef.current;
    sceneExecuteModeRef.current = "ALL";

    let selectedRemovalIds = null;
    if (exMode === "SELECTED") {
      const override = singleSceneOverrideRef.current;
      selectedRemovalIds = override ? [override] : [...selectedSceneIds];
      if (override) singleSceneOverrideRef.current = null;
    }

    const existingById = Object.fromEntries(sceneResults.map((r) => [r.sceneId, r]));
    const del = new Set(deletedSceneIds || []);
    let scenesToRun = (plan.scenes || []).filter((s) => !del.has(s.id));
    if (exMode === "NEW_ONLY") {
      scenesToRun = scenesToRun.filter((s) => !existingById[s.id]);
    } else if (exMode === "SELECTED") {
      const sel = new Set(selectedRemovalIds || []);
      scenesToRun = scenesToRun.filter((s) => sel.has(s.id));
    }

    if (scenesToRun.length === 0) {
      setPlanError("Nessuna scena da elaborare: controlla il piano o la selezione.");
      return;
    }

    const partialRun = exMode !== "ALL";

    setProjectStyle(lockedStyle);
    setScenografiaPhase("scene_gen");
    setExecuting(true);
    abortRef.current = false;
    setPlanError("");

    const stamp = new Date().toLocaleTimeString();
    if (exMode === "ALL") {
      setExecutionLog([]);
    } else {
      setExecutionLog((prev) => [...prev, { time: stamp, msg: `── Modalità: ${exMode === "NEW_ONLY" ? "solo scene mancanti" : "solo scene selezionate"} ──` }]);
    }

    if (exMode === "ALL") {
      setSceneResults([]);
    } else if (exMode === "SELECTED") {
      const rm = new Set(selectedRemovalIds || []);
      setSceneResults((prev) => prev.filter((r) => !rm.has(r.sceneId)));
    }

    const masters = {};
    for (const char of charsNeedingMaster) {
      if (characterApprovalMap[char.id]?.approved && masterImages[char.id]) {
        masters[char.id] = masterImages[char.id];
      }
    }

    try {
      const animated = lockedStyle.isAnimated;

      if (partialRun || explicitReuseMasters || hadScenesBefore) {
        addLog(
          partialRun
            ? `Scene (${scenesToRun.length}): solo master già approvati.`
            : explicitReuseMasters || hadScenesBefore
              ? "Rigenerazione scene con master approvati."
              : "Generazione scene."
        );
      }

      // ── Scene pipeline (master già approvati) ──
      const results = [];
      const totalRun = scenesToRun.length;
      for (let i = 0; i < totalRun; i++) {
        if (abortRef.current) break;
        const scene = scenesToRun[i];
        const pct = 20 + Math.round((i / totalRun) * 60);
        setImageProgress(pct);

        addLog(`Scena ${i + 1}/${totalRun}: ${scene.title_it}…`);
        setImageStatus(`Scena: ${scene.title_it}…`);

        try {
          // Find which protagonists appear in this scene
          const sceneCharIds = scene.characters_present || [charsNeedingMaster[0]?.id];
          const protagonistId = sceneCharIds[0];
          const protagonistChar = plan.characters.find((c) => c.id === protagonistId);

          const numSubjects =
            (scene.characters_present?.length || 1) > 1
              ? scene.characters_present.length
              : 1;

          const supportingChars = plan.characters
            .filter(
              (c) =>
                scene.characters_present?.includes(c.id) && c.id !== protagonistId
            )
            .map((c) => c.appearance_prompt || c.name)
            .join(". ");

          // Use appearance_prompt (English string) as the scene description
          // rather than the structured appearance object
          const sceneResult = await generateSceneBase({
            sceneDescription: scene.description,
            appearance: { detailedDescription: protagonistChar?.appearance_prompt || "" },
            outfit: scene.outfit_override || protagonistChar?.appearance?.outfit || "",
            environment: scene.environment || "",
            lighting: scene.lighting || "",
            palette: scene.mood || "",
            visualStyle: lockedStyle.plannerVisualNotes || "",
            stylePrefixes: [lockedStyle.stylePrompt],
            negativePrompt: lockedStyle.negativePrompt || undefined,
            numSubjects,
            supportingCharacters: supportingChars || undefined,
            aspectRatio: "16:9",
          });

          addLog(`Scena base generata — applicazione identità…`);
          let finalUrl = sceneResult.outputImage;

          // Identity lock: apply each protagonist master that has been created
          // For multi-protagonist scenes, apply sequentially (first protagonist first)
          const sceneProtagonistIds = sceneCharIds.filter((id) => masters[id]);
          for (let pi = 0; pi < sceneProtagonistIds.length; pi++) {
            const pId = sceneProtagonistIds[pi];
            const masterUrl = masters[pId];
            const pChar = plan.characters.find((c) => c.id === pId);
            const label = pChar?.name || pId;

            setImageStatus(`Identity lock: ${label}…`);
            try {
              const lockResult = await lockCharacterIdentity({
                sceneImageUrl: finalUrl,
                masterImageUrl: masterUrl,
                isAnimated: animated,
                globalVisualStyleNote: globalStyleNote,
              });
              finalUrl = lockResult.outputImage;
              addLog(`Identity lock OK — ${label}`);
            } catch (lockErr) {
              addLog(`Identity lock fallito per ${label}: ${lockErr.message}`);
            }
          }

          // Optional repair pass (once, after all identity locks)
          if (enableRepair && sceneProtagonistIds.length > 0) {
            setImageStatus("Repair pass…");
            try {
              const repairResult = await repairCharacterScene({
                imageUrl: finalUrl,
                isAnimated: animated,
                globalVisualStyleNote: globalStyleNote,
              });
              if (repairResult.status !== "skipped") {
                finalUrl = repairResult.outputImage;
                addLog(`Repair pass OK`);
              }
            } catch (repErr) {
              addLog(`Repair skip: ${repErr.message}`);
            }
          }

          const updatedAt = new Date().toISOString();
          results.push({
            sceneId: scene.id,
            title: scene.title_it,
            imageUrl: finalUrl,
            baseImageUrl: sceneResult.outputImage,
            mastersUsed: sceneProtagonistIds.map((id) => masters[id]),
          });

          setSceneResults((prev) => {
            const map = new Map(prev.map((r) => [r.sceneId, r]));
            const prevRow = map.get(scene.id);
            map.set(
              scene.id,
              normalizeSceneResultRow({
                sceneId: scene.id,
                title: scene.title_it,
                imageUrl: finalUrl,
                approved: false,
                approvedAt: null,
                lastEditPrompt: null,
                editHistory: prevRow?.editHistory ? [...prevRow.editHistory] : [],
                lastUpdatedAt: updatedAt,
              })
            );
            return (plan.scenes || [])
              .filter((s) => !del.has(s.id))
              .map((s) => map.get(s.id))
              .filter(Boolean);
          });

          // Save
          if (onSave) {
            try {
              const dataUrl = await imageUrlToBase64(finalUrl);
              await onSave(dataUrl, scene.description, {
                projectImageMode: "scenografia",
                sceneId: scene.id,
                sceneTitle: scene.title_it,
                type: "scenografia_scene",
                scenografiaProjectStyle: {
                  presetId: lockedStyle.presetId,
                  label: lockedStyle.label,
                  plannerVisualNotes: lockedStyle.plannerVisualNotes,
                  isAnimated: lockedStyle.isAnimated,
                },
              });
            } catch (saveErr) {
              console.error("[SCENOGRAFIE] Save failed:", saveErr);
            }
          }
        } catch (sceneErr) {
          addLog(`ERRORE scena ${scene.title_it}: ${sceneErr.message}`);
          console.error("[SCENOGRAFIE] Scene failed:", scene.title_it, sceneErr);
        }
      }

      addLog(`Completato: ${results.length}/${totalRun} scene elaborate in questa esecuzione`);
      setImageStatus("");
      setImageProgress(100);
      setTimeout(() => setImageProgress(0), 1500);
      setProjectStyleLocked(true);
      setScenografiaPhase("complete");
      if (exMode === "SELECTED") setSelectedSceneIds([]);
    } catch (err) {
      addLog(`ERRORE PIPELINE: ${err.message}`);
      setImageStatus("");
      setImageProgress(0);
      setScenografiaPhase((ph) => (ph === "scene_gen" ? "character_approval" : ph));
    } finally {
      setExecuting(false);
    }
  };

  /** Stesso piano: rigenera tutte le scene (salta master già presenti). */
  const regenerateScenesOnly = () => {
    if (!plan || executing) return;
    sceneExecuteModeRef.current = "ALL";
    reuseMastersRef.current = true;
    setSceneResults([]);
    setExecutionLog([]);
    setProjectStyleLocked(false);
    void handleExecute();
  };

  const runMissingScenesOnly = () => {
    if (!plan || executing) return;
    sceneExecuteModeRef.current = "NEW_ONLY";
    reuseMastersRef.current = true;
    setProjectStyleLocked(false);
    void handleExecute();
  };

  const runSelectedScenesOnly = () => {
    if (!plan || executing || selectedSceneIds.length === 0) return;
    sceneExecuteModeRef.current = "SELECTED";
    reuseMastersRef.current = true;
    setProjectStyleLocked(false);
    void handleExecute();
  };

  const regenerateSingleScene = (sceneId) => {
    if (!plan || executing) return;
    singleSceneOverrideRef.current = sceneId;
    sceneExecuteModeRef.current = "SELECTED";
    reuseMastersRef.current = true;
    setSelectedSceneIds([sceneId]);
    setProjectStyleLocked(false);
    void handleExecute();
  };

  const handleAbort = () => {
    abortRef.current = true;
    setProjectStyleLocked(false);
    setScenografiaPhase((ph) =>
      ph === "character_gen" || ph === "scene_gen" ? "character_approval" : ph
    );
    addLog("Interruzione richiesta…");
  };

  const approveScene = useCallback((sceneId) => {
    const now = new Date().toISOString();
    setSceneResults((prev) =>
      prev.map((r) =>
        r.sceneId === sceneId
          ? normalizeSceneResultRow({ ...r, approved: true, approvedAt: now, lastUpdatedAt: now })
          : r
      )
    );
  }, []);

  const deleteScene = useCallback(
    (sceneId) => {
      const row = sceneResults.find((r) => r.sceneId === sceneId);
      if (!row) return;
      const ok = window.confirm(
        `Eliminare solo questa scena dal progetto?\n\n«${row.title}»\n\nNon viene eliminato l'intero progetto né i master personaggio.`
      );
      if (!ok) return;
      setDeletedSceneIds((d) => (d.includes(sceneId) ? d : [...d, sceneId]));
      setSceneResults((prev) => prev.filter((r) => r.sceneId !== sceneId));
      setSelectedSceneIds((s) => s.filter((id) => id !== sceneId));
      setSceneCardFocusId((f) => (f === sceneId ? null : f));
      setHoveredSceneId((h) => (h === sceneId ? null : h));
      setModifyingSceneId((m) => {
        if (m === sceneId) {
          setModifyDraftPrompt("");
          return null;
        }
        return m;
      });
    },
    [sceneResults]
  );

  const startModifyScene = useCallback((sceneId) => {
    const row = sceneResults.find((r) => r.sceneId === sceneId);
    setModifyingSceneId(sceneId);
    setModifyDraftPrompt(row?.lastEditPrompt || "");
    setSceneCardFocusId(sceneId);
  }, [sceneResults]);

  const cancelModifyScene = useCallback(() => {
    setModifyingSceneId(null);
    setModifyDraftPrompt("");
  }, []);

  const confirmModifyScene = useCallback(async () => {
    const sid = modifyingSceneId;
    const draft = modifyDraftPrompt.trim();
    if (!plan || !sid || !draft) {
      setPlanError("Inserisci un prompt integrativo per modificare la scena.");
      return;
    }
    const row = sceneResults.find((r) => r.sceneId === sid);
    if (!row?.imageUrl) return;
    if (sceneEditBusyId || executing) return;

    const lockedStyle = projectStyle || buildProjectStyleFromPlan(plan, imageStylePresets);
    const globalStyleNote = composeGlobalVisualStyle(lockedStyle).slice(0, 900);

    setSceneEditBusyId(sid);
    setPlanError("");
    addLog(`Modifica scena (solo immagine, senza master): ${row.title}…`);
    try {
      const job = await editScenografiaSceneWithPrompt({
        sceneImageUrl: row.imageUrl,
        integrativePrompt: draft,
        globalVisualStyleNote: globalStyleNote,
        isAnimated: lockedStyle.isAnimated,
        onProgress: ({ message }) => {
          setImageStatus(message || "Modifica scena…");
        },
      });
      const now = new Date().toISOString();
      const hist = [...(row.editHistory || []), { prompt: draft, at: now }].slice(-8);
      setSceneResults((prev) =>
        prev.map((r) =>
          r.sceneId === sid
            ? normalizeSceneResultRow({
                ...r,
                imageUrl: job.outputImage,
                approved: false,
                approvedAt: null,
                lastEditPrompt: draft,
                editHistory: hist,
                lastUpdatedAt: now,
              })
            : r
        )
      );
      setModifyingSceneId(null);
      setModifyDraftPrompt("");
      addLog(`Modifica scena OK — ${row.title}`);
      if (onSave) {
        try {
          const dataUrl = await imageUrlToBase64(job.outputImage);
          const planScene = (plan.scenes || []).find((s) => s.id === sid);
          await onSave(dataUrl, planScene?.description || row.title, {
            projectImageMode: "scenografia",
            sceneId: sid,
            sceneTitle: row.title,
            type: "scenografia_scene_edit",
            editPrompt: draft,
            scenografiaProjectStyle: {
              presetId: lockedStyle.presetId,
              label: lockedStyle.label,
              plannerVisualNotes: lockedStyle.plannerVisualNotes,
              isAnimated: lockedStyle.isAnimated,
            },
          });
        } catch (e) {
          console.error("[SCENOGRAFIE] Save post-edit failed:", e);
        }
      }
    } catch (e) {
      addLog(`ERRORE modifica scena: ${e.message}`);
      setPlanError(e.message || "Modifica scena fallita.");
    } finally {
      setSceneEditBusyId(null);
      setImageStatus("");
    }
  }, [
    modifyingSceneId,
    modifyDraftPrompt,
    plan,
    sceneResults,
    projectStyle,
    imageStylePresets,
    sceneEditBusyId,
    executing,
    onSave,
    addLog,
    setImageStatus,
  ]);

  const rebuildSuggestedTimeline = useCallback(() => {
    setTimelinePlan({
      approved: false,
      approvedAt: null,
      entries: buildSuggestedTimelineEntries({ plan, sceneResults, deletedSceneIds, sceneVideoClips }),
    });
  }, [plan, sceneResults, deletedSceneIds, sceneVideoClips]);

  const confirmTimelineNarrative = useCallback(() => {
    setTimelinePlan((prev) =>
      prev.entries && prev.entries.length > 0
        ? { ...prev, approved: true, approvedAt: new Date().toISOString() }
        : prev
    );
  }, []);

  const unlockTimelineNarrative = useCallback(() => {
    setTimelinePlan((prev) => ({ ...prev, approved: false, approvedAt: null }));
  }, []);

  const moveTimelineEntry = useCallback((idx, dir) => {
    setTimelinePlan((prev) => {
      const entries = [...(prev.entries || [])];
      const j = idx + dir;
      if (j < 0 || j >= entries.length) return prev;
      const a = entries[idx];
      entries[idx] = entries[j];
      entries[j] = a;
      return { ...prev, entries, approved: false, approvedAt: null };
    });
  }, []);

  const setTimelineEntryDuration = useCallback((idx, raw) => {
    const n = raw === "" || raw == null ? null : Number(raw);
    setTimelinePlan((prev) => ({
      ...prev,
      approved: false,
      approvedAt: null,
      entries: prev.entries.map((e, i) =>
        i === idx ? { ...e, durationSec: n != null && Number.isFinite(n) && n >= 0 ? n : null } : e
      ),
    }));
  }, []);

  const onTimelineRowDragStart = (idx) => {
    dragTimelineIdxRef.current = idx;
  };

  const onTimelineRowDragEnd = () => {
    dragTimelineIdxRef.current = null;
  };

  const onTimelineRowDragOver = (e) => {
    e.preventDefault();
  };

  const onTimelineRowDrop = (targetIdx) => {
    const from = dragTimelineIdxRef.current;
    dragTimelineIdxRef.current = null;
    if (from == null || from === targetIdx) return;
    setTimelinePlan((prev) => {
      const entries = [...(prev.entries || [])];
      if (from < 0 || from >= entries.length) return prev;
      const [item] = entries.splice(from, 1);
      let ins = targetIdx;
      if (from < targetIdx) ins = targetIdx - 1;
      entries.splice(ins, 0, item);
      return { ...prev, entries, approved: false, approvedAt: null };
    });
  };

  const applyPresetChoice = useCallback(
    (presetId) => {
      if (!plan || projectStyleLocked || scenografiaPhase !== "plan") return;
      const p = imageStylePresets.find((x) => x.id === presetId);
      if (!p) return;
      setProjectStyle({
        presetId: p.id,
        label: p.label,
        stylePrompt: p.prompt,
        negativePrompt: p.negative_prompt || "",
        plannerVisualNotes:
          String(plan.visual_style || "").trim() ||
          `${p.label}, consistent look for the entire scenography project`,
        isAnimated: isAnimatedStyle([p.id]),
      });
    },
    [plan, projectStyleLocked, scenografiaPhase, imageStylePresets]
  );

  const allCharacterMastersApproved = useMemo(() => {
    if (!plan?.characters?.length) return false;
    const need = getCharactersNeedingMaster(plan);
    if (!need.length) return false;
    return need.every(
      (c) => characterApprovalMap[c.id]?.approved === true && !!masterImages[c.id]
    );
  }, [plan, characterApprovalMap, masterImages]);

  const gatePayload = useMemo(
    () => ({
      plan,
      characterApprovalMap,
      masterImages,
      sceneResults,
      deletedSceneIds,
      sceneVideoClips,
      timelinePlan,
    }),
    [plan, characterApprovalMap, masterImages, sceneResults, deletedSceneIds, sceneVideoClips, timelinePlan]
  );

  const approvedScenesForClips = useMemo(
    () => getApprovedActiveScenes({ plan, sceneResults, deletedSceneIds }),
    [plan, sceneResults, deletedSceneIds]
  );

  const projectUiStatus = useMemo(
    () =>
      deriveScenografiaUiStatus({
        plan,
        scenografiaPhase,
        characterApprovalMap,
        masterImages,
        sceneResults,
        deletedSceneIds,
        scenografiaVideoPhase,
        sceneVideoClips,
        finalMontagePhase,
        timelinePlan,
      }),
    [
      plan,
      scenografiaPhase,
      characterApprovalMap,
      masterImages,
      sceneResults,
      deletedSceneIds,
      scenografiaVideoPhase,
      sceneVideoClips,
      finalMontagePhase,
      timelinePlan,
    ]
  );

  const canOpenVideoProduction =
    allCharacterMastersApprovedForVideo(gatePayload) &&
    allActiveScenesApproved(gatePayload) &&
    scenografiaVideoPhase === "none" &&
    !executing &&
    !planning;

  const canStartFinalMontage =
    allCharacterMastersApprovedForVideo(gatePayload) &&
    allActiveScenesApproved(gatePayload) &&
    clipsReadyForFinalMontage(gatePayload) &&
    timelineNarrativeApproved(gatePayload) &&
    finalMontagePhase === "none" &&
    !executing &&
    !planning;

  const handleGoToVideoProduction = useCallback(async () => {
    if (!projectId || !canOpenVideoProduction) return;
    const base = persistSnapshotRef.current;
    if (!base) return;
    const payload = { ...base, scenografiaVideoPhase: "production" };
    const ok = await saveScenografiaProjectById(projectId, payload);
    if (ok) await upsertScenografiaProjectInIndex(projectId, payload);
    setScenografiaVideoPhase("production");
    onGoToVideoProduction?.({ projectId, plan: base.plan, sceneResults: base.sceneResults });
  }, [projectId, onGoToVideoProduction, canOpenVideoProduction]);

  const handleMarkVideoCompleted = useCallback(async () => {
    if (!projectId) return;
    const base = persistSnapshotRef.current;
    if (!base) return;
    const payload = { ...base, scenografiaVideoPhase: "completed" };
    await saveScenografiaProjectById(projectId, payload);
    await upsertScenografiaProjectInIndex(projectId, payload);
    setScenografiaVideoPhase("completed");
  }, [projectId]);

  const handleStartFinalMontage = useCallback(async () => {
    if (!projectId || !canStartFinalMontage) return;
    const base = persistSnapshotRef.current;
    if (!base) return;
    const fromTimeline = buildMontagePlanFromTimeline(base);
    const nextPlan = {
      ...(base.finalMontagePlan && typeof base.finalMontagePlan === "object" ? base.finalMontagePlan : {}),
      ...fromTimeline,
    };
    const payload = { ...base, finalMontagePhase: "assembly", finalMontagePlan: nextPlan };
    const ok = await saveScenografiaProjectById(projectId, payload);
    if (ok) await upsertScenografiaProjectInIndex(projectId, payload);
    setFinalMontagePhase("assembly");
    setFinalMontagePlan(nextPlan);
    addLog("Montaggio finale: ordine narrativo dalla timeline approvata registrato. Motore da integrare.");
  }, [projectId, canStartFinalMontage, addLog]);

  const handleMarkFinalMontageDone = useCallback(async () => {
    if (!projectId) return;
    const base = persistSnapshotRef.current;
    if (!base) return;
    const payload = { ...base, finalMontagePhase: "done" };
    await saveScenografiaProjectById(projectId, payload);
    await upsertScenografiaProjectInIndex(projectId, payload);
    setFinalMontagePhase("done");
    addLog("Montaggio finale segnato come completato.");
  }, [projectId, addLog]);

  const addSceneVideoClip = useCallback((sceneId) => {
    const now = new Date().toISOString();
    setSceneVideoClips((prev) => [
      ...prev,
      normalizeSceneVideoClip({
        id: newSceneVideoClipId(),
        sceneId,
        label: "",
        videoUrl: null,
        status: SCENE_VIDEO_CLIP_STATUS.DRAFT,
        sortOrder: prev.filter((c) => c.sceneId === sceneId).length,
        lastEditPrompt: null,
        editHistory: [],
        createdAt: now,
        updatedAt: now,
        includeInFinal: true,
      }),
    ]);
  }, []);

  const approveVideoClip = useCallback((clipId) => {
    const now = new Date().toISOString();
    setSceneVideoClips((prev) =>
      prev.map((c) =>
        c.id === clipId ? normalizeSceneVideoClip({ ...c, status: SCENE_VIDEO_CLIP_STATUS.APPROVED, updatedAt: now }) : c
      )
    );
  }, []);

  const markVideoClipDeleted = useCallback((clipId) => {
    const now = new Date().toISOString();
    setSceneVideoClips((prev) =>
      prev.map((c) =>
        c.id === clipId ? normalizeSceneVideoClip({ ...c, status: SCENE_VIDEO_CLIP_STATUS.DELETED, updatedAt: now }) : c
      )
    );
    setModifyingClipId((m) => (m === clipId ? null : m));
    setModifyClipDraft("");
  }, []);

  const regenerateVideoClip = useCallback((clipId) => {
    const now = new Date().toISOString();
    setSceneVideoClips((prev) =>
      prev.map((c) =>
        c.id === clipId
          ? normalizeSceneVideoClip({
              ...c,
              status: SCENE_VIDEO_CLIP_STATUS.DRAFT,
              videoUrl: null,
              updatedAt: now,
            })
          : c
      )
    );
    addLog("Clip in bozza: rigenerazione video da collegare al motore.");
  }, [addLog]);

  const startModifyVideoClip = useCallback(
    (clipId) => {
      const c = sceneVideoClips.find((x) => x.id === clipId);
      setModifyingClipId(clipId);
      setModifyClipDraft(c?.lastEditPrompt || "");
    },
    [sceneVideoClips]
  );

  const cancelModifyVideoClip = useCallback(() => {
    setModifyingClipId(null);
    setModifyClipDraft("");
  }, []);

  const confirmModifyVideoClip = useCallback(() => {
    const id = modifyingClipId;
    const draft = modifyClipDraft.trim();
    if (!id || !draft) return;
    const now = new Date().toISOString();
    setSceneVideoClips((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const hist = [...(c.editHistory || []), { prompt: draft, at: now }].slice(-12);
        return normalizeSceneVideoClip({
          ...c,
          status: SCENE_VIDEO_CLIP_STATUS.NEEDS_CHANGES,
          lastEditPrompt: draft,
          editHistory: hist,
          updatedAt: now,
        });
      })
    );
    setModifyingClipId(null);
    setModifyClipDraft("");
    addLog("Richiesta modifica clip registrata (motore video da integrare: movimento, camera, timing…).");
  }, [modifyingClipId, modifyClipDraft, addLog]);

  const runProtagonistMastersBatch = async () => {
    if (!plan || !projectStyle) {
      setPlanError("Definisci prima lo stile progetto (preset) dal piano.");
      return;
    }
    const lockedStyle = projectStyle || buildProjectStyleFromPlan(plan, imageStylePresets);
    const globalVisual = composeGlobalVisualStyle(lockedStyle);
    setProjectStyle(lockedStyle);
    setPlanError("");
    setScenografiaPhase("character_gen");
    setExecuting(true);
    abortRef.current = false;
    setExecutionLog([]);
    setImageProgress(0);
    const needMaster = getCharactersNeedingMaster(plan);
    try {
      let done = 0;
      const toGenerate = needMaster.filter((c) => !masterImagesRef.current[c.id]);
      const totalGen = Math.max(1, toGenerate.length);
      for (const char of needMaster) {
        if (abortRef.current) break;
        if (masterImagesRef.current[char.id]) continue;
        setBatchMasterCharId(char.id);
        done += 1;
        setImageStatus(`Master: ${char.name}…`);
        setImageProgress(Math.round(8 + (done / totalGen) * 40));
        try {
          const masterResult = await createMasterCharacter({
            appearance: {},
            outfit: char.appearance?.outfit || "",
            visualStyle: globalVisual,
            extraPrompt: char.appearance_prompt || "",
            aspectRatio: "9:16",
          });
          const out = masterResult.outputImage;
          setMasterImages((prev) => {
            const next = { ...prev, [char.id]: out };
            masterImagesRef.current = next;
            return next;
          });
          setMasterByCharName((prev) => ({
            ...prev,
            [normCharName(char.name)]: out,
          }));
          setCharacterApprovalMap((prev) => ({
            ...prev,
            [char.id]: { approved: false, approvedAt: null, version: (prev[char.id]?.version ?? 0) + 1 },
          }));
        } catch (err) {
          setExecutionLog((prev) => [
            ...prev,
            { time: new Date().toLocaleTimeString(), msg: `ERRORE master ${char.name}: ${err.message}` },
          ]);
        } finally {
          setBatchMasterCharId(null);
        }
      }
      setScenografiaPhase("character_approval");
    } finally {
      setExecuting(false);
      setBatchMasterCharId(null);
      setImageStatus("");
      setImageProgress(0);
    }
  };

  /** Prima generazione o rigenerazione: aggiorna preview, invalida approvazione, persiste via snapshot progetto. */
  const generateOrRegenerateCharacterMaster = async (charId) => {
    if (!plan || !projectStyle || pipelineLocked) return;
    if (executing) return;
    if (regeneratingCharId != null || batchMasterCharId != null) return;
    const char = plan.characters.find((c) => c.id === charId);
    if (!char) return;
    if (!getCharactersNeedingMaster(plan).some((c) => c.id === charId)) return;
    const lockedStyle = projectStyle || buildProjectStyleFromPlan(plan, imageStylePresets);
    const globalVisual = composeGlobalVisualStyle(lockedStyle);
    setPlanError("");
    setRegeneratingCharId(charId);
    setCharacterApprovalMap((prev) => ({
      ...prev,
      [charId]: { approved: false, approvedAt: null, version: (prev[charId]?.version ?? 0) + 1 },
    }));
    try {
      const masterResult = await createMasterCharacter({
        appearance: {},
        outfit: char.appearance?.outfit || "",
        visualStyle: globalVisual,
        extraPrompt: char.appearance_prompt || "",
        aspectRatio: "9:16",
      });
      const out = masterResult.outputImage;
      setMasterImages((prev) => {
        const next = { ...prev, [char.id]: out };
        masterImagesRef.current = next;
        return next;
      });
      setMasterByCharName((prev) => ({
        ...prev,
        [normCharName(char.name)]: out,
      }));
    } catch (err) {
      setPlanError(err.message || `Generazione master fallita per ${char.name}`);
    } finally {
      setRegeneratingCharId(null);
    }
  };

  const approveProtagonistMaster = (charId) => {
    if (!masterImages[charId]) return;
    setCharacterApprovalMap((prev) => ({
      ...prev,
      [charId]: {
        approved: true,
        approvedAt: new Date().toISOString(),
        version: prev[charId]?.version ?? 1,
      },
    }));
  };

  const shortDescription = useMemo(() => deriveShortDescription(plan, prompt), [plan, prompt]);
  const titlePlaceholder = useMemo(() => fallbackProjectTitlePlaceholder(plan, prompt), [plan, prompt]);
  const scenesInPlanHeader = useMemo(() => {
    if (!plan?.scenes?.length) return 0;
    const del = new Set(deletedSceneIds || []);
    return plan.scenes.filter((s) => !del.has(s.id)).length;
  }, [plan, deletedSceneIds]);

  const pipelineLocked =
    finalMontagePhase === "assembly" ||
    finalMontagePhase === "done" ||
    scenografiaVideoPhase === "completed";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "0 24px 24px" }}>
      {/* ── Header dettaglio progetto ── */}
      <div
        style={{
          marginBottom: 20,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          paddingBottom: 16,
          borderBottom: `1px solid ${AX.border}`,
        }}
      >
        <div style={{ flex: "1 1 280px", minWidth: 0, maxWidth: "min(100%, 560px)" }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: AX.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            Nome progetto
          </div>
          <input
            type="text"
            value={projectTitle}
            onChange={(e) => setProjectTitle(e.target.value)}
            placeholder={titlePlaceholder}
            disabled={pipelineLocked}
            aria-label="Nome progetto scenografico"
            style={{
              width: "100%",
              maxWidth: 480,
              boxSizing: "border-box",
              padding: "9px 12px",
              borderRadius: 10,
              border: `1px solid ${AX.border}`,
              background: AX.surface,
              color: AX.text,
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              outline: "none",
              opacity: pipelineLocked ? 0.65 : 1,
            }}
          />
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, rowGap: 6 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: AX.electric,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "3px 8px",
                borderRadius: 6,
                background: "rgba(41,182,255,0.1)",
                border: `1px solid rgba(41,182,255,0.25)`,
              }}
            >
              Progetto #{projectNumber}
            </span>
            <span style={{ fontSize: 11, color: AX.text2, fontWeight: 600 }}>{scenesInPlanHeader} scene in piano</span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "3px 8px",
                borderRadius: 999,
                background: "rgba(123,77,255,0.12)",
                color: AX.violet,
                border: `1px solid rgba(123,77,255,0.28)`,
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={SCENOGRAFIA_UI_STATUS_LABEL[projectUiStatus] || projectUiStatus}
            >
              {SCENOGRAFIA_UI_STATUS_LABEL[projectUiStatus] || projectUiStatus}
            </span>
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: AX.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 12, marginBottom: 4 }}>
            Descrizione breve
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: shortDescription ? AX.text2 : AX.muted,
              lineHeight: 1.45,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              fontStyle: shortDescription ? "normal" : "italic",
            }}
          >
            {shortDescription || "Deriva dal prompt narrativo o dal riassunto del piano dopo «Analizza prompt»."}
          </p>
          {typeof window !== "undefined" && window.electronAPI?.saveJson && (
            <div style={{ marginTop: 8, fontSize: 9, color: AX.muted, wordBreak: "break-all", opacity: 0.85 }}>
              {scenografiaProjectFilePath(projectId)}
            </div>
          )}
        </div>
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              disabled={!canOpenVideoProduction}
              title={
                canOpenVideoProduction
                  ? "Apri la sezione video libera dopo approvazione character e scene."
                  : "Serve master e scene approvati."
              }
              onClick={() => void handleGoToVideoProduction()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "7px 12px",
                borderRadius: 10,
                border: "none",
                background: canOpenVideoProduction ? AX.gradPrimary : AX.border,
                color: "#fff",
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: "0.02em",
                cursor: canOpenVideoProduction ? "pointer" : "not-allowed",
                opacity: canOpenVideoProduction ? 1 : 0.55,
                boxShadow: canOpenVideoProduction ? "0 2px 14px rgba(41,182,255,0.22)" : "none",
                whiteSpace: "nowrap",
              }}
            >
              <HiVideoCamera size={15} style={{ flexShrink: 0 }} />
              Produzione video
            </button>
            <button
              type="button"
              disabled={!canStartFinalMontage}
              title={
                canStartFinalMontage
                  ? "Avvia struttura montaggio finale (timeline confermata)."
                  : "Completa clip e conferma la timeline narrativa."
              }
              onClick={() => void handleStartFinalMontage()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "7px 12px",
                borderRadius: 10,
                border: canStartFinalMontage ? "1px solid rgba(123,77,255,0.5)" : `1px solid ${AX.border}`,
                background: canStartFinalMontage ? "linear-gradient(145deg, rgba(41,182,255,0.12), rgba(123,77,255,0.16))" : AX.surface,
                color: AX.text,
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: "0.02em",
                cursor: canStartFinalMontage ? "pointer" : "not-allowed",
                opacity: canStartFinalMontage ? 1 : 0.55,
                whiteSpace: "nowrap",
              }}
            >
              <HiFilm size={15} style={{ flexShrink: 0, color: canStartFinalMontage ? AX.electric : AX.muted }} />
              Filmato finale
            </button>
          </div>
          {scenografiaVideoPhase === "production" && (
            <button
              type="button"
              onClick={() => void handleMarkVideoCompleted()}
              disabled={executing}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid ${AX.border}`,
                background: AX.surface,
                color: AX.text2,
                fontWeight: 600,
                fontSize: 11,
                cursor: executing ? "not-allowed" : "pointer",
              }}
            >
              Video libero: completato
            </button>
          )}
          {finalMontagePhase === "assembly" && (
            <button
              type="button"
              onClick={() => void handleMarkFinalMontageDone()}
              disabled={executing}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid ${AX.electric}`,
                background: AX.surface,
                color: AX.electric,
                fontWeight: 700,
                fontSize: 11,
                cursor: executing ? "not-allowed" : "pointer",
              }}
            >
              Montaggio: completato
            </button>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: AX.text2, margin: 0, lineHeight: 1.55 }}>
          Fasi: (1) character → (2) scene → (3) clip → (4) timeline narrativa → (5) montaggio finale. Modificabile finché non avvii la{" "}
          <strong style={{ color: AX.text }}>produzione del filmato finale</strong> (dopo conferma timeline). Salvataggio automatico per progetto.
        </p>
      </div>

      {pipelineLocked && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            borderRadius: 10,
            border: `1px solid rgba(41,182,255,0.35)`,
            background: "rgba(41,182,255,0.08)",
            fontSize: 12,
            color: AX.text2,
            fontWeight: 600,
          }}
        >
          {finalMontagePhase === "assembly"
            ? "Montaggio filmato finale in corso: modifica a character, scene e clip disabilitata. Il motore di auto-montaggio verrà collegato a questa fase."
            : finalMontagePhase === "done" || scenografiaVideoPhase === "completed"
              ? "Progetto completato: modifica disabilitata."
              : "Modifica disabilitata."}
        </div>
      )}

      {persistReady &&
        (plan || sceneResults.length > 0 || Object.keys(masterImages).length > 0 || Object.keys(masterByCharName).length > 0) && (
          <div
            style={{
              marginBottom: 14,
              padding: "12px 14px",
              borderRadius: 12,
              background: "rgba(41,182,255,0.08)",
              border: `1px solid rgba(41,182,255,0.25)`,
              fontSize: 12,
              color: AX.text2,
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: AX.electric }}>Progetto scenografico attivo</strong>
            {" — "}
            master, scene generate, piano e stile restano finché non scegli «Nuovo progetto / Scarta tutto».
            {lastSavedAt && (
              <span style={{ display: "block", marginTop: 6, fontSize: 11, color: AX.muted }}>
                Ultimo salvataggio locale: {new Date(lastSavedAt).toLocaleString()}
              </span>
            )}
          </div>
        )}

      {projectStyle &&
        (executing ||
          sceneResults.length > 0 ||
          projectStyleLocked ||
          !(plan && sceneResults.length === 0 && !executing)) && (
        <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 12, background: AX.card, border: `1px solid ${AX.border}` }}>
          <div style={{ fontSize: 10, color: AX.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Stile progetto (unico)</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: AX.text, marginTop: 4 }}>{projectStyle.label}</div>
          <div style={{ fontSize: 12, color: AX.text2, marginTop: 6, lineHeight: 1.45 }}>{projectStyle.plannerVisualNotes}</div>
          {projectStyleLocked && (
            <div style={{ fontSize: 11, color: AX.electric, marginTop: 8, fontWeight: 600 }}>
              Stile bloccato dopo l&apos;ultima generazione. «Nuovo progetto / Scarta tutto» azzera tutto; «Estendi piano» o «Solo scene mancanti» aggiungono lavoro senza rifare i master.
            </div>
          )}
        </div>
      )}

      {/* ── Prompt input ── */}
      <div style={{ marginBottom: 16 }}>
        <textarea
          ref={promptTextareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Descrivi la scena, la storia, i personaggi e l'ambientazione in italiano…"
          disabled={planning || executing || pipelineLocked}
          style={{
            width: "100%",
            minHeight: PROMPT_TEXTAREA_MIN_PX,
            maxHeight: PROMPT_TEXTAREA_MAX_PX,
            padding: "16px 18px",
            borderRadius: 12,
            border: `1px solid ${AX.border}`,
            background: AX.surface,
            color: AX.text,
            fontSize: 15,
            lineHeight: 1.62,
            fontFamily: "inherit",
            resize: "vertical",
            boxSizing: "border-box",
            outline: "none",
            transition: "border-color 0.15s ease, box-shadow 0.15s ease",
          }}
          onFocus={(e) => {
            e.target.style.borderColor = AX.electric;
            e.target.style.boxShadow = `0 0 0 1px ${AX.electric}40`;
          }}
          onBlur={(e) => {
            e.target.style.borderColor = AX.border;
            e.target.style.boxShadow = "none";
          }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10, alignItems: "center" }}>
          <button
            type="button"
            onClick={() => handlePlan(false)}
            disabled={!prompt.trim() || planning || executing || pipelineLocked}
            style={{
              padding: "10px 20px", borderRadius: 10, border: "none",
              background: AX.gradPrimary, color: "#fff", fontWeight: 700,
              fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
              opacity: (!prompt.trim() || planning || executing || pipelineLocked) ? 0.5 : 1,
            }}
          >
            {planning ? (
              <><div style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /> Analisi in corso…</>
            ) : (
              <><HiSparkles size={16} /> Analizza Prompt</>
            )}
          </button>
          {(Object.keys(masterByCharName).length > 0 || Object.keys(masterImages).length > 0) && (
            <button
              type="button"
              onClick={() => handlePlan(true)}
              disabled={!prompt.trim() || planning || executing || pipelineLocked}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: `1px solid ${AX.electric}`,
                background: "transparent",
                color: AX.electric,
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
                opacity: (!prompt.trim() || planning || executing || pipelineLocked) ? 0.45 : 1,
              }}
              title="Nuovo piano da zero (testo aggiornato) ma stessi volti se i nomi coincidono; le scene già generate vengono azzerate finché non rigeneri."
            >
              <HiUser size={15} style={{ verticalAlign: "middle", marginRight: 6 }} />
              Rigenera piano (mantieni personaggi)
            </button>
          )}
          {plan && (
            <button
              type="button"
              onClick={handlePlanContinue}
              disabled={!prompt.trim() || planning || executing || pipelineLocked}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: `1px solid ${AX.violet}`,
                background: "transparent",
                color: AX.violet,
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
                opacity: (!prompt.trim() || planning || executing || pipelineLocked) ? 0.45 : 1,
              }}
              title="Aggiunge scene o sviluppi al piano esistente via LLM; conserva scene già ok, master e stile bloccato."
            >
              <HiPlus size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />
              Estendi piano (nuove scene)
            </button>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: AX.text2, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={enableRepair}
              onChange={(e) => setEnableRepair(e.target.checked)}
              style={{ accentColor: AX.electric }}
            />
            Repair pass (rifinitura)
          </label>
        </div>
        {planError && (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", fontSize: 13 }}>
            {planError}
          </div>
        )}
      </div>

      {/* ── Plan review (resta visibile durante generazione master o scene) ── */}
      {plan && (!executing || scenografiaPhase === "character_gen" || scenografiaPhase === "scene_gen") && (
        <div style={{ marginBottom: 20, padding: 16, borderRadius: 14, background: AX.card, border: `1px solid ${AX.border}` }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: AX.text, margin: 0 }}>Piano di produzione</h3>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              {[
                { id: "plan", label: "1 · Piano" },
                { id: "char", label: "2 · Personaggi" },
                { id: "scene", label: "3 · Scene" },
              ].map((s) => {
                const active =
                  (s.id === "plan" && scenografiaPhase === "plan") ||
                  (s.id === "char" && ["character_gen", "character_approval"].includes(scenografiaPhase)) ||
                  (s.id === "scene" && ["scene_gen", "complete"].includes(scenografiaPhase));
                return (
                  <div
                    key={s.id}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      border: `1px solid ${active ? AX.electric : AX.border}`,
                      background: active ? "rgba(41,182,255,0.12)" : AX.surface,
                      color: active ? AX.electric : AX.muted,
                    }}
                  >
                    {s.label}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                onClick={openNewProjectConfirm}
                disabled={pipelineLocked}
                style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid rgba(239,68,68,0.45)`, background: "transparent", color: "#f87171", fontSize: 12, cursor: pipelineLocked ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 4, opacity: pipelineLocked ? 0.45 : 1 }}
                title="Rimuovi questo progetto dalla griglia e dal disco"
              >
                <HiXMark size={14} /> Elimina progetto
              </button>
              <button
                type="button"
                onClick={resetPlanKeepMasters}
                disabled={pipelineLocked}
                style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${AX.border}`, background: AX.surface, color: AX.text2, fontSize: 12, cursor: pipelineLocked ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 4, opacity: pipelineLocked ? 0.45 : 1 }}
                title="Solo piano e scene: i master restano salvati"
              >
                <HiXMark size={14} /> Scarta solo piano
              </button>
              <button
                type="button"
                onClick={() => handlePlan(false)}
                disabled={!prompt.trim() || planning || pipelineLocked}
                style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${AX.border}`, background: "transparent", color: AX.text2, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, opacity: !prompt.trim() || planning || pipelineLocked ? 0.45 : 1 }}
                title="Nuova analisi LLM e nuovi master al prossimo genera"
              >
                <HiArrowPath size={14} /> Rigenera piano
              </button>
              {(Object.keys(masterByCharName).length > 0 || Object.keys(masterImages).length > 0) && (
                <button
                  type="button"
                  onClick={() => handlePlan(true)}
                  disabled={!prompt.trim() || planning || pipelineLocked}
                  style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${AX.electric}`, background: "transparent", color: AX.electric, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, opacity: !prompt.trim() || planning || pipelineLocked ? 0.45 : 1 }}
                  title="Nuovo piano da prompt; riallinea i master per nome senza rigenerarli se possibile"
                >
                  <HiUser size={14} /> Rigenera piano (mantieni personaggi)
                </button>
              )}
              <button
                type="button"
                onClick={handlePlanContinue}
                disabled={!prompt.trim() || planning || pipelineLocked}
                style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${AX.violet}`, background: "transparent", color: AX.violet, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, opacity: !prompt.trim() || planning || pipelineLocked ? 0.45 : 1 }}
                title="Aggiunge scene o sviluppi al piano corrente; non cancella le scene già generate se restano nel piano"
              >
                <HiPlus size={14} /> Estendi piano (nuove scene)
              </button>
              {(Object.keys(masterImages).length > 0 || Object.keys(masterByCharName).length > 0) && (
                <>
                  <button
                    type="button"
                    onClick={runMissingScenesOnly}
                    disabled={executing || planning || !allCharacterMastersApproved || pipelineLocked}
                    style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${AX.electric}`, background: "transparent", color: AX.electric, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                    title="Genera solo le scene del piano che non hanno ancora un&apos;immagine"
                  >
                    <HiPlus size={14} /> Solo scene mancanti
                  </button>
                  <button
                    type="button"
                    onClick={runSelectedScenesOnly}
                    disabled={executing || planning || selectedSceneIds.length === 0 || !allCharacterMastersApproved || pipelineLocked}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: `1px solid ${AX.magenta}`,
                      background: "transparent",
                      color: AX.magenta,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: selectedSceneIds.length === 0 ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      opacity: selectedSceneIds.length === 0 ? 0.45 : 1,
                    }}
                    title="Rigenera le scene spuntate nell&apos;elenco"
                  >
                    <HiArrowPath size={14} /> Rigenera scene selezionate
                  </button>
                  <button
                    type="button"
                    onClick={regenerateScenesOnly}
                    disabled={executing || planning || !allCharacterMastersApproved || pipelineLocked}
                    style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${AX.violet}`, background: "transparent", color: AX.violet, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                    title="Rifà tutte le scene del piano con gli stessi master"
                  >
                    <HiPhoto size={14} /> Rigenera tutte le scene
                  </button>
                </>
              )}
              {scenografiaPhase === "plan" && projectStyle && (
                <button
                  type="button"
                  onClick={runProtagonistMastersBatch}
                  disabled={executing || planning || pipelineLocked}
                  style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: AX.gradPrimary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, opacity: executing || planning || pipelineLocked ? 0.55 : 1 }}
                >
                  <HiUser size={14} /> Genera tutti i master mancanti
                </button>
              )}
              {allCharacterMastersApproved &&
                (scenografiaPhase === "character_approval" ||
                  (scenografiaPhase === "complete" && sceneResults.length === 0)) && (
                <button
                  type="button"
                  onClick={() => {
                    sceneExecuteModeRef.current = "ALL";
                    reuseMastersRef.current = false;
                    void handleExecute();
                  }}
                  disabled={executing || planning || pipelineLocked}
                  style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: AX.gradPrimary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, opacity: executing || planning || pipelineLocked ? 0.55 : 1 }}
                >
                  <HiCheck size={14} /> Genera scene
                </button>
              )}
            </div>
            {sceneResults.length > 0 && (
              <div style={{ fontSize: 11, color: AX.muted, lineHeight: 1.45 }}>
                Scene già salvate nel progetto: usa «Solo scene mancanti», «Rigenera scene selezionate» (spunta le righe sotto) o «Rigenera tutte le scene».
              </div>
            )}
            {scenografiaPhase === "character_approval" && !allCharacterMastersApproved && (
              <div style={{ fontSize: 12, color: AX.magenta, fontWeight: 600, marginTop: 8 }}>
                Approva ogni personaggio con master (pulsante «Approva personaggio») prima di passare alle scene.
              </div>
            )}
          </div>

          {plan.summary_it && (
            <p style={{ fontSize: 13, color: AX.text2, marginBottom: 14, lineHeight: 1.5 }}>{plan.summary_it}</p>
          )}

          {/* Characters */}
          <div style={{ marginBottom: 14 }}>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: AX.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
              Personaggi ({plan.characters.length})
            </h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {plan.characters.map((char) => {
                const roleLab = characterRoleLabelIt(char);
                const borderColor =
                  char.character_role === CHARACTER_ROLE.PROTAGONIST || char.is_protagonist
                    ? AX.electric
                    : char.character_role === CHARACTER_ROLE.RECURRING
                      ? AX.violet
                      : AX.border;
                return (
                <div key={char.id} style={{ padding: "8px 12px", borderRadius: 10, background: AX.surface, border: `1px solid ${borderColor}`, fontSize: 12 }}>
                  <div style={{ fontWeight: 600, color: AX.text, marginBottom: 2 }}>
                    <HiUser size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
                    {char.name}
                    {roleLab && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: char.character_role === CHARACTER_ROLE.RECURRING ? AX.violet : AX.electric }}>
                        ({roleLab.toLowerCase()})
                      </span>
                    )}
                  </div>
                  <div style={{ color: AX.text2, fontSize: 11 }}>{char.appearance_prompt?.slice(0, 80) || "—"}…</div>
                </div>
              );
              })}
            </div>
          </div>

          {/* Scenes */}
          <div>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: AX.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
              Scene ({plan.scenes.length}) — spunta per rigenerazione mirata
            </h4>
            {plan.scenes.map((scene, i) => (
              <div key={scene.id} style={{ padding: "8px 12px", borderRadius: 10, background: AX.surface, border: `1px solid ${AX.border}`, marginBottom: 6, fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: AX.text, marginBottom: 2, display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={selectedSceneIds.includes(scene.id)}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setSelectedSceneIds((prev) =>
                        on ? [...prev, scene.id] : prev.filter((x) => x !== scene.id)
                      );
                    }}
                    style={{ accentColor: AX.magenta, flexShrink: 0 }}
                    aria-label={`Seleziona scena ${scene.title_it}`}
                  />
                  <HiPhoto size={12} style={{ flexShrink: 0 }} />
                  <span>
                    {i + 1}. {scene.title_it}
                  </span>
                </div>
                <div style={{ color: AX.text2, fontSize: 11 }}>{scene.description?.slice(0, 120)}…</div>
                {scene.lighting && <div style={{ color: AX.muted, fontSize: 10, marginTop: 2 }}>Luce: {scene.lighting}</div>}
              </div>
            ))}
          </div>

          {/* Stile progetto: preset unico (allineato al piano LLM, modificabile prima di Approva) */}
          {projectStyle && imageStylePresets.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${AX.border}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: AX.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                Stile progetto — sorgente unica per master, scene, identity lock e repair
              </div>
              <div style={{ fontSize: 13, color: AX.text, marginBottom: 8 }}>
                Preset: <strong style={{ color: AX.electric }}>{projectStyle.label}</strong>
                {projectStyle.isAnimated && <span style={{ marginLeft: 8, fontSize: 11, color: AX.magenta }}>(output animato / stilizzato)</span>}
              </div>
              <label style={{ fontSize: 11, color: AX.text2, display: "block", marginBottom: 6 }}>
                Cambia preset (solo in fase Piano, prima dei master)
              </label>
              <select
                value={projectStyle.presetId}
                disabled={projectStyleLocked || executing || scenografiaPhase !== "plan" || pipelineLocked}
                onChange={(e) => applyPresetChoice(e.target.value)}
                style={{
                  width: "100%",
                  maxWidth: 420,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${AX.border}`,
                  background: AX.surface,
                  color: AX.text,
                  fontSize: 13,
                  cursor: projectStyleLocked || executing || scenografiaPhase !== "plan" || pipelineLocked ? "not-allowed" : "pointer",
                }}
              >
                {imageStylePresets.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <p style={{ fontSize: 11, color: AX.muted, marginTop: 8, lineHeight: 1.4 }}>
                Note dal planner (coerenti con il preset): lo stile non va mescolato tra scene diverse: una sola direzione artistica per tutto il progetto.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Execution progress ── */}
      {(executing || executionLog.length > 0) && (
        <div style={{ marginBottom: 16 }}>
          {executing && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 16, height: 16, border: "2px solid rgba(41,182,255,0.3)", borderTopColor: AX.electric, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <span style={{ fontSize: 13, color: AX.electric, fontWeight: 600 }}>
                {imageStatus || "Elaborazione…"}
              </span>
              {imageProgress > 0 && imageProgress < 100 && (
                <span style={{ fontSize: 12, color: AX.text2 }}>{imageProgress}%</span>
              )}
              <button onClick={handleAbort} style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 6, border: `1px solid rgba(239,68,68,0.4)`, background: "transparent", color: "#ef4444", fontSize: 11, cursor: "pointer" }}>
                Interrompi
              </button>
            </div>
          )}
          <div style={{ maxHeight: 200, overflowY: "auto", padding: 10, borderRadius: 10, background: AX.surface, border: `1px solid ${AX.border}`, fontSize: 11, fontFamily: "monospace", lineHeight: 1.7 }}>
            {executionLog.map((entry, i) => (
              <div key={i} style={{ color: entry.msg.startsWith("ERRORE") ? "#ef4444" : AX.text2 }}>
                <span style={{ color: AX.muted }}>{entry.time}</span>{" "}
                {entry.msg}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 2: master per protagonisti e personaggi ricorrenti ── */}
      {plan &&
        ["character_gen", "character_approval", "complete"].includes(scenografiaPhase) &&
        getCharactersNeedingMaster(plan).length > 0 && (
          <div style={{ marginBottom: 20, padding: 16, borderRadius: 14, background: AX.card, border: `1px solid ${AX.border}` }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: AX.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Sezione character</div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: AX.text, margin: "0 0 6px" }}>Master personaggio (protagonisti e ricorrenti)</h3>
            <p style={{ fontSize: 12, color: AX.text2, marginBottom: 16, lineHeight: 1.45 }}>
              Un master per ogni personaggio narrativo principale o ricorrente. Su ogni card usa «Genera personaggio» se manca il volto, poi «Approva personaggio»; con master già presente usa «Rigenera personaggio» per una nuova versione (l’approvazione torna in sospeso).
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 16,
              }}
            >
              {getCharactersNeedingMaster(plan).map((char) => {
                const url = masterImages[char.id];
                const ap = characterApprovalMap[char.id];
                const approved = ap?.approved === true;
                const scenePipeline = executing && scenografiaPhase === "scene_gen";
                const masterInFlight =
                  regeneratingCharId === char.id ||
                  (executing && scenografiaPhase === "character_gen" && batchMasterCharId === char.id);
                const busy = masterInFlight || scenePipeline;
                const hasMaster = !!url;
                return (
                  <div
                    key={char.id}
                    style={{
                      borderRadius: 14,
                      overflow: "hidden",
                      border: `1px solid ${approved ? AX.electric : AX.border}`,
                      background: AX.surface,
                    }}
                  >
                    <div style={{ aspectRatio: "9/16", maxHeight: 360, background: AX.bg, position: "relative" }}>
                      {hasMaster ? (
                        <img src={url} alt={char.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      ) : (
                        <div
                          style={{
                            height: "100%",
                            minHeight: 200,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 10,
                            padding: 20,
                            textAlign: "center",
                            color: AX.muted,
                            fontSize: 13,
                            lineHeight: 1.45,
                          }}
                        >
                          <HiUser size={32} style={{ opacity: 0.45 }} />
                          <span>Nessun master ancora.</span>
                          <span style={{ fontSize: 12, color: AX.text2 }}>Usa «Genera personaggio» qui sotto (o «Genera master personaggi» in alto per tutti i mancanti).</span>
                        </div>
                      )}
                      {busy && (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            background: "rgba(0,0,0,0.45)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: AX.text,
                            fontSize: 13,
                            fontWeight: 600,
                          }}
                        >
                          Aggiornamento…
                        </div>
                      )}
                    </div>
                    <div style={{ padding: "12px 14px 14px" }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: AX.text, marginBottom: 6 }}>
                        {char.name}
                        {characterRoleLabelIt(char) && (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 11,
                              fontWeight: 600,
                              color:
                                char.character_role === CHARACTER_ROLE.RECURRING ? AX.violet : AX.electric,
                            }}
                          >
                            · {characterRoleLabelIt(char)}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: AX.muted, marginBottom: 10 }}>
                        {approved ? (
                          <span style={{ color: AX.electric, fontWeight: 700 }}>
                            Approvato
                            {ap?.approvedAt && ` · ${new Date(ap.approvedAt).toLocaleString()}`}
                            {typeof ap?.version === "number" && ` · v${ap.version}`}
                          </span>
                        ) : hasMaster ? (
                          <span>In attesa di approvazione</span>
                        ) : (
                          <span>Genera il master per sbloccare l’approvazione</span>
                        )}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {!hasMaster ? (
                          <button
                            type="button"
                            onClick={() => void generateOrRegenerateCharacterMaster(char.id)}
                            disabled={busy || pipelineLocked}
                            style={{
                              flex: 1,
                              minWidth: 140,
                              padding: "9px 14px",
                              borderRadius: 10,
                              border: "none",
                              background: busy || pipelineLocked ? AX.border : AX.gradPrimary,
                              color: "#fff",
                              fontWeight: 700,
                              fontSize: 12,
                              letterSpacing: "0.02em",
                              cursor: busy || pipelineLocked ? "not-allowed" : "pointer",
                              opacity: busy || pipelineLocked ? 0.55 : 1,
                              boxShadow: busy || pipelineLocked ? "none" : "0 4px 18px rgba(41,182,255,0.25)",
                            }}
                          >
                            <HiSparkles size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                            Genera personaggio
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void generateOrRegenerateCharacterMaster(char.id)}
                            disabled={busy || pipelineLocked}
                            style={{
                              flex: 1,
                              minWidth: 120,
                              padding: "8px 12px",
                              borderRadius: 10,
                              border: `1px solid ${AX.violet}`,
                              background: "transparent",
                              color: AX.violet,
                              fontWeight: 700,
                              fontSize: 12,
                              cursor: busy || pipelineLocked ? "not-allowed" : "pointer",
                              opacity: busy || pipelineLocked ? 0.45 : 1,
                            }}
                          >
                            <HiArrowPath size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                            Rigenera personaggio
                          </button>
                        )}
                        <button
                          type="button"
                          disabled
                          title="Funzione in arrivo"
                          style={{
                            flex: 1,
                            minWidth: 100,
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: `1px solid ${AX.border}`,
                            background: AX.surface,
                            color: AX.muted,
                            fontWeight: 600,
                            fontSize: 12,
                            cursor: "not-allowed",
                            opacity: 0.55,
                          }}
                        >
                          Modifica
                        </button>
                        <button
                          type="button"
                          onClick={() => approveProtagonistMaster(char.id)}
                          disabled={!hasMaster || approved || busy || pipelineLocked}
                          style={{
                            flex: 1,
                            minWidth: 120,
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "none",
                            background: approved ? AX.border : AX.gradPrimary,
                            color: approved ? AX.muted : "#fff",
                            fontWeight: 700,
                            fontSize: 12,
                            cursor: !hasMaster || approved || busy || pipelineLocked ? "not-allowed" : "pointer",
                            opacity: !hasMaster || approved || busy || pipelineLocked ? 0.55 : 1,
                          }}
                        >
                          <HiCheck size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                          Approva personaggio
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      {/* ── Scene results gallery ── */}
      {sceneResults.length > 0 && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: AX.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Sezione scene</div>
          <h4 style={{ fontSize: 12, fontWeight: 700, color: AX.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Scene generate ({sceneResults.length})
          </h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {sceneResults.map((r) => {
              const sceneBusy = sceneEditBusyId === r.sceneId;
              const pipelineBusy = executing || !!sceneEditBusyId || pipelineLocked;
              const sceneBarOpen =
                hoveredSceneId === r.sceneId ||
                sceneCardFocusId === r.sceneId ||
                selectedSceneIds.includes(r.sceneId) ||
                modifyingSceneId === r.sceneId;
              const btnBase = {
                padding: "6px 10px",
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 700,
                cursor: pipelineBusy ? "not-allowed" : "pointer",
                opacity: pipelineBusy ? 0.5 : 1,
                border: "none",
                flex: "1 1 auto",
                minWidth: 0,
              };
              return (
                <div
                  key={r.sceneId}
                  role="group"
                  aria-label={`Scena ${r.title}`}
                  style={{
                    borderRadius: 12,
                    overflow: "hidden",
                    border: `1px solid ${AX.border}`,
                    background: AX.card,
                    outline: sceneCardFocusId === r.sceneId ? `2px solid ${AX.electric}` : "none",
                    outlineOffset: 0,
                  }}
                  onMouseEnter={() => setHoveredSceneId(r.sceneId)}
                  onMouseLeave={() => setHoveredSceneId((h) => (h === r.sceneId ? null : h))}
                  onClick={() => setSceneCardFocusId(r.sceneId)}
                >
                  <div style={{ position: "relative", width: "100%" }}>
                    <img src={r.imageUrl} alt={r.title} style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block" }} />
                    {r.approved && (
                      <div
                        style={{
                          position: "absolute",
                          top: 8,
                          left: 8,
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "4px 8px",
                          borderRadius: 8,
                          background: "rgba(16,120,72,0.92)",
                          color: "#fff",
                          fontSize: 10,
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        <HiCheck size={12} />
                        Approvata
                      </div>
                    )}
                    {sceneBusy && (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "rgba(6,6,12,0.55)",
                          color: "#fff",
                          fontSize: 13,
                          fontWeight: 700,
                        }}
                      >
                        Modifica in corso…
                      </div>
                    )}
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        padding: "10px 8px",
                        background: "linear-gradient(transparent, rgba(0,0,0,0.88))",
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                        justifyContent: "center",
                        opacity: sceneBarOpen ? 1 : 0,
                        pointerEvents: sceneBarOpen ? "auto" : "none",
                        transition: "opacity 0.16s ease",
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={pipelineBusy || r.approved}
                        onClick={() => approveScene(r.sceneId)}
                        style={{
                          ...btnBase,
                          background: r.approved ? AX.border : "rgba(41,182,255,0.95)",
                          color: "#fff",
                        }}
                      >
                        Approva
                      </button>
                      <button
                        type="button"
                        disabled={pipelineBusy}
                        onClick={() => startModifyScene(r.sceneId)}
                        style={{ ...btnBase, background: "rgba(123,77,255,0.95)", color: "#fff" }}
                      >
                        Modifica
                      </button>
                      <button
                        type="button"
                        disabled={pipelineBusy}
                        onClick={() => deleteScene(r.sceneId)}
                        style={{ ...btnBase, background: "rgba(180,40,60,0.95)", color: "#fff" }}
                      >
                        Elimina
                      </button>
                      <button
                        type="button"
                        disabled={pipelineBusy || !allCharacterMastersApproved}
                        onClick={() => regenerateSingleScene(r.sceneId)}
                        style={{ ...btnBase, background: "rgba(255,159,28,0.95)", color: "#111" }}
                        title="Rigenera solo questa scena (master già approvati)"
                      >
                        Rigenera
                      </button>
                    </div>
                  </div>
                  {modifyingSceneId === r.sceneId && (
                    <div
                      style={{ padding: 10, borderTop: `1px solid ${AX.border}`, background: AX.surface }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, color: AX.text2, marginBottom: 6 }}>
                        Prompt integrativo (solo la modifica richiesta; stile e identità restano quelli del progetto)
                      </div>
                      <textarea
                        value={modifyDraftPrompt}
                        onChange={(e) => setModifyDraftPrompt(e.target.value)}
                        placeholder="Es. sorride leggermente, aggiungi una tazza sul tavolo, luce più calda sul volto…"
                        rows={3}
                        disabled={sceneBusy}
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          borderRadius: 10,
                          border: `1px solid ${AX.border}`,
                          background: AX.card,
                          color: AX.text,
                          fontSize: 13,
                          padding: 10,
                          resize: "vertical",
                          minHeight: 72,
                          marginBottom: 8,
                        }}
                      />
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        <button
                          type="button"
                          disabled={sceneBusy || !modifyDraftPrompt.trim()}
                          onClick={() => void confirmModifyScene()}
                          style={{
                            flex: 1,
                            minWidth: 120,
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "none",
                            background: AX.gradPrimary,
                            color: "#fff",
                            fontWeight: 700,
                            fontSize: 12,
                            cursor: sceneBusy || !modifyDraftPrompt.trim() ? "not-allowed" : "pointer",
                            opacity: sceneBusy || !modifyDraftPrompt.trim() ? 0.45 : 1,
                          }}
                        >
                          Conferma modifica
                        </button>
                        <button
                          type="button"
                          disabled={sceneBusy}
                          onClick={cancelModifyScene}
                          style={{
                            flex: 1,
                            minWidth: 120,
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: `1px solid ${AX.border}`,
                            background: "transparent",
                            color: AX.text2,
                            fontWeight: 600,
                            fontSize: 12,
                            cursor: sceneBusy ? "not-allowed" : "pointer",
                          }}
                        >
                          Annulla
                        </button>
                      </div>
                    </div>
                  )}
                  <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={selectedSceneIds.includes(r.sceneId)}
                      onChange={(e) => {
                        const on = e.target.checked;
                        e.stopPropagation();
                        setSelectedSceneIds((prev) =>
                          on ? [...prev, r.sceneId] : prev.filter((x) => x !== r.sceneId)
                        );
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ accentColor: AX.magenta }}
                      aria-label={`Seleziona ${r.title}`}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: AX.text }}>{r.title}</div>
                      {r.lastUpdatedAt && (
                        <div style={{ fontSize: 10, color: AX.muted, marginTop: 2 }}>
                          Agg. {new Date(r.lastUpdatedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Fase 3: clip video per scena (motore generazione da integrare) ── */}
      {approvedScenesForClips.length > 0 && (
        <div style={{ marginBottom: 22, padding: 16, borderRadius: 14, background: AX.card, border: `1px solid ${AX.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: AX.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            Fase 3 · Video clip approval
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: AX.text, margin: "0 0 8px" }}>Clip video collegati alle scene</h3>
          <p style={{ fontSize: 12, color: AX.text2, marginBottom: 16, lineHeight: 1.5 }}>
            Ogni scena approvata può avere uno o più clip. Stati: bozza, approvato, da rivedere, eliminato, finale. La modifica con prompt integrativo preserva stile, personaggi e scena sorgente (istruzioni registrate; rendering da collegare al motore).
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {approvedScenesForClips.map((scene) => {
              const clipsHere = sceneVideoClips.filter((c) => c.sceneId === scene.id && c.status !== SCENE_VIDEO_CLIP_STATUS.DELETED);
              return (
                <div
                  key={scene.id}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border: `1px solid ${AX.border}`,
                    background: AX.surface,
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: AX.text }}>{scene.title_it}</div>
                    <button
                      type="button"
                      disabled={pipelineLocked}
                      onClick={() => addSceneVideoClip(scene.id)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: `1px solid ${AX.electric}`,
                        background: "transparent",
                        color: AX.electric,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: pipelineLocked ? "not-allowed" : "pointer",
                        opacity: pipelineLocked ? 0.45 : 1,
                      }}
                    >
                      <HiPlus size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                      Aggiungi clip
                    </button>
                  </div>
                  {clipsHere.length === 0 ? (
                    <div style={{ fontSize: 12, color: AX.muted }}>Nessun clip: aggiungi almeno uno per poter chiudere la Fase 3.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {clipsHere.map((clip) => {
                        const stLabel = SCENE_VIDEO_CLIP_STATUS_LABEL[clip.status] || clip.status;
                        const canAct = !pipelineLocked;
                        return (
                          <div
                            key={clip.id}
                            style={{
                              padding: 10,
                              borderRadius: 10,
                              border: `1px solid ${AX.border}`,
                              background: AX.card,
                            }}
                          >
                            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: AX.magenta }}>{stLabel}</span>
                              <span style={{ fontSize: 10, color: AX.muted }}>{clip.id.slice(0, 18)}…</span>
                            </div>
                            <div style={{ fontSize: 11, color: AX.text2, marginBottom: 8 }}>
                              {clip.videoUrl ? (
                                <span style={{ color: AX.electric }}>Video collegato</span>
                              ) : (
                                <span>Nessun file video — placeholder fino al motore di generazione.</span>
                              )}
                            </div>
                            {clip.lastEditPrompt && (
                              <div style={{ fontSize: 10, color: AX.muted, marginBottom: 8 }}>Ultimo prompt modifica: {clip.lastEditPrompt}</div>
                            )}
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              <button
                                type="button"
                                disabled={!canAct || clip.status === SCENE_VIDEO_CLIP_STATUS.APPROVED || clip.status === SCENE_VIDEO_CLIP_STATUS.FINAL}
                                onClick={() => approveVideoClip(clip.id)}
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: 8,
                                  border: "none",
                                  background: AX.gradPrimary,
                                  color: "#fff",
                                  fontSize: 11,
                                  fontWeight: 700,
                                  cursor: !canAct || clip.status === SCENE_VIDEO_CLIP_STATUS.APPROVED || clip.status === SCENE_VIDEO_CLIP_STATUS.FINAL ? "not-allowed" : "pointer",
                                  opacity: !canAct || clip.status === SCENE_VIDEO_CLIP_STATUS.APPROVED || clip.status === SCENE_VIDEO_CLIP_STATUS.FINAL ? 0.45 : 1,
                                }}
                              >
                                Approva
                              </button>
                              <button
                                type="button"
                                disabled={!canAct}
                                onClick={() => startModifyVideoClip(clip.id)}
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: 8,
                                  border: `1px solid ${AX.violet}`,
                                  background: "transparent",
                                  color: AX.violet,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  cursor: !canAct ? "not-allowed" : "pointer",
                                }}
                              >
                                Modifica
                              </button>
                              <button
                                type="button"
                                disabled={!canAct}
                                onClick={() => regenerateVideoClip(clip.id)}
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: 8,
                                  border: `1px solid ${AX.border}`,
                                  background: AX.surface,
                                  color: AX.text2,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  cursor: !canAct ? "not-allowed" : "pointer",
                                }}
                              >
                                Rigenera
                              </button>
                              <button
                                type="button"
                                disabled={!canAct}
                                onClick={() => markVideoClipDeleted(clip.id)}
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: 8,
                                  border: "none",
                                  background: "rgba(180,40,60,0.9)",
                                  color: "#fff",
                                  fontSize: 11,
                                  fontWeight: 700,
                                  cursor: !canAct ? "not-allowed" : "pointer",
                                }}
                              >
                                Elimina
                              </button>
                            </div>
                            {modifyingClipId === clip.id && (
                              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${AX.border}` }}>
                                <div style={{ fontSize: 11, color: AX.text2, marginBottom: 6 }}>Prompt integrativo (movimento, camera, timing, intensità…)</div>
                                <textarea
                                  value={modifyClipDraft}
                                  onChange={(e) => setModifyClipDraft(e.target.value)}
                                  rows={2}
                                  style={{
                                    width: "100%",
                                    boxSizing: "border-box",
                                    borderRadius: 8,
                                    border: `1px solid ${AX.border}`,
                                    background: AX.bg,
                                    color: AX.text,
                                    fontSize: 12,
                                    padding: 8,
                                    marginBottom: 8,
                                  }}
                                />
                                <div style={{ display: "flex", gap: 8 }}>
                                  <button
                                    type="button"
                                    disabled={!modifyClipDraft.trim()}
                                    onClick={confirmModifyVideoClip}
                                    style={{
                                      padding: "6px 12px",
                                      borderRadius: 8,
                                      border: "none",
                                      background: AX.gradPrimary,
                                      color: "#fff",
                                      fontWeight: 700,
                                      fontSize: 11,
                                      cursor: !modifyClipDraft.trim() ? "not-allowed" : "pointer",
                                      opacity: !modifyClipDraft.trim() ? 0.45 : 1,
                                    }}
                                  >
                                    Conferma modifica
                                  </button>
                                  <button type="button" onClick={cancelModifyVideoClip} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${AX.border}`, background: "transparent", color: AX.text2, fontSize: 11, fontWeight: 600 }}>
                                    Annulla
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Fase 4: timeline / storyboard narrativo ── */}
      {clipsReadyForFinalMontage(gatePayload) && (
        <div style={{ marginBottom: 22, padding: 16, borderRadius: 14, background: AX.card, border: `1px solid ${AX.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: AX.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            Fase 4 · Timeline / storyboard
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: AX.text, margin: "0 0 8px" }}>Revisione e ordine narrativo</h3>
          <p style={{ fontSize: 12, color: AX.text2, marginBottom: 12, lineHeight: 1.55 }}>
            Trascina le righe per riordinare. Il filmato finale userà <strong style={{ color: AX.text }}>solo questo ordine</strong>, non l&apos;ordine di creazione. Conferma la timeline prima del montaggio.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            <button
              type="button"
              disabled={pipelineLocked || timelinePlan.approved}
              onClick={rebuildSuggestedTimeline}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: `1px solid ${AX.electric}`,
                background: "transparent",
                color: AX.electric,
                fontWeight: 700,
                fontSize: 12,
                cursor: pipelineLocked || timelinePlan.approved ? "not-allowed" : "pointer",
                opacity: pipelineLocked || timelinePlan.approved ? 0.45 : 1,
              }}
            >
              Rigenera ordine suggerito
            </button>
            <button
              type="button"
              disabled={pipelineLocked || !timelinePlan.entries?.length || timelinePlan.approved}
              onClick={confirmTimelineNarrative}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: "none",
                background: AX.gradPrimary,
                color: "#fff",
                fontWeight: 800,
                fontSize: 12,
                cursor: pipelineLocked || !timelinePlan.entries?.length || timelinePlan.approved ? "not-allowed" : "pointer",
                opacity: pipelineLocked || !timelinePlan.entries?.length || timelinePlan.approved ? 0.45 : 1,
              }}
            >
              Conferma timeline narrativa
            </button>
            {timelinePlan.approved && !pipelineLocked && (
              <button
                type="button"
                onClick={unlockTimelineNarrative}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: `1px solid ${AX.border}`,
                  background: AX.surface,
                  color: AX.text2,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Modifica ordine (sblocca)
              </button>
            )}
          </div>
          {timelinePlan.approved && (
            <div style={{ fontSize: 11, fontWeight: 700, color: AX.electric, marginBottom: 12 }}>
              Timeline approvata
              {timelinePlan.approvedAt ? ` · ${new Date(timelinePlan.approvedAt).toLocaleString()}` : ""}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(timelinePlan.entries || []).map((entry, idx) => {
              const sceneMeta = plan?.scenes?.find((s) => s.id === entry.sceneId);
              const sceneRow = sceneResults.find((r) => r.sceneId === entry.sceneId);
              const clip = entry.kind === "clip" && entry.clipId ? sceneVideoClips.find((c) => c.id === entry.clipId) : null;
              const title =
                entry.kind === "scene"
                  ? sceneMeta?.title_it || entry.sceneId
                  : `Clip · ${sceneMeta?.title_it || entry.sceneId}`;
              const thumb = entry.kind === "scene" ? sceneRow?.imageUrl : clip?.videoUrl || sceneRow?.imageUrl;
              const tlLocked = timelinePlan.approved || pipelineLocked;
              return (
                <div
                  key={entry.id}
                  draggable={!tlLocked}
                  onDragStart={() => onTimelineRowDragStart(idx)}
                  onDragEnd={onTimelineRowDragEnd}
                  onDragOver={onTimelineRowDragOver}
                  onDrop={() => onTimelineRowDrop(idx)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 52px 120px 1fr auto",
                    gap: 10,
                    alignItems: "center",
                    padding: 10,
                    borderRadius: 10,
                    border: `1px solid ${AX.border}`,
                    background: AX.surface,
                    opacity: 1,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 800, color: AX.electric, minWidth: 28 }}>{idx + 1}</span>
                  <div
                    style={{
                      width: 52,
                      height: 40,
                      borderRadius: 8,
                      overflow: "hidden",
                      background: AX.bg,
                      border: `1px solid ${AX.border}`,
                    }}
                  >
                    {thumb ? (
                      <img src={thumb} alt="Anteprima timeline" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ fontSize: 9, color: AX.muted, padding: 4 }}>—</div>
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: AX.text, lineHeight: 1.25 }}>{title}</div>
                    <div style={{ fontSize: 10, color: AX.muted, marginTop: 2 }}>
                      {entry.kind === "scene" ? "Quadro scena" : "Clip video"}
                    </div>
                  </div>
                  <label style={{ fontSize: 11, color: AX.text2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    Durata (s)
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      disabled={tlLocked}
                      value={entry.durationSec ?? ""}
                      onChange={(e) => setTimelineEntryDuration(idx, e.target.value)}
                      style={{
                        width: 72,
                        padding: "4px 8px",
                        borderRadius: 8,
                        border: `1px solid ${AX.border}`,
                        background: AX.card,
                        color: AX.text,
                        fontSize: 12,
                      }}
                    />
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "stretch" }}>
                    <span
                      title="Trascina per spostare"
                      style={{
                        fontSize: 10,
                        color: AX.muted,
                        cursor: tlLocked ? "default" : "grab",
                        userSelect: "none",
                        textAlign: "center",
                      }}
                    >
                      ⋮⋮
                    </span>
                    <button
                      type="button"
                      disabled={tlLocked || idx === 0}
                      onClick={() => moveTimelineEntry(idx, -1)}
                      style={{ padding: 4, borderRadius: 6, border: `1px solid ${AX.border}`, background: AX.card, cursor: tlLocked || idx === 0 ? "not-allowed" : "pointer" }}
                      aria-label="Sposta su"
                    >
                      <HiChevronUp size={16} />
                    </button>
                    <button
                      type="button"
                      disabled={tlLocked || idx >= (timelinePlan.entries || []).length - 1}
                      onClick={() => moveTimelineEntry(idx, 1)}
                      style={{ padding: 4, borderRadius: 6, border: `1px solid ${AX.border}`, background: AX.card, cursor: tlLocked || idx >= (timelinePlan.entries || []).length - 1 ? "not-allowed" : "pointer" }}
                      aria-label="Sposta giù"
                    >
                      <HiChevronDown size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {(timelinePlan.entries || []).length === 0 && (
            <div style={{ fontSize: 12, color: AX.muted, marginTop: 10 }}>Nessuna voce: usa «Rigenera ordine suggerito» per popolare scene e clip approvati.</div>
          )}
        </div>
      )}

      {/* ── Fase 5: auto-montaggio (struttura sequenza) ── */}
      {finalMontagePhase === "assembly" && (
        <div style={{ marginBottom: 22, padding: 16, borderRadius: 14, background: "rgba(123,77,255,0.08)", border: `1px solid rgba(123,77,255,0.35)` }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: AX.violet, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Fase 5 · Montaggio finale</div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: AX.text, margin: "0 0 8px" }}>Auto-montaggio narrativo</h3>
          <p style={{ fontSize: 12, color: AX.text2, lineHeight: 1.55, marginBottom: 12 }}>
            Sequenza registrata dalla timeline approvata. Il rendering del filmato unico e le transizioni saranno gestiti dal motore dedicato.
          </p>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: AX.text2, lineHeight: 1.7 }}>
            {(finalMontagePlan.orderedTimelineEntryIds && finalMontagePlan.orderedTimelineEntryIds.length > 0
              ? finalMontagePlan.orderedTimelineEntryIds
              : finalMontagePlan.orderedClipIds || []
            ).map((rowId, i) => {
              if (finalMontagePlan.orderedTimelineEntryIds && finalMontagePlan.orderedTimelineEntryIds.length > 0) {
                const entry = timelinePlan.entries.find((x) => x.id === rowId);
                if (!entry) {
                  return (
                    <li key={rowId}>
                      {i + 1}. (voce timeline mancante) {rowId}
                    </li>
                  );
                }
                const sc = plan?.scenes?.find((s) => s.id === entry.sceneId);
                const clip = entry.kind === "clip" && entry.clipId ? sceneVideoClips.find((c) => c.id === entry.clipId) : null;
                const label =
                  entry.kind === "scene" ? `Scena — ${sc?.title_it || entry.sceneId}` : `Clip — ${sc?.title_it || entry.sceneId}`;
                return (
                  <li key={rowId}>
                    {i + 1}. {label}
                    {entry.durationSec != null ? ` · ${entry.durationSec}s` : ""}
                    {clip ? ` — ${SCENE_VIDEO_CLIP_STATUS_LABEL[clip.status] || clip.status}` : ""}
                  </li>
                );
              }
              const cid = rowId;
              const c = sceneVideoClips.find((x) => x.id === cid);
              const sc = plan?.scenes?.find((s) => s.id === c?.sceneId);
              return (
                <li key={cid}>
                  {i + 1}. {sc?.title_it || c?.sceneId || cid}
                  {c ? ` — ${SCENE_VIDEO_CLIP_STATUS_LABEL[c.status] || c.status}` : ""}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* ── Empty state ── */}
      {!plan && !planning && sceneResults.length === 0 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: 0.5 }}>
          <HiFilm size={48} style={{ color: AX.muted, marginBottom: 12 }} />
          <div style={{ fontSize: 14, color: AX.text2, textAlign: "center", maxWidth: 380 }}>
            {Object.keys(masterImages).length > 0 || Object.keys(masterByCharName).length > 0 ? (
              <>
                Master ancora salvati in memoria. Modifica il prompt e usa <strong style={{ color: AX.text }}>Analizza mantenendo i personaggi</strong> per un nuovo piano senza perdere i volti.
              </>
            ) : (
              <>
                Scrivi una descrizione e clicca &quot;Analizza Prompt&quot; per iniziare.
                <br />
                <span style={{ fontSize: 12, color: AX.muted }}>
                  L&apos;AI creerà personaggi coerenti e scene con identità visiva consistente.
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {newProjectConfirmOpen && (
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
          onClick={cancelNewProjectConfirm}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="scenografie-new-project-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 440,
              borderRadius: 16,
              background: AX.card,
              border: `1px solid ${AX.border}`,
              boxShadow: "0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(123,77,255,0.12)",
              overflow: "hidden",
            }}
          >
            <div style={{ height: 3, background: AX.gradLogo, width: "100%" }} />
            <div style={{ padding: "22px 24px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: AX.surface,
                    border: `1px solid ${AX.border}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <HiFilm size={22} style={{ color: AX.violet }} />
                </div>
                <h2 id="scenografie-new-project-title" style={{ margin: 0, fontSize: 18, fontWeight: 800, color: AX.text, letterSpacing: "-0.02em" }}>
                  Elimina progetto scenografico
                </h2>
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: AX.text2 }}>
                Questo progetto verrà rimosso dalla griglia Scenografie e cancellato dallo spazio dedicato (file o localStorage). L&apos;azione non è annullabile.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end", marginTop: 24 }}>
                <button
                  type="button"
                  onClick={cancelNewProjectConfirm}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 10,
                    border: `1px solid ${AX.border}`,
                    background: AX.surface,
                    color: AX.text2,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={confirmNewProjectReset}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 10,
                    border: "none",
                    background: AX.gradPrimary,
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 4px 20px rgba(41,182,255,0.25)",
                  }}
                >
                  Sì, elimina progetto
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
