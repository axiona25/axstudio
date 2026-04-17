/**
 * Wizard creazione progetto Scenografie da traccia completa (story-driven preproduction).
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { HiSparkles, HiArrowLeft, HiArrowPath, HiChevronRight, HiPhoto } from "react-icons/hi2";
import { planScenografia, validatePlan, characterRoleLabelIt } from "../services/scenografiePlanner.js";
import { buildProjectStyleFromImagePreset } from "../services/scenografieProjectStyle.js";
import {
  composePlannerPromptFromStory,
  buildStoryAnalysisFromPlan,
  enrichPlanWithAutoPreproduction,
  adaptPlanToTargetDuration,
  STORY_CLIP_KIND,
} from "../services/storyAutoPlanningEngine.js";
import { buildScenografiaWorkspaceFromStoryWizard } from "../services/scenografieProjectPersistence.js";
import {
  buildStoryWizardCommitFailure,
  logConsumerReliabilityEvent,
  SUGGESTED_ACTION_LABEL_IT,
} from "../services/scenografieConsumerReliability.js";
import { enrichWizardChecklistTaskRuntime } from "../services/scenografieOperationalReadiness.js";
import {
  ProjectCreationModalHeader,
  ProjectStylePresetGrid,
  modalOverlayStyle,
  modalDialogStyle,
  modalGradientBarStyle,
  labelStyle,
  inputFieldStyle,
  textareaFieldStyle,
  btnSecondaryFooter,
  btnPrimaryFooter,
  PC_AX,
} from "./ProjectCreationModalUi.js";

const AX = PC_AX;

const DURATION_PRESETS = [
  { sec: 120, label: "~2 min" },
  { sec: 300, label: "~5 min" },
  { sec: 480, label: "~8 min" },
  { sec: 720, label: "~12 min" },
];

const CLIP_KIND_LABEL = {
  [STORY_CLIP_KIND.NARRATED]: "Narrato",
  [STORY_CLIP_KIND.DIALOGUE]: "Dialogico",
  [STORY_CLIP_KIND.CONVERSATIONAL]: "Conversazionale",
  [STORY_CLIP_KIND.ENVIRONMENT]: "Ambiente",
  [STORY_CLIP_KIND.TRANSITION]: "Transizione",
  [STORY_CLIP_KIND.REACTION]: "Reaction",
  [STORY_CLIP_KIND.ESTABLISHING]: "Establishing",
  [STORY_CLIP_KIND.MULTI_SUBJECT]: "Multi-soggetto",
};

const DRAFT_KEY = "axstudio_story_wizard_draft_v1";

function deepClone(o) {
  return o ? JSON.parse(JSON.stringify(o)) : null;
}

function btnPrimary(disabled) {
  return {
    padding: "12px 20px",
    borderRadius: 12,
    border: "none",
    fontWeight: 800,
    fontSize: 14,
    cursor: disabled ? "not-allowed" : "pointer",
    background: disabled ? AX.border : AX.gradPrimary,
    color: disabled ? AX.muted : "#fff",
    opacity: disabled ? 0.6 : 1,
  };
}

function btnGhost() {
  return {
    padding: "12px 18px",
    borderRadius: 12,
    border: `1px solid ${AX.border}`,
    background: "transparent",
    color: AX.text2,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  };
}

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   imageStylePresets: Array<{ id: string, label: string, prompt: string }>,
 *   defaultPresetId: string,
 *   onCommitted: (workspace: object) => Promise<void>,
 * }} props
 */
export default function ScenografieStoryProjectWizard({ open, onClose, imageStylePresets, defaultPresetId, onCommitted }) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [storyPrompt, setStoryPrompt] = useState("");
  const [presetId, setPresetId] = useState("");
  const [targetFilmDurationSec, setTargetFilmDurationSec] = useState(300);
  const [plan, setPlan] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wizardError, setWizardError] = useState("");
  /** @type {object|null} */
  const [commitError, setCommitError] = useState(null);
  const [expandedScene, setExpandedScene] = useState(null);
  const [charGraphics, setCharGraphics] = useState({});
  const [editScene, setEditScene] = useState(null);

  useEffect(() => {
    if (!open) return;
    setPresetId((pid) => pid || defaultPresetId || imageStylePresets[0]?.id || "");
  }, [open, defaultPresetId, imageStylePresets]);

  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.step) setStep(d.step);
      if (d.title != null) setTitle(d.title);
      if (d.description != null) setDescription(d.description);
      if (d.storyPrompt != null) setStoryPrompt(d.storyPrompt);
      if (d.presetId) setPresetId(d.presetId);
      if (d.targetFilmDurationSec) setTargetFilmDurationSec(d.targetFilmDurationSec);
      if (d.plan) setPlan(d.plan);
      if (d.analysis) setAnalysis(d.analysis);
      if (d.charGraphics) setCharGraphics(d.charGraphics);
    } catch {
      /* ignore */
    }
  }, [open]);

  const saveDraft = useCallback(() => {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          step,
          title,
          description,
          storyPrompt,
          presetId,
          targetFilmDurationSec,
          plan,
          analysis,
          charGraphics,
        })
      );
    } catch {
      /* ignore */
    }
  }, [step, title, description, storyPrompt, presetId, targetFilmDurationSec, plan, analysis, charGraphics]);

  const resetWizard = useCallback(() => {
    setStep(1);
    setTitle("");
    setDescription("");
    setStoryPrompt("");
    setTargetFilmDurationSec(300);
    setPlan(null);
    setAnalysis(null);
    setWizardError("");
    setCommitError(null);
    setCharGraphics({});
    setExpandedScene(null);
    setEditScene(null);
  }, []);

  const runAnalyze = useCallback(async () => {
    const t = title.trim();
    const s = storyPrompt.trim();
    if (!t || !s) {
      setWizardError("Titolo e traccia completa sono obbligatori.");
      return;
    }
    setBusy(true);
    setWizardError("");
    setCommitError(null);
    try {
      const prompt = composePlannerPromptFromStory({ title: t, description: description.trim(), storyPrompt: s });
      const rawPlan = await planScenografia(prompt);
      if (!rawPlan) throw new Error("Analisi non riuscita. Controlla la chiave OpenRouter (REACT_APP_OPENROUTER_API_KEY).");
      const p = deepClone(rawPlan);
      const v = validatePlan(p);
      if (!v.valid) throw new Error(v.error || "Piano non valido");
      const enriched = enrichPlanWithAutoPreproduction(p, targetFilmDurationSec);
      setPlan(enriched);
      setAnalysis(buildStoryAnalysisFromPlan(enriched, { storyPrompt: s, targetFilmDurationSec }));
      const cg = {};
      for (const c of enriched.characters || []) {
        cg[c.id] = {
          narrativeAccepted: false,
          graphicPrompt: String(c.appearance_prompt || "").trim(),
          graphicStatus: "pending",
        };
      }
      setCharGraphics(cg);
      setStep(2);
    } catch (e) {
      setWizardError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [title, description, storyPrompt, targetFilmDurationSec]);

  const runRegenerateAnalysis = useCallback(async () => {
    if (!plan) return;
    setBusy(true);
    setWizardError("");
    setCommitError(null);
    try {
      const next = await adaptPlanToTargetDuration(plan, targetFilmDurationSec);
      if (!next) throw new Error("Rigenerazione non riuscita.");
      const p = deepClone(next);
      const v = validatePlan(p);
      if (!v.valid) throw new Error(v.error || "Piano non valido");
      const enriched = enrichPlanWithAutoPreproduction(p, targetFilmDurationSec);
      setPlan(enriched);
      setAnalysis(buildStoryAnalysisFromPlan(enriched, { storyPrompt, targetFilmDurationSec }));
    } catch (e) {
      setWizardError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [plan, targetFilmDurationSec, storyPrompt]);

  useEffect(() => {
    if (!plan || step < 2) return;
    setAnalysis(buildStoryAnalysisFromPlan(plan, { storyPrompt, targetFilmDurationSec }));
  }, [targetFilmDurationSec, plan, storyPrompt, step]);

  const projectStyle = useMemo(() => {
    const preset = imageStylePresets.find((p) => p.id === presetId);
    if (!preset) return null;
    return buildProjectStyleFromImagePreset(preset, { descriptionHint: description.trim() || storyPrompt.trim().slice(0, 400) });
  }, [imageStylePresets, presetId, description, storyPrompt]);

  const commitWorkspace = useCallback(
    async (startFirstSceneOnly) => {
      if (!plan) return;
      if (!projectStyle) {
        setCommitError(
          buildStoryWizardCommitFailure(
            new Error("Seleziona uno stile grafico valido nel passo 1 prima di confermare il progetto."),
          ),
        );
        return;
      }
      setBusy(true);
      setCommitError(null);
      try {
        const mergedPlan = deepClone(plan);
        for (const ch of mergedPlan.characters || []) {
          const g = charGraphics[ch.id];
          if (g?.graphicPrompt && String(g.graphicPrompt).trim()) {
            ch.appearance_prompt = String(g.graphicPrompt).trim();
          }
        }
        const vMerge = validatePlan(mergedPlan);
        if (!vMerge.valid) throw new Error(vMerge.error || "Piano non valido dopo merge grafica");
        const planForSave = enrichPlanWithAutoPreproduction(mergedPlan, targetFilmDurationSec);

        const storyPreproductionBundle = {
          version: 1,
          storyPrompt: storyPrompt.trim(),
          targetFilmDurationSec,
          storyAnalysis: analysis,
          characterGraphics: charGraphics,
          committedFromWizardAt: new Date().toISOString(),
        };
        const hints = startFirstSceneOnly
          ? { sceneExecuteMode: "SELECTED", reuseMastersNext: false }
          : { sceneExecuteMode: "ALL", reuseMastersNext: false };
        const firstId = planForSave.scenes?.[0]?.id;
        const workspace = buildScenografiaWorkspaceFromStoryWizard({
          title: title.trim(),
          description: description.trim(),
          projectStyle,
          storyPrompt: storyPrompt.trim(),
          targetFilmDurationSec,
          plan: planForSave,
          storyAnalysis: analysis,
          storyPreproductionBundle,
          selectedSceneIds: startFirstSceneOnly && firstId ? [firstId] : [],
          runtimeHints: hints,
        });
        await onCommitted(workspace);
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* ignore */
        }
        resetWizard();
        onClose();
      } catch (e) {
        const wf = buildStoryWizardCommitFailure(e);
        logConsumerReliabilityEvent("story_wizard_commit_failed", wf);
        setCommitError(wf);
      } finally {
        setBusy(false);
      }
    },
    [
      plan,
      projectStyle,
      storyPrompt,
      targetFilmDurationSec,
      analysis,
      charGraphics,
      title,
      description,
      onCommitted,
      onClose,
      resetWizard,
    ]
  );

  if (!open) return null;

  const metricCard = (label, value, sub) => (
    <div
      style={{
        padding: 14,
        borderRadius: 14,
        border: `1px solid ${AX.border}`,
        background: AX.card,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, color: AX.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: AX.text, marginTop: 6 }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: AX.text2, marginTop: 4, lineHeight: 1.4 }}>{sub}</div> : null}
    </div>
  );

  return (
    <div className="ax-modal-touch-lock" style={{ ...modalOverlayStyle, alignItems: "center", overflow: "auto" }}>
      <div style={{ ...modalDialogStyle(720), margin: "auto", width: "100%" }}>
        <div style={modalGradientBarStyle} />
        <ProjectCreationModalHeader
          eyebrow="AXSTUDIO · FILM STUDIO"
          badge={step === 1 ? "Guidata · assistita da AI" : undefined}
          title="Nuovo progetto guidato"
          titleAdornment={<HiSparkles size={26} style={{ color: AX.violet, flexShrink: 0 }} aria-hidden />}
          subtitle={
            <>
              Passo <strong style={{ color: AX.text }}>{step}</strong> di 9 — percorso assistito con analisi AI del testo; gli step successivi allineano piano, cast e conferma al flusso standard Film Studio.
            </>
          }
          onClose={() => !busy && onClose()}
          closeDisabled={busy}
        />

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 24px 0" }}>
          {wizardError ? (
            <div
              style={{
                marginBottom: 16,
                padding: 12,
                borderRadius: 12,
                background: "rgba(127,29,29,0.2)",
                border: "1px solid rgba(248,113,113,0.35)",
                color: "#fecaca",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {wizardError}
            </div>
          ) : null}
          {commitError ? (
            <div
              style={{
                marginBottom: 16,
                padding: 12,
                borderRadius: 12,
                background: "rgba(127,29,29,0.25)",
                border: "1px solid rgba(248,113,113,0.4)",
                color: "#fecaca",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              <strong>Non siamo riusciti a creare il progetto.</strong>
              <div style={{ marginTop: 6 }}>{commitError.errorMessageUser}</div>
              {commitError.suggestedAction ? (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.95 }}>
                  Puoi:{" "}
                  <strong>{SUGGESTED_ACTION_LABEL_IT[commitError.suggestedAction] || commitError.suggestedAction}</strong>
                </div>
              ) : null}
              {commitError.errorMessageTechnical ? (
                <details style={{ marginTop: 10, fontSize: 11, color: "#fca5a5" }}>
                  <summary style={{ cursor: "pointer" }}>Dettaglio tecnico</summary>
                  <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", fontFamily: "monospace" }}>
                    {String(commitError.errorMessageTechnical)}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : null}

          {/* Step 1 */}
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 8 }}>
              <p style={{ fontSize: 14, color: AX.text2, lineHeight: 1.55, margin: 0 }}>
                Inserisci i dati base e la <strong style={{ color: AX.text }}>traccia completa</strong> del film: trama, personaggi, tono, ambiente, finale, stile narrativo.
              </p>
              <div>
                <label htmlFor="wiz-guided-title" style={labelStyle}>
                  Titolo progetto <span style={{ color: "#f87171" }}>*</span>
                </label>
                <input
                  id="wiz-guided-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Es. Il faro nella nebbia"
                  disabled={busy}
                  style={{ ...inputFieldStyle, opacity: busy ? 0.7 : 1 }}
                />
              </div>
              <div>
                <label htmlFor="wiz-guided-desc" style={labelStyle}>
                  Descrizione breve <span style={{ color: "#f87171" }}>*</span>
                </label>
                <input
                  id="wiz-guided-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Una riga sul tema e sul pubblico…"
                  disabled={busy}
                  style={{ ...inputFieldStyle, opacity: busy ? 0.7 : 1 }}
                />
              </div>
              <div>
                <div style={{ ...labelStyle, marginBottom: 10 }}>
                  Stile grafico globale <span style={{ color: "#f87171" }}>*</span>
                </div>
                <ProjectStylePresetGrid presets={imageStylePresets} value={presetId} onChange={setPresetId} disabled={busy} maxHeight={200} />
              </div>
              <div>
                <label htmlFor="wiz-guided-story" style={{ ...labelStyle, color: AX.electric }}>
                  Traccia completa del film <span style={{ color: "#f87171" }}>*</span>
                </label>
                <textarea
                  id="wiz-guided-story"
                  value={storyPrompt}
                  onChange={(e) => setStoryPrompt(e.target.value)}
                  placeholder="Scrivi qui tutta la storia che vuoi realizzare…"
                  rows={12}
                  disabled={busy}
                  style={{
                    ...textareaFieldStyle,
                    minHeight: 200,
                    marginTop: 4,
                    border: "1px solid rgba(41,182,255,0.28)",
                    opacity: busy ? 0.7 : 1,
                  }}
                />
              </div>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && analysis && (
            <div>
              <p style={{ fontSize: 13, color: AX.text2, lineHeight: 1.55, margin: "0 0 16px" }}>
                {analysis.narrativeStructureSummary}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 18 }}>
                {metricCard("Scene", analysis.proposedSceneCount, "proposte")}
                {metricCard("Personaggi", analysis.proposedCharacterCount, "principali")}
                {metricCard("Clip", analysis.proposedClipCount, "totali")}
                {metricCard("Durata stimata", `${analysis.estimatedFilmDurationSec}s`, "da piano")}
                {metricCard("Complessità", analysis.complexity, analysis.genreMood)}
                {metricCard("Tono", analysis.toneLine.slice(0, 42) + (analysis.toneLine.length > 42 ? "…" : ""), "da prima scena / stile")}
              </div>
              <div style={{ marginBottom: 16, padding: 14, borderRadius: 14, border: `1px solid ${AX.border}`, background: AX.card }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: AX.text, marginBottom: 10 }}>Durata massima desiderata (approssimativa)</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  {DURATION_PRESETS.map((d) => (
                    <button
                      key={d.sec}
                      type="button"
                      onClick={() => setTargetFilmDurationSec(d.sec)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 999,
                        border: `1px solid ${targetFilmDurationSec === d.sec ? AX.violet : AX.border}`,
                        background: targetFilmDurationSec === d.sec ? "rgba(123,77,255,0.2)" : AX.bg,
                        color: targetFilmDurationSec === d.sec ? AX.text : AX.muted,
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: 12,
                      }}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <label style={{ fontSize: 12, color: AX.text2 }}>
                  Secondi (libero):
                  <input
                    type="number"
                    min={30}
                    max={3600}
                    value={targetFilmDurationSec}
                    onChange={(e) => setTargetFilmDurationSec(Number(e.target.value) || 300)}
                    style={{ marginLeft: 8, width: 100, padding: 8, borderRadius: 8, border: `1px solid ${AX.border}`, background: AX.bg, color: AX.text }}
                  />
                </label>
                <p style={{ fontSize: 11, color: AX.muted, margin: "10px 0 0", lineHeight: 1.45 }}>
                  Se modifichi la durata, usa «Rigenera analisi» per chiedere al planner di ricalibrare scene e clip (richiede OpenRouter).
                </p>
              </div>
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && plan && (
            <div>
              <p style={{ fontSize: 13, color: AX.text2, margin: "0 0 14px" }}>Rivedi le scene: titolo, durata, numero clip e tipologie.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {(plan.scenes || []).map((sc, idx) => {
                  const sap = sc.storyAutoPlan || {};
                  return (
                    <div key={sc.id} style={{ borderRadius: 16, border: `1px solid ${AX.border}`, background: AX.card, padding: 16 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 8, fontWeight: 800, color: AX.muted, letterSpacing: "0.1em" }}>SCENA {idx + 1}</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: AX.text }}>{sc.title_it}</div>
                          <div style={{ fontSize: 12, color: AX.text2, marginTop: 6, lineHeight: 1.45 }}>{sc.summary_it}</div>
                          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                            <span style={{ fontSize: 10, padding: "4px 8px", borderRadius: 8, background: "rgba(41,182,255,0.15)", color: AX.electric }}>
                              ~{sap.sceneEstimatedDurationSec ?? "—"}s
                            </span>
                            <span style={{ fontSize: 10, padding: "4px 8px", borderRadius: 8, background: "rgba(123,77,255,0.15)", color: "#c4b5fd" }}>
                              {sap.sceneSuggestedClipCount ?? 0} clip
                            </span>
                            {(sap.sceneSuggestedClipTypes || []).slice(0, 4).map((t) => (
                              <span key={t} style={{ fontSize: 10, padding: "4px 8px", borderRadius: 8, border: `1px solid ${AX.border}`, color: AX.muted }}>
                                {CLIP_KIND_LABEL[t] || t}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <button type="button" style={{ ...btnGhost(), fontSize: 12, padding: "8px 12px" }} onClick={() => setEditScene({ type: "scene", scene: sc })}>
                            Modifica…
                          </button>
                          <button
                            type="button"
                            style={{ ...btnGhost(), fontSize: 12, padding: "8px 12px" }}
                            disabled={idx === 0}
                            onClick={() => {
                              const next = deepClone(plan);
                              const arr = next.scenes;
                              [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                              setPlan(enrichPlanWithAutoPreproduction(next, targetFilmDurationSec));
                            }}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            style={{ ...btnGhost(), fontSize: 12, padding: "8px 12px" }}
                            disabled={idx >= (plan.scenes || []).length - 1}
                            onClick={() => {
                              const next = deepClone(plan);
                              const arr = next.scenes;
                              [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
                              setPlan(enrichPlanWithAutoPreproduction(next, targetFilmDurationSec));
                            }}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            style={{ ...btnGhost(), fontSize: 12, padding: "8px 12px" }}
                            onClick={() => {
                              if (!window.confirm("Eliminare questa scena?")) return;
                              const next = deepClone(plan);
                              next.scenes = next.scenes.filter((s) => s.id !== sc.id);
                              next.clips = (next.clips || []).filter((c) => (c.scene_id || c.sceneId) !== sc.id);
                              const enriched = enrichPlanWithAutoPreproduction(next, targetFilmDurationSec);
                              setPlan(enriched);
                            }}
                          >
                            Elimina
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                style={{ ...btnGhost(), marginTop: 14, width: "100%" }}
                onClick={() => {
                  const next = deepClone(plan);
                  const n = next.scenes.length + 1;
                  const id = `scene_${Date.now().toString(36)}`;
                  next.scenes.push({
                    id,
                    title_it: `Nuova scena ${n}`,
                    summary_it: "Da completare nella descrizione.",
                    description: "Interior or exterior scene, cinematic lighting, coherent with project style.",
                    environment: "coherent location",
                    lighting: "motivated light",
                    mood: "consistent tone",
                    camera: "medium shot",
                    sceneType: "character_scene",
                    characters_present: next.characters?.[0]?.id ? [next.characters[0].id] : [],
                  });
                  const enriched = enrichPlanWithAutoPreproduction(next, targetFilmDurationSec);
                  setPlan(enriched);
                }}
              >
                + Aggiungi scena
              </button>
            </div>
          )}

          {/* Step 4 + 4.1 combined view: step 4 characters, step 5 asks to go to 4.1 - actually we use step 4 chars, step 5 = graphics */}
          {step === 4 && plan && (
            <div>
              <p style={{ fontSize: 13, color: AX.text2, margin: "0 0 14px" }}>Personaggi proposti: ruolo, scene e presenza.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                {(plan.characters || []).map((ch) => {
                  const prop = ch.characterNarrativeProposal || {};
                  return (
                    <div key={ch.id} style={{ borderRadius: 14, border: `1px solid ${AX.border}`, padding: 14, background: AX.card }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: AX.text }}>{ch.name}</div>
                      <div style={{ fontSize: 11, color: AX.electric, marginTop: 4 }}>{characterRoleLabelIt(ch) || prop.presenceType}</div>
                      <div style={{ fontSize: 11, color: AX.text2, marginTop: 8, lineHeight: 1.45 }}>{prop.voiceSuggested}</div>
                      <div style={{ fontSize: 10, color: AX.muted, marginTop: 8 }}>
                        Scene: {(prop.scenesAppearing || []).slice(0, 4).join(", ") || "—"}
                      </div>
                      <button type="button" style={{ ...btnGhost(), marginTop: 10, width: "100%", fontSize: 12 }} onClick={() => setEditScene({ type: "char", char: ch })}>
                        Modifica nome / ruolo…
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {step === 5 && plan && (
            <div>
              <div
                style={{
                  marginBottom: 14,
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid rgba(251,191,36,0.35)",
                  background: "rgba(120,80,20,0.12)",
                  fontSize: 12,
                  color: AX.text2,
                  lineHeight: 1.55,
                }}
              >
                <strong style={{ color: "#fbbf24" }}>Nessuna immagine viene generata in questo passo.</strong> Prepari solo il{" "}
                <strong style={{ color: AX.text }}>testo del prompt master</strong> (come guida per FLUX). La generazione e l’approvazione
                visiva dei personaggi avvengono <strong style={{ color: AX.text }}>dopo</strong>, nell’editor Scenografie.
              </div>
              <p style={{ fontSize: 13, color: AX.text2, margin: "0 0 14px" }}>
                Prompt master — bozza per Scenografie
              </p>
              <div style={{ display: "grid", gap: 12 }}>
                {(plan.characters || []).map((ch) => {
                  const g = charGraphics[ch.id] || {};
                  const narrativeOk = g.narrativeAccepted === true;
                  const promptLocked = g.graphicStatus === "accepted";
                  return (
                    <div key={ch.id} style={{ borderRadius: 14, border: `1px solid ${AX.border}`, padding: 14, background: AX.card }}>
                      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: AX.text }}>{ch.name}</div>
                          <div style={{ fontSize: 10, marginTop: 4, color: narrativeOk ? "#4ade80" : AX.muted }}>
                            Nota narrativa: {narrativeOk ? "confermata in wizard" : "opzionale in wizard"}
                          </div>
                          <div style={{ fontSize: 10, marginTop: 2, color: promptLocked ? "#4ade80" : AX.muted }}>
                            Prompt master:{" "}
                            {promptLocked
                              ? "salvato nel piano (immagine non ancora generata)"
                              : "bozza — conferma per scriverlo nel piano"}
                          </div>
                        </div>
                        <HiPhoto size={28} style={{ color: AX.violet, opacity: 0.35 }} title="Anteprima non disponibile nel wizard" />
                      </div>
                      <textarea
                        value={g.graphicPrompt || ""}
                        onChange={(e) =>
                          setCharGraphics((prev) => ({
                            ...prev,
                            [ch.id]: { ...prev[ch.id], graphicPrompt: e.target.value },
                          }))
                        }
                        rows={3}
                        placeholder="Descrizione fisica per il master (testo — verrà usata in Scenografie per generare il volto)"
                        style={{ marginTop: 10, width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${AX.border}`, background: AX.bg, color: AX.text, fontSize: 12, boxSizing: "border-box" }}
                      />
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                        <button
                          type="button"
                          style={btnGhost()}
                          onClick={() =>
                            setCharGraphics((prev) => ({
                              ...prev,
                              [ch.id]: { ...prev[ch.id], narrativeAccepted: true },
                            }))
                          }
                        >
                          Segna nota narrativa OK
                        </button>
                        <button
                          type="button"
                          style={btnPrimary(false)}
                          onClick={() => {
                            const prompt = (charGraphics[ch.id]?.graphicPrompt || "").trim();
                            if (!prompt) return;
                            const next = deepClone(plan);
                            const c = next.characters.find((x) => x.id === ch.id);
                            if (c) c.appearance_prompt = prompt;
                            setPlan(enrichPlanWithAutoPreproduction(next, targetFilmDurationSec));
                            setCharGraphics((prev) => ({
                              ...prev,
                              [ch.id]: { ...prev[ch.id], graphicStatus: "accepted", narrativeAccepted: true },
                            }));
                          }}
                        >
                          Salva prompt master nel piano
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 6 — scene detail accordion */}
          {step === 6 && plan && (
            <div>
              <p style={{ fontSize: 13, color: AX.text2, margin: "0 0 14px" }}>Pianificazione per scena: cast, regia, audio, musica.</p>
              {(plan.scenes || []).map((sc) => {
                const open = expandedScene === sc.id;
                const sap = sc.storyAutoPlan || {};
                return (
                  <div key={sc.id} style={{ marginBottom: 10, borderRadius: 14, border: `1px solid ${AX.border}`, overflow: "hidden" }}>
                    <button
                      type="button"
                      onClick={() => setExpandedScene(open ? null : sc.id)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "14px 16px",
                        border: "none",
                        background: open ? "rgba(41,182,255,0.08)" : AX.card,
                        color: AX.text,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>{sc.title_it}</span>
                      <HiChevronRight style={{ transform: open ? "rotate(90deg)" : "none", transition: "0.2s" }} />
                    </button>
                    {open && (
                      <div style={{ padding: "12px 16px 16px", background: AX.bg, fontSize: 12, color: AX.text2, lineHeight: 1.55 }}>
                        <div>
                          <strong style={{ color: AX.text }}>Cast:</strong> {(sc.characters_present || []).join(", ") || "—"}
                        </div>
                        <div>
                          <strong style={{ color: AX.text }}>Modalità:</strong> {sap.sceneModeSuggested}
                        </div>
                        <div>
                          <strong style={{ color: AX.text }}>Regia:</strong> {sap.directingNote}
                        </div>
                        <div>
                          <strong style={{ color: AX.text }}>Musica:</strong> {sap.musicSuggested}
                        </div>
                        <div>
                          <strong style={{ color: AX.text }}>Ambiente:</strong> {sap.ambientSoundSuggested}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Step 7 — clips */}
          {step === 7 && plan && (
            <div>
              <p style={{ fontSize: 13, color: AX.text2, margin: "0 0 14px" }}>Clip per scena (da piano LLM + arricchimento).</p>
              {(plan.scenes || []).map((sc) => (
                <div key={sc.id} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: AX.electric, marginBottom: 8 }}>{sc.title_it}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(plan.clips || [])
                      .filter((c) => (c.scene_id || c.sceneId) === sc.id)
                      .map((cl, i) => {
                        const cap = cl.clipAutoPlan || {};
                        return (
                          <div key={cl.id || i} style={{ borderRadius: 12, border: `1px solid ${AX.border}`, padding: 12, background: AX.card }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: AX.text }}>Clip {i + 1} · {CLIP_KIND_LABEL[cap.clipSuggestedType] || cap.clipSuggestedType}</div>
                            <div style={{ fontSize: 11, color: AX.text2, marginTop: 6 }}>{cl.action_it}</div>
                            <div style={{ fontSize: 10, color: AX.muted, marginTop: 6 }}>
                              ~{cap.clipEstimatedDurationSec ?? cl.duration_suggestion ?? "—"}s · {cap.clipSuggestedShotIntent}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Step 8 — checklist (solo proposta iniziale, non sincronizzata con la produzione reale) */}
          {step === 8 && plan && (
            <div>
              <div
                style={{
                  marginBottom: 14,
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid rgba(59,130,246,0.35)",
                  background: "rgba(30,58,138,0.15)",
                  fontSize: 12,
                  color: AX.text2,
                  lineHeight: 1.55,
                }}
              >
                <strong style={{ color: "#93c5fd" }}>Checklist · segnali dal piano (pre-produzione)</strong>
                <div style={{ marginTop: 6 }}>
                  Ogni voce combina il promemoria automatico con <strong>segnali reali disponibili qui</strong> (es. prompt grafico
                  personaggio, clip nel piano). Lo stato definitivo resta nell’editor Scenografie dopo la conferma.
                </div>
              </div>
              <p style={{ fontSize: 13, color: AX.text2, margin: "0 0 14px" }}>
                Stato per voce: anteprima da wizard / da fare in editor dopo il salvataggio.
              </p>
              {(plan.scenes || []).map((sc) => (
                <div key={sc.id} style={{ marginBottom: 14, borderRadius: 14, border: `1px solid ${AX.border}`, padding: 14, background: AX.card }}>
                  <div style={{ fontWeight: 800, color: AX.text, marginBottom: 8 }}>{sc.title_it}</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: AX.text2, lineHeight: 1.6 }}>
                    {(sc.storyAutoPlan?.sceneProductionChecklist || []).map((t) => {
                      const enriched = enrichWizardChecklistTaskRuntime(t, sc, plan, charGraphics);
                      const tone =
                        enriched.runtimeKind === "preview_ok"
                          ? "#6ee7b7"
                          : enriched.runtimeKind === "likely_open"
                            ? "#fbbf24"
                            : AX.muted;
                      return (
                        <li key={t.id} style={{ marginBottom: 8 }}>
                          <span style={{ color: AX.text }}>{enriched.label}</span>
                          <div style={{ fontSize: 10, color: tone, marginTop: 2 }}>
                            <strong>{enriched.statusLabel}</strong>
                            {enriched.runtimeHint ? ` — ${enriched.runtimeHint}` : ""}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Step 9 — review */}
          {step === 9 && plan && analysis && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 18 }}>
                {metricCard("Durata target", `${targetFilmDurationSec}s`, "richiesta")}
                {metricCard("Durata stimata", `${analysis.estimatedFilmDurationSec}s`, "da clip")}
                {metricCard("Scene", plan.scenes?.length, "")}
                {metricCard("Personaggi", plan.characters?.length, "")}
                {metricCard("Clip", plan.clips?.length, "")}
                {metricCard("Stile", projectStyle?.label || "—", projectStyle?.presetId)}
              </div>
              <p style={{ fontSize: 12, color: AX.text2, lineHeight: 1.55 }}>
                Dopo conferma il progetto sarà salvato come workspace Scenografie con piano approvato. Potrai generare master, scene e clip dall’editor. Nessun rendering automatico parte senza tua azione nell’editor.
              </p>
              {(plan.scenes || []).map((sc) => (
                <div key={sc.id} style={{ fontSize: 11, color: AX.muted, marginTop: 8, padding: 10, borderRadius: 10, background: AX.bg }}>
                  <strong style={{ color: AX.text2 }}>{sc.title_it}</strong> — {sc.storyAutoPlan?.sceneSuggestedClipCount ?? 0} clip (da piano) · checklist
                  con anteprima segnali: {(sc.storyAutoPlan?.sceneProductionChecklist || []).length} voci
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Scene / char edit modal simple */}
        {editScene && (
          <div style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ width: "min(440px, 100%)", background: AX.surface, borderRadius: 16, border: `1px solid ${AX.border}`, padding: 18 }}>
              {editScene.type === "char" ? (
                <>
                  <div style={{ fontWeight: 800, marginBottom: 12 }}>Modifica personaggio</div>
                  <input
                    defaultValue={editScene.char.name}
                    id="wiz-char-name"
                    style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${AX.border}`, background: AX.bg, color: AX.text, marginBottom: 10, boxSizing: "border-box" }}
                  />
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button type="button" style={btnGhost()} onClick={() => setEditScene(null)}>
                      Annulla
                    </button>
                    <button
                      type="button"
                      style={btnPrimary(false)}
                      onClick={() => {
                        const el = document.getElementById("wiz-char-name");
                        const nm = el?.value?.trim();
                        if (!nm) return;
                        const next = deepClone(plan);
                        const c = next.characters.find((x) => x.id === editScene.char.id);
                        if (c) c.name = nm;
                        setPlan(enrichPlanWithAutoPreproduction(next, targetFilmDurationSec));
                        setEditScene(null);
                      }}
                    >
                      Salva
                    </button>
                  </div>
                </>
              ) : editScene.type === "scene" ? (
                <>
                  <div style={{ fontWeight: 800, marginBottom: 12 }}>Modifica scena</div>
                  <label style={{ fontSize: 12, color: AX.text2, display: "block", marginBottom: 8 }}>
                    Titolo
                    <input
                      id="wiz-sc-title"
                      defaultValue={editScene.scene.title_it}
                      style={{ display: "block", width: "100%", marginTop: 4, padding: 10, borderRadius: 10, border: `1px solid ${AX.border}`, background: AX.bg, color: AX.text, boxSizing: "border-box" }}
                    />
                  </label>
                  <label style={{ fontSize: 12, color: AX.text2, display: "block", marginBottom: 8 }}>
                    Riassunto
                    <textarea
                      id="wiz-sc-sum"
                      defaultValue={editScene.scene.summary_it}
                      rows={3}
                      style={{ display: "block", width: "100%", marginTop: 4, padding: 10, borderRadius: 10, border: `1px solid ${AX.border}`, background: AX.bg, color: AX.text, boxSizing: "border-box" }}
                    />
                  </label>
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
                    <button type="button" style={btnGhost()} onClick={() => setEditScene(null)}>
                      Annulla
                    </button>
                    <button
                      type="button"
                      style={btnPrimary(false)}
                      onClick={() => {
                        const tEl = document.getElementById("wiz-sc-title");
                        const sEl = document.getElementById("wiz-sc-sum");
                        const next = deepClone(plan);
                        const s = next.scenes.find((x) => x.id === editScene.scene.id);
                        if (s) {
                          s.title_it = tEl?.value?.trim() || s.title_it;
                          s.summary_it = sEl?.value?.trim() || s.summary_it;
                        }
                        setPlan(enrichPlanWithAutoPreproduction(next, targetFilmDurationSec));
                        setEditScene(null);
                      }}
                    >
                      Salva
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}

        <div
          style={{
            padding: "16px 24px 20px",
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
            flexShrink: 0,
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {step > 1 && step !== 2 && (
            <button
              type="button"
              style={{ ...btnSecondaryFooter, display: "inline-flex", alignItems: "center", gap: 8, cursor: busy ? "not-allowed" : "pointer" }}
              disabled={busy}
              onClick={() => setStep((s) => Math.max(1, s - 1))}
            >
              <HiArrowLeft /> Indietro
            </button>
          )}
          {step === 2 && (
            <button
              type="button"
              style={{ ...btnSecondaryFooter, display: "inline-flex", alignItems: "center", gap: 8, cursor: busy ? "not-allowed" : "pointer" }}
              disabled={busy}
              onClick={() => setStep(1)}
            >
              <HiArrowLeft /> Torna allo step 1
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" style={{ ...btnSecondaryFooter, cursor: busy ? "not-allowed" : "pointer" }} disabled={busy} onClick={saveDraft}>
            Salva bozza
          </button>
          {step === 1 && (
            <button
              type="button"
              style={{
                ...btnPrimaryFooter(busy || !title.trim() || !storyPrompt.trim()),
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
              disabled={busy || !title.trim() || !storyPrompt.trim()}
              onClick={runAnalyze}
            >
              <HiSparkles /> Analizza storia
            </button>
          )}
          {step === 2 && (
            <>
              <button
                type="button"
                style={{ ...btnSecondaryFooter, display: "inline-flex", alignItems: "center", gap: 8, cursor: busy || !plan ? "not-allowed" : "pointer" }}
                disabled={busy || !plan}
                onClick={runRegenerateAnalysis}
              >
                <HiArrowPath /> Rigenera analisi
              </button>
              <button type="button" style={btnPrimaryFooter(!plan || busy)} disabled={!plan || busy} onClick={() => setStep(3)}>
                Accetta analisi
              </button>
            </>
          )}
          {step >= 3 && step < 9 && (
            <button type="button" style={btnPrimaryFooter(busy)} disabled={busy} onClick={() => setStep((s) => s + 1)}>
              Continua <HiChevronRight />
            </button>
          )}
          {step === 9 && (
            <>
              <button type="button" style={{ ...btnSecondaryFooter, cursor: busy ? "not-allowed" : "pointer" }} disabled={busy} onClick={() => setStep(8)}>
                Modifica
              </button>
              <button type="button" style={btnPrimaryFooter(busy)} disabled={busy} onClick={() => commitWorkspace(false)}>
                Conferma progetto
              </button>
              <button
                type="button"
                style={btnPrimaryFooter(busy)}
                disabled={busy}
                onClick={() => commitWorkspace(true)}
                title="Apre il workspace con solo la prima scena selezionata per batch mirato"
              >
                Conferma e avvia prima scena
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
