/**
 * Clip Builder — workflow produzione clip video (Scenografie / AXSTUDIO).
 * Solo UI + patch sul modello persistito; motore generazione da integrare.
 */

import React, { useMemo, useState, useCallback } from "react";
import {
  HiXMark,
  HiFilm,
  HiChatBubbleLeftRight,
  HiUser,
  HiMap,
  HiClock,
  HiMusicalNote,
  HiSparkles,
  HiChevronLeft,
  HiChevronRight,
} from "react-icons/hi2";
import {
  CLIP_TYPE,
  NARRATED_CAMERA_PRESETS,
  DIALOGUE_CAMERA_BEHAVIORS,
  ELEVENLABS_VOICE_PRESETS,
  estimateClipDurationAuto,
  resolveClipDurationSeconds,
  getClipGenerationReadiness,
  normalizeDialogLine,
  normalizeNarratorVoice,
  normalizeCharacterVoiceMaster,
  SCENE_VIDEO_CLIP_STATUS,
} from "../services/scenografieVideoWorkflow.js";
import { resolveElevenLabsVoiceId } from "../services/elevenlabsService.js";
import { stableCharacterKey, voiceMasterRawForRef } from "../services/scenografiePcidLookup.js";

const STEPS = [
  { n: 1, key: "type", label: "Tipo clip", icon: HiFilm },
  { n: 2, key: "scene", label: "Scena", icon: HiMap },
  { n: 3, key: "audio", label: "Audio", icon: HiChatBubbleLeftRight },
  { n: 4, key: "duration", label: "Durata & regia", icon: HiClock },
  { n: 5, key: "bed", label: "Musica & ambiente", icon: HiMusicalNote },
  { n: 6, key: "gen", label: "Generazione", icon: HiSparkles },
];

function charById(plan) {
  const m = new Map();
  for (const c of plan?.characters || []) {
    if (!c) continue;
    const lid = String(c.id || "").trim();
    if (lid) m.set(lid, c);
    const p = String(c.pcid || "").trim();
    if (p) m.set(p, c);
  }
  return m;
}

function sceneById(plan, sceneId) {
  return (plan?.scenes || []).find((s) => s.id === sceneId) || null;
}

function charactersPresentInScene(plan, sceneId) {
  const sc = sceneById(plan, sceneId);
  if (!sc) return [];
  const ids = Array.isArray(sc.characters_present) ? sc.characters_present : [];
  const cmap = charById(plan);
  return ids.map((id) => cmap.get(id)).filter(Boolean);
}

/** Allinea battute legacy (`char_N`) al ref stabile (`pcid_…`) per `<select controlled>`. */
function resolveLineCharacterRef(charList, lineCharacterId) {
  const raw = String(lineCharacterId || "").trim();
  if (!raw) return "";
  const list = Array.isArray(charList) ? charList : [];
  const match = list.find((c) => stableCharacterKey(c) === raw || String(c.id || "").trim() === raw);
  return match ? stableCharacterKey(match) : raw;
}

function fieldLabel() {
  return { fontSize: 10, fontWeight: 700, color: "#6b6b80", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 };
}

function cardPad() {
  return { padding: 14, borderRadius: 12, border: "1px solid #23232e", background: "#13131a" };
}

/** Campi salvati ma non ancora inviati a ElevenLabs / Kling in questa versione. */
function futurePrepShell(ax, title, hint, children) {
  return (
    <div
      style={{
        ...cardPad(),
        borderStyle: "dashed",
        borderColor: ax.border,
        opacity: 0.92,
      }}
    >
      <div style={{ ...fieldLabel(), color: ax.muted }}>{title}</div>
      <p style={{ fontSize: 11, color: ax.muted, marginBottom: 12, lineHeight: 1.55 }}>{hint}</p>
      {children}
    </div>
  );
}

export function ScenografieClipBuilder({
  ax,
  plan,
  sceneResults = [],
  approvedScenes,
  characterVoiceMasters,
  onVoiceMasterPatch,
  clip,
  onPatch,
  onClose,
  pipelineLocked,
  pipelineBusy = false,
  pipelineStage = null,
  onRequestGenerate,
  onMarkNeedsReview,
}) {
  const [step, setStep] = useState(1);
  const cmap = useMemo(() => charById(plan), [plan]);
  const scene = clip?.sceneId ? sceneById(plan, clip.sceneId) : null;
  const presentChars = useMemo(() => charactersPresentInScene(plan, clip?.sceneId), [plan, clip?.sceneId]);
  const autoSec = clip ? estimateClipDurationAuto(clip) : 0;
  const effectiveDur = clip ? resolveClipDurationSeconds(clip) : null;
  const readiness = clip
    ? getClipGenerationReadiness(clip, { characterVoiceMasters, plan, sceneResults })
    : { ok: false, reasons: [] };

  const patch = useCallback((p) => onPatch(p), [onPatch]);

  const voiceOptions = ELEVENLABS_VOICE_PRESETS;

  const setClipType = (clipType) => {
    if (clipType === CLIP_TYPE.DIALOGUE) {
      const lines = (clip.dialogLines || []).length
        ? clip.dialogLines
        : presentChars.slice(0, 1).map((c) => {
            const ref = stableCharacterKey(c);
            const rawVm = voiceMasterRawForRef(characterVoiceMasters, ref, plan);
            return normalizeDialogLine({
              characterId: ref,
              text: "",
              voiceId: rawVm?.voiceId || "",
              action: "",
              expression: "",
              bodyMovement: "",
            });
          });
      patch({
        clipType: CLIP_TYPE.DIALOGUE,
        dialogLines: lines || [],
        dialogFirstSpeakerId: presentChars[0] ? stableCharacterKey(presentChars[0]) : "",
      });
    } else {
      patch({
        clipType: CLIP_TYPE.NARRATED,
        dialogLines: [],
        dialogFirstSpeakerId: "",
        dialogLineOrder: [],
      });
    }
  };

  const addDialogLine = () => {
    const pool = presentChars.length ? presentChars : plan?.characters || [];
    const c0 = pool[0];
    if (!c0) return;
    const ref0 = stableCharacterKey(c0);
    const rawVm = voiceMasterRawForRef(characterVoiceMasters, ref0, plan);
    const next = [
      ...(clip.dialogLines || []),
      normalizeDialogLine({
        characterId: ref0,
        text: "",
        voiceId: rawVm?.voiceId || "",
        action: "",
        expression: "",
        bodyMovement: "",
      }),
    ].filter(Boolean);
    patch({ dialogLines: next });
  };

  const updateLine = (idx, partial) => {
    const lines = [...(clip.dialogLines || [])].map((L) => ({ ...L }));
    const cur = normalizeDialogLine({ ...lines[idx], ...partial });
    if (!cur) return;
    lines[idx] = cur;
    patch({ dialogLines: lines });
  };

  const removeLine = (idx) => {
    const lines = (clip.dialogLines || []).filter((_, i) => i !== idx);
    patch({ dialogLines: lines });
  };

  const moveLine = (idx, dir) => {
    const lines = [...(clip.dialogLines || [])];
    const j = idx + dir;
    if (j < 0 || j >= lines.length) return;
    [lines[idx], lines[j]] = [lines[j], lines[idx]];
    patch({ dialogLines: lines, dialogLineOrder: lines.map((l) => l.characterId) });
  };

  if (!clip) return null;

  const stepMeta = STEPS.find((s) => s.n === step) || STEPS[0];
  const StepIcon = stepMeta.icon;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="clip-builder-title"
      className="ax-modal-touch-lock"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        background: "rgba(6,6,12,0.72)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(720px, 100%)",
          maxHeight: "min(92vh, 900px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          borderRadius: 16,
          border: `1px solid ${ax.border}`,
          background: ax.card,
          boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: `1px solid ${ax.border}`,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: ax.surface,
              border: `1px solid ${ax.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: ax.electric,
            }}
          >
            <StepIcon size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="clip-builder-title" style={{ fontSize: 15, fontWeight: 800, color: ax.text, letterSpacing: "-0.02em" }}>
              Clip Builder
            </div>
            <div style={{ fontSize: 11, color: ax.muted, marginTop: 2 }}>
              Passo {step}/6 · {stepMeta.label}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: 8,
              borderRadius: 10,
              border: `1px solid ${ax.border}`,
              background: ax.surface,
              color: ax.text2,
              cursor: "pointer",
            }}
            aria-label="Chiudi"
          >
            <HiXMark size={20} />
          </button>
        </div>

        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${ax.border}`, background: ax.surface, flexShrink: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {STEPS.map((s) => {
              const active = s.n === step;
              const Ico = s.icon;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStep(s.n)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: active ? `1px solid ${ax.electric}` : `1px solid ${ax.border}`,
                    background: active ? "rgba(41,182,255,0.12)" : "transparent",
                    color: active ? ax.electric : ax.text2,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  <Ico size={14} />
                  {s.n}. {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="ax-modal-scroll-y" style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {/* Step 1 */}
          {step === 1 && (
            <div style={{ ...cardPad() }}>
              <div style={fieldLabel()}>Tipo di clip</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setClipType(CLIP_TYPE.NARRATED)}
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    border: clip.clipType !== CLIP_TYPE.DIALOGUE ? `2px solid ${ax.electric}` : `1px solid ${ax.border}`,
                    background: clip.clipType !== CLIP_TYPE.DIALOGUE ? "rgba(41,182,255,0.08)" : ax.bg,
                    color: ax.text,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>Narrato</div>
                  <div style={{ fontSize: 12, color: ax.text2, lineHeight: 1.45 }}>Voce fuori campo: narratore, nessun dialogo diretto dei personaggi.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setClipType(CLIP_TYPE.DIALOGUE)}
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    border: clip.clipType === CLIP_TYPE.DIALOGUE ? `2px solid ${ax.violet}` : `1px solid ${ax.border}`,
                    background: clip.clipType === CLIP_TYPE.DIALOGUE ? "rgba(123,77,255,0.1)" : ax.bg,
                    color: ax.text,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>Dialogato</div>
                  <div style={{ fontSize: 12, color: ax.text2, lineHeight: 1.45 }}>
                    V1 single-voice: battute unite in un solo audio ElevenLabs. Multi-speaker reale in arrivo.
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div style={{ ...cardPad() }}>
              <div style={fieldLabel()}>Scena sorgente (approvata)</div>
              <select
                value={clip.sceneId || ""}
                onChange={(e) => patch({ sceneId: e.target.value })}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${ax.border}`,
                  background: ax.bg,
                  color: ax.text,
                  fontSize: 13,
                }}
              >
                <option value="">— Seleziona scena —</option>
                {(approvedScenes || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title_it || s.id}
                  </option>
                ))}
              </select>
              {scene && (
                <p style={{ fontSize: 12, color: ax.text2, marginTop: 10, lineHeight: 1.5 }}>
                  Personaggi in scena:{" "}
                  <strong style={{ color: ax.text }}>
                    {presentChars.map((c) => c.name).join(", ") || "—"}
                  </strong>
                </p>
              )}
            </div>
          )}

          {/* Step 3 — audio */}
          {step === 3 && clip.clipType !== CLIP_TYPE.DIALOGUE && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Testo narratore</div>
                <textarea
                  value={clip.narratorText || ""}
                  onChange={(e) => patch({ narratorText: e.target.value })}
                  rows={5}
                  placeholder="Testo letto dal narratore…"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    borderRadius: 10,
                    border: `1px solid ${ax.border}`,
                    background: ax.bg,
                    color: ax.text,
                    fontSize: 13,
                    padding: 10,
                    resize: "vertical",
                  }}
                />
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Voce narratore (ElevenLabs)</div>
                <p style={{ fontSize: 11, color: ax.muted, marginBottom: 8, lineHeight: 1.45 }}>
                  Preset sintetici richiedono voice ID reali in .env (<code style={{ fontSize: 10 }}>REACT_APP_SCENO_EL_VOICE_*</code>) oppure incolla un voice ID dalla dashboard ElevenLabs.
                </p>
                <select
                  value={clip.narratorVoice?.voiceId || ""}
                  onChange={(e) => {
                    const v = voiceOptions.find((x) => x.voiceId === e.target.value);
                    patch({
                      narratorVoice: normalizeNarratorVoice({
                        voiceId: e.target.value,
                        voiceLabel: v?.label || "",
                        voiceProvider: v?.provider || "elevenlabs",
                      }),
                    });
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: `1px solid ${ax.border}`,
                    background: ax.bg,
                    color: ax.text,
                    fontSize: 13,
                  }}
                >
                  <option value="">— Voce —</option>
                  {voiceOptions.map((v) => (
                    <option key={v.voiceId} value={v.voiceId}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {step === 3 && clip.clipType === CLIP_TYPE.DIALOGUE && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                style={{
                  ...cardPad(),
                  borderColor: ax.violet,
                  background: "rgba(123,77,255,0.06)",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 800, color: ax.violet, letterSpacing: "0.04em", marginBottom: 6 }}>
                  Dialogo · versione attuale (V1)
                </div>
                <p style={{ fontSize: 12, color: ax.text2, lineHeight: 1.55, margin: 0 }}>
                  Il motore genera <strong style={{ color: ax.text }}>un solo file audio</strong> con{" "}
                  <strong style={{ color: ax.text }}>una sola voce ElevenLabs</strong> (voice master per personaggio —
                  stesso ID per tutti i parlanti). Le battute sono unite in ordine; non c&apos;è ancora multi-speaker né
                  cambio voce per battuta nel rendering.
                </p>
              </div>
              <div style={{ ...cardPad(), display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: ax.text }}>Battute</span>
                <button
                  type="button"
                  onClick={addDialogLine}
                  disabled={pipelineLocked || !clip.sceneId}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: `1px solid ${ax.violet}`,
                    background: "transparent",
                    color: ax.violet,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: pipelineLocked ? "not-allowed" : "pointer",
                  }}
                >
                  + Battuta
                </button>
              </div>
              {(clip.dialogLines || []).length === 0 && (
                <div style={{ fontSize: 12, color: ax.muted }}>Aggiungi almeno una battuta. I personaggi suggeriti provengono dalla scena.</div>
              )}
              {(clip.dialogLines || []).map((line, idx) => {
                const charList = presentChars.length ? presentChars : plan?.characters || [];
                const lineRef = resolveLineCharacterRef(charList, line.characterId);
                return (
                  <div key={line.id || idx} style={cardPad()}>
                    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: ax.magenta }}>Battuta {idx + 1}</span>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button type="button" disabled={idx === 0} onClick={() => moveLine(idx, -1)} style={miniBtn(ax)}>
                          <HiChevronLeft size={14} />
                        </button>
                        <button
                          type="button"
                          disabled={idx >= (clip.dialogLines || []).length - 1}
                          onClick={() => moveLine(idx, 1)}
                          style={miniBtn(ax)}
                        >
                          <HiChevronRight size={14} />
                        </button>
                        <button type="button" onClick={() => removeLine(idx)} style={{ ...miniBtn(ax), color: "#f87171" }}>
                          Rimuovi
                        </button>
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr" }}>
                      <div>
                        <div style={fieldLabel()}>Personaggio</div>
                        <select
                          value={lineRef}
                          onChange={(e) => {
                            const cid = e.target.value;
                            const rawVm = voiceMasterRawForRef(characterVoiceMasters, cid, plan);
                            updateLine(idx, {
                              characterId: cid,
                              voiceId: rawVm?.voiceId || "",
                            });
                          }}
                          style={selectStyle(ax)}
                        >
                          {charList.map((c) => (
                            <option key={c.id} value={stableCharacterKey(c)}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div style={{ fontSize: 11, color: ax.muted, lineHeight: 1.45 }}>
                        Voce TTS: solo la{" "}
                        <strong style={{ color: ax.text2 }}>voice master</strong> di questo personaggio (step 6 o
                        scheda personaggio). Il menu voce per battuta non è usato dal motore in V1.
                        {(() => {
                          const vm = normalizeCharacterVoiceMaster(
                            voiceMasterRawForRef(characterVoiceMasters, line.characterId, plan),
                            line.characterId,
                          );
                          const r = resolveElevenLabsVoiceId(vm.voiceId);
                          if (!vm.voiceId) return <span> · Voice master non impostata.</span>;
                          if (!r.voiceId) return <span> · Preset / ID da completare (.env o ID ElevenLabs).</span>;
                          return (
                            <span>
                              {" "}
                              · Risolta: <span style={{ color: ax.text2 }}>{r.voiceId.slice(0, 12)}…</span>
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <div style={fieldLabel()}>Testo</div>
                      <textarea
                        value={line.text}
                        onChange={(e) => updateLine(idx, { text: e.target.value })}
                        rows={2}
                        style={{ ...selectStyle(ax), width: "100%", resize: "vertical", minHeight: 52 }}
                      />
                    </div>
                    {futurePrepShell(
                      ax,
                      "Azione · espressione · movimento (preparazione)",
                      "Salvato nel progetto per roadmap; non inviato a ElevenLabs / Kling in V1.",
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                        <div>
                          <div style={fieldLabel()}>Azione</div>
                          <input
                            value={line.action}
                            onChange={(e) => updateLine(idx, { action: e.target.value })}
                            style={selectStyle(ax)}
                            placeholder="Opzionale"
                          />
                        </div>
                        <div>
                          <div style={fieldLabel()}>Espressione</div>
                          <input
                            value={line.expression}
                            onChange={(e) => updateLine(idx, { expression: e.target.value })}
                            style={selectStyle(ax)}
                            placeholder="Opzionale"
                          />
                        </div>
                        <div>
                          <div style={fieldLabel()}>Movimento corpo</div>
                          <input
                            value={line.bodyMovement}
                            onChange={(e) => updateLine(idx, { bodyMovement: e.target.value })}
                            style={selectStyle(ax)}
                            placeholder="Opzionale"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Step 4 */}
          {step === 4 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Durata</div>
                <div style={{ fontSize: 12, color: ax.text2, marginBottom: 8 }}>
                  Stima automatica: <strong style={{ color: ax.electric }}>{autoSec > 0 ? `${autoSec}s` : "—"}</strong>
                  {clip.durationMode === "manual" && effectiveDur != null && (
                    <span style={{ marginLeft: 10 }}>
                      Manuale: <strong style={{ color: ax.text }}>{effectiveDur}s</strong>
                    </span>
                  )}
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: ax.text2, marginBottom: 8 }}>
                  <input
                    type="radio"
                    checked={clip.durationMode !== "manual"}
                    onChange={() => patch({ durationMode: "auto", durationSeconds: null })}
                  />
                  Automatica (da testo / battute)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: ax.text2, marginBottom: 10 }}>
                  <input
                    type="radio"
                    checked={clip.durationMode === "manual"}
                    onChange={() =>
                      patch({
                        durationMode: "manual",
                        durationSeconds: effectiveDur ?? Math.max(3, autoSec || 3),
                      })
                    }
                  />
                  Override manuale (secondi)
                </label>
                {clip.durationMode === "manual" && (
                  <input
                    type="number"
                    min={3}
                    step={0.5}
                    value={clip.durationSeconds ?? ""}
                    onChange={(e) => patch({ durationSeconds: parseFloat(e.target.value) || null })}
                    style={{ ...selectStyle(ax), maxWidth: 160 }}
                  />
                )}
              </div>

              {clip.clipType !== CLIP_TYPE.DIALOGUE
                ? futurePrepShell(
                    ax,
                    "Movimento / regia clip (preparazione)",
                    "Valore salvato nel progetto; Kling Avatar v2 Pro oggi usa solo immagine scena + audio — questi controlli non modificano ancora il video generato.",
                    <div>
                      <div style={fieldLabel()}>Preset movimento (roadmap)</div>
                      <select
                        value={clip.clipCameraPreset || "slow_zoom"}
                        onChange={(e) => patch({ clipCameraPreset: e.target.value })}
                        style={selectStyle(ax)}
                      >
                        {NARRATED_CAMERA_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                : futurePrepShell(
                    ax,
                    "Regia dialogo (preparazione)",
                    "Salvato nel progetto; il motore V1 non invia primo speaker, camera, mood o intensità a ElevenLabs / Kling.",
                    <div>
                      <div style={fieldLabel()}>Chi parla per primo (roadmap)</div>
                      <select
                        value={resolveLineCharacterRef(
                          presentChars.length ? presentChars : plan?.characters || [],
                          clip.dialogFirstSpeakerId,
                        )}
                        onChange={(e) => patch({ dialogFirstSpeakerId: e.target.value })}
                        style={{ ...selectStyle(ax), marginBottom: 12 }}
                      >
                        <option value="">— Primo speaker —</option>
                        {(clip.dialogLines || []).map((l) => {
                          const ch = cmap.get(l.characterId);
                          const v = ch ? stableCharacterKey(ch) : resolveLineCharacterRef(plan?.characters || [], l.characterId);
                          return (
                            <option key={`${l.id}-first`} value={v}>
                              {ch?.name || l.characterId}
                            </option>
                          );
                        })}
                      </select>
                      <div style={fieldLabel()}>Camera behavior (roadmap)</div>
                      <select
                        value={clip.cameraDirection || "over_shoulder"}
                        onChange={(e) => patch({ cameraDirection: e.target.value })}
                        style={{ ...selectStyle(ax), marginBottom: 12 }}
                      >
                        {DIALOGUE_CAMERA_BEHAVIORS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div>
                          <div style={fieldLabel()}>Mood (roadmap)</div>
                          <input
                            value={clip.mood || ""}
                            onChange={(e) => patch({ mood: e.target.value })}
                            style={selectStyle(ax)}
                            placeholder="es. teso, intimo…"
                          />
                        </div>
                        <div>
                          <div style={fieldLabel()}>Intensità (roadmap)</div>
                          <select
                            value={clip.emotionalIntensity || "medium"}
                            onChange={(e) => patch({ emotionalIntensity: e.target.value })}
                            style={selectStyle(ax)}
                          >
                            <option value="low">Bassa</option>
                            <option value="medium">Media</option>
                            <option value="high">Alta</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
            </div>
          )}

          {/* Step 5 */}
          {step === 5 && (
            <div style={cardPad()}>
              <div style={fieldLabel()}>Audio aggiuntivi</div>
              <p style={{ fontSize: 11, color: ax.muted, marginBottom: 12, lineHeight: 1.55 }}>
                Opzioni salvate nel progetto per il futuro mix / export. <strong style={{ color: ax.text2 }}>Non</strong>{" "}
                influenzano ancora la generazione ElevenLabs → Kling di questa versione.
              </p>
              <label style={rowToggle(ax)}>
                <input
                  type="checkbox"
                  checked={!!clip.backgroundMusicEnabled}
                  onChange={(e) => patch({ backgroundMusicEnabled: e.target.checked })}
                />
                Musica di sottofondo
              </label>
              <label style={rowToggle(ax)}>
                <input
                  type="checkbox"
                  checked={!!clip.ambientSoundEnabled}
                  onChange={(e) => patch({ ambientSoundEnabled: e.target.checked })}
                />
                Suono ambiente
              </label>
              <label style={rowToggle(ax)}>
                <input
                  type="checkbox"
                  checked={!!clip.effectsEnabled}
                  onChange={(e) => patch({ effectsEnabled: e.target.checked })}
                />
                Effetti sonori
              </label>
            </div>
          )}

          {/* Step 6 */}
          {step === 6 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Titolo clip (progetto)</div>
                <input
                  value={clip.title || ""}
                  onChange={(e) => patch({ title: e.target.value, label: e.target.value })}
                  style={selectStyle(ax)}
                  placeholder="es. Ingresso in casa — VO"
                />
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Voice master personaggi (ElevenLabs)</div>
                <p style={{ fontSize: 11, color: ax.muted, marginBottom: 10, lineHeight: 1.45 }}>
                  Obbligatorio per clip <strong style={{ color: ax.text }}>dialogato V1</strong> (stesso voice ID per tutti i
                  parlanti). Per narrato si usa la voce del narratore allo step 3.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {(plan?.characters || []).map((c) => {
                    const ref = stableCharacterKey(c);
                    const vm = normalizeCharacterVoiceMaster(voiceMasterRawForRef(characterVoiceMasters, ref, plan), ref);
                    return (
                      <div
                        key={c.id}
                        style={{
                          padding: 10,
                          borderRadius: 10,
                          border: `1px solid ${ax.border}`,
                          background: ax.bg,
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr auto",
                          gap: 8,
                          alignItems: "end",
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700, color: ax.text, gridColumn: "1 / -1" }}>
                          <HiUser size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                          {c.name}
                        </div>
                        <div>
                          <div style={fieldLabel()}>Voce</div>
                          <select
                            value={vm.voiceId || ""}
                            onChange={(e) => {
                              const v = voiceOptions.find((x) => x.voiceId === e.target.value);
                              onVoiceMasterPatch(c.id, {
                                voiceId: e.target.value,
                                voiceLabel: v?.label || "",
                                voiceProvider: "elevenlabs",
                              });
                            }}
                            style={selectStyle(ax)}
                          >
                            <option value="">— Non impostata —</option>
                            {voiceOptions.map((v) => (
                              <option key={v.voiceId} value={v.voiceId}>
                                {v.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <div style={fieldLabel()}>Label / id custom</div>
                          <input
                            value={vm.voiceLabel || ""}
                            onChange={(e) => onVoiceMasterPatch(c.id, { voiceLabel: e.target.value })}
                            style={selectStyle(ax)}
                            placeholder="Opzionale"
                          />
                        </div>
                        <label style={{ ...rowToggle(ax), marginBottom: 4 }}>
                          <input
                            type="checkbox"
                            checked={vm.isNarratorDefault}
                            onChange={(e) => onVoiceMasterPatch(c.id, { isNarratorDefault: e.target.checked })}
                          />
                          Default narratore
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>

              {!readiness.ok && (
                <div style={{ ...cardPad(), borderColor: "rgba(248,113,113,0.35)" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#fca5a5", marginBottom: 6 }}>Completare per generare</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: ax.text2, lineHeight: 1.55 }}>
                    {readiness.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {clip.lastGenerationError && clip.status === SCENE_VIDEO_CLIP_STATUS.FAILED && (
                <div style={{ ...cardPad(), borderColor: "rgba(248,113,113,0.35)" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#fca5a5", marginBottom: 6 }}>Ultimo errore</div>
                  <div style={{ fontSize: 12, color: ax.text2, lineHeight: 1.5 }}>{clip.lastGenerationError}</div>
                </div>
              )}

              {pipelineBusy && (
                <div
                  style={{
                    ...cardPad(),
                    borderColor: `rgba(41,182,255,0.35)`,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: 18 }} aria-hidden>
                    ⏳
                  </span>
                  <div style={{ fontSize: 13, fontWeight: 700, color: ax.electric }}>
                    {pipelineStage === "video"
                      ? "fal.ai · Kling Avatar v2 Pro (video)…"
                      : pipelineStage === "done"
                        ? "Completamento…"
                        : "ElevenLabs · sintesi audio…"}
                  </div>
                </div>
              )}

              {clip.videoUrl && clip.status === SCENE_VIDEO_CLIP_STATUS.READY_FOR_REVIEW && (
                <div style={cardPad()}>
                  <div style={fieldLabel()}>Anteprima video</div>
                  <video
                    src={clip.videoUrl}
                    controls
                    style={{ width: "100%", maxHeight: 220, borderRadius: 10, background: "#000" }}
                  />
                </div>
              )}

              <button
                type="button"
                disabled={pipelineLocked || pipelineBusy || !readiness.ok}
                onClick={() => {
                  void onRequestGenerate();
                }}
                title={
                  pipelineBusy
                    ? "Generazione in corso…"
                    : readiness.ok
                      ? "Avvia la pipeline reale: ElevenLabs (TTS) → caricamento fal → Kling Avatar v2 Pro"
                      : readiness.reasons.join(" · ")
                }
                style={{
                  padding: "12px 16px",
                  borderRadius: 12,
                  border: "none",
                  background: readiness.ok && !pipelineBusy ? ax.gradPrimary : ax.border,
                  color: readiness.ok && !pipelineBusy ? "#fff" : ax.muted,
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: pipelineLocked || pipelineBusy || !readiness.ok ? "not-allowed" : "pointer",
                  opacity: pipelineLocked ? 0.5 : 1,
                }}
              >
                Genera clip
              </button>
              <p style={{ fontSize: 11, color: ax.text2, lineHeight: 1.45, marginTop: 8, marginBottom: 0 }}>
                Genera <strong style={{ color: ax.text }}>audio e video</strong> del clip (chiamate reali a ElevenLabs e fal.ai). Serve{" "}
                <code style={{ fontSize: 10 }}>REACT_APP_ELEVENLABS_API_KEY</code> e <code style={{ fontSize: 10 }}>REACT_APP_FAL_API_KEY</code>.
              </p>

              <div style={cardPad()}>
                <div style={fieldLabel()}>Prompt integrativo (opzionale)</div>
                <textarea
                  value={clip.lastEditPrompt || ""}
                  onChange={(e) => patch({ lastEditPrompt: e.target.value || null })}
                  rows={2}
                  placeholder="Note per il team / roadmap (oggi non inviate al motore automaticamente)"
                  style={{ ...selectStyle(ax), width: "100%" }}
                />
                {typeof onMarkNeedsReview === "function" && (
                  <button
                    type="button"
                    disabled={pipelineLocked || !String(clip.lastEditPrompt || "").trim() || clip.status === SCENE_VIDEO_CLIP_STATUS.DELETED}
                    onClick={onMarkNeedsReview}
                    style={{
                      marginTop: 10,
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: `1px solid ${ax.violet}`,
                      background: "transparent",
                      color: ax.violet,
                      fontWeight: 700,
                      fontSize: 11,
                      cursor: pipelineLocked ? "not-allowed" : "pointer",
                    }}
                  >
                    Segna come da rivedere
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            padding: "12px 16px",
            borderTop: `1px solid ${ax.border}`,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            justifyContent: "space-between",
            flexShrink: 0,
            background: ax.surface,
          }}
        >
          <button type="button" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step <= 1} style={ghostSm(ax)}>
            Indietro
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {step < 6 && (
              <button type="button" onClick={() => setStep((s) => Math.min(6, s + 1))} style={primarySm(ax)}>
                Avanti
              </button>
            )}
            <button type="button" onClick={onClose} style={primarySm(ax)}>
              Chiudi
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function miniBtn(ax) {
  return {
    padding: "4px 8px",
    borderRadius: 8,
    border: `1px solid ${ax.border}`,
    background: ax.bg,
    color: ax.text2,
    fontSize: 10,
    fontWeight: 700,
    cursor: "pointer",
  };
}

function selectStyle(ax) {
  return {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 10,
    border: `1px solid ${ax.border}`,
    background: ax.bg,
    color: ax.text,
    fontSize: 12,
    boxSizing: "border-box",
  };
}

function rowToggle(ax) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 12,
    color: ax.text2,
    marginBottom: 8,
    cursor: "pointer",
  };
}

function primarySm(ax) {
  return {
    padding: "8px 14px",
    borderRadius: 10,
    border: "none",
    background: ax.gradPrimary,
    color: "#fff",
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer",
  };
}

function ghostSm(ax) {
  return {
    padding: "8px 14px",
    borderRadius: 10,
    border: `1px solid ${ax.border}`,
    background: "transparent",
    color: ax.text2,
    fontWeight: 600,
    fontSize: 12,
    cursor: "pointer",
  };
}
