/**
 * Clip Builder — wizard produzione clip video (Scenografie / AXSTUDIO).
 * UI a 7 step + modello persistito esteso; motore usa oggi audio/testo; campi creativi pronti per pipeline.
 */

import React, { useMemo, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  HiXMark,
  HiFilm,
  HiUser,
  HiMap,
  HiClock,
  HiMusicalNote,
  HiSparkles,
  HiChevronLeft,
  HiChevronRight,
  HiBookOpen,
  HiSpeakerWave,
  HiVideoCamera,
  HiClipboardDocumentCheck,
} from "react-icons/hi2";
import {
  CLIP_TYPE,
  NARRATED_CAMERA_PRESETS,
  DIALOGUE_CAMERA_BEHAVIORS,
  estimateClipDurationAuto,
  resolveClipDurationSeconds,
  getClipGenerationReadiness,
  normalizeDialogLine,
  normalizeNarratorVoice,
  normalizeCharacterVoiceMaster,
  SCENE_VIDEO_CLIP_STATUS,
  CLIP_OPENING_STYLES,
  CLIP_CLOSING_STYLES,
  CLIP_CAMERA_INTENSITY,
  CLIP_FOCUS_SUBJECT,
  CLIP_MUSIC_MOOD,
  CLIP_AMBIENT_PRESET,
  CLIP_ENERGY_LEVEL,
  CLIP_NARRATOR_TONE,
  CLIP_NARRATOR_PACE,
  CLIP_NARRATOR_PAUSES,
  CLIP_DIALOGUE_TONE,
  buildClipStructuredPrompts,
} from "../services/scenografieVideoWorkflow.js";
import { compileClipDirectorBundle, directorCompiledPayloadEqual } from "../services/directorEngine.js";
import { compileAudioDesignBundle, audioDesignBundleContentEqual } from "../services/audioDesignEngine.js";
import { planCharacterDisplayName, stableCharacterKey, voiceMasterRawForRef } from "../services/scenografiePcidLookup.js";
import { compileClipExecutionPreview } from "../services/executionPromptCompiler.js";
import { buildDialogueTtsText } from "../services/videoClipPipeline.js";
import { resolveNarratedClipNarrator } from "../services/scenografieProjectNarrators.js";
import { resolveElevenLabsVoiceId } from "../services/elevenlabsService.js";
import { SUGGESTED_ACTION_LABEL_IT } from "../services/scenografieConsumerReliability.js";
import { ScenografieCharacterVoicePicker } from "./ScenografieCharacterVoicePicker.js";
import { narratedClipNarratorControlValue, CLIP_EMBEDDED, PROJECT_DEFAULT } from "./ScenografieNarratorSection.js";

const STEPS = [
  { n: 1, key: "type", label: "Tipo & scena", icon: HiFilm },
  { n: 2, key: "content", label: "Contenuto", icon: HiBookOpen },
  { n: 3, key: "audio", label: "Audio e voce", icon: HiSpeakerWave },
  { n: 4, key: "duration", label: "Durata e regia", icon: HiClock },
  { n: 5, key: "bed", label: "Musica e atmosfera", icon: HiMusicalNote },
  { n: 6, key: "direction", label: "Prompt regia", icon: HiVideoCamera },
  { n: 7, key: "gen", label: "Generazione", icon: HiClipboardDocumentCheck },
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

function optionLabel(list, id) {
  const x = (list || []).find((o) => o.id === id);
  return x?.label || (id ? String(id) : "—");
}

function summaryRow(ax, label, value) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 34%) 1fr", gap: 10, fontSize: 12, padding: "8px 0", borderBottom: `1px solid ${ax.border}` }}>
      <div style={{ color: ax.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ color: ax.text, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{value || "—"}</div>
    </div>
  );
}

function formatDirectorFieldValue(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Sì" : "No";
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  const t = String(v).trim();
  return t || "—";
}

function directorCompiledSection(ax, title, obj) {
  if (!obj || typeof obj !== "object") return null;
  const keys = Object.keys(obj);
  if (!keys.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ ...fieldLabel(), color: ax.electric }}>{title}</div>
      <div style={{ marginTop: 6 }}>
        {keys.map((k) => (
          <div key={k}>{summaryRow(ax, k, formatDirectorFieldValue(obj[k]))}</div>
        ))}
      </div>
    </div>
  );
}

function audioDesignMiniCard(ax, title, accent, lines) {
  return (
    <div style={{ ...cardPad(), borderColor: accent.border, marginBottom: 0 }}>
      <div style={{ ...fieldLabel(), color: accent.color }}>{title}</div>
      <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: ax.text, lineHeight: 1.55 }}>
        {lines.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

function truncateUrl(u, max = 72) {
  const t = u != null ? String(u).trim() : "";
  if (!t) return "—";
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** Fase 4 — riassunto leggibile prima dei dettagli tecnici (passo 7). */
function clipStep7ConsumerGuide(ax, executionPreview, clip, readiness) {
  const isDialogue = clip?.clipType === CLIP_TYPE.DIALOGUE;
  const vcr = executionPreview?.videoConstraintReport;
  const vr = executionPreview?.videoRenderPlan;
  const lines = [];
  if (isDialogue) {
    lines.push(
      "Il sistema creerà un video con volto che parla, usando l’immagine della scena e la traccia audio finale (dopo mix).",
    );
    lines.push(
      "I dettagli di «regia» non partono come comandi separati verso il servizio: contano soprattutto immagine + audio.",
    );
  } else {
    lines.push(
      "Il sistema animerà l’immagine della scena con istruzioni in testo; nel passaggio video l’audio non viene inviato al provider.",
    );
    lines.push("In un secondo passaggio, audio e video vengono uniti nel file che userai in timeline.");
  }
  lines.push("Ordine tipico: voce (e musica/ambiente se impostati) → video → allineamento finale in un unico MP4 clip.");
  if (!readiness?.ok) {
    lines.push("Completa prima i punti in rosso: mancano dati necessari per partire.");
  } else {
    lines.push("I dati minimi ci sono: puoi avviare «Genera clip» quando sei pronto.");
  }
  if (Array.isArray(vcr?.honestyNotes) && vcr.honestyNotes.length) {
    lines.push(`Limite da sapere: ${vcr.honestyNotes[0]}`);
  } else if (vr?.muxAudioIntoVideoAfterProvider && !isDialogue) {
    lines.push("Per questo tipo di clip il browser unirà audio e video dopo il render del provider.");
  }
  return (
    <div style={{ ...cardPad(), borderColor: "rgba(74,222,128,0.4)" }}>
      <div style={{ ...fieldLabel(), color: "#4ade80" }}>Cosa farà la generazione (in breve)</div>
      <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, color: ax.text, lineHeight: 1.55 }}>
        {lines.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
      <p style={{ fontSize: 11, color: ax.muted, margin: "10px 0 0", lineHeight: 1.45 }}>
        I testi lunghi, la strategia provider e il Director sono sotto, raggruppati in «Dettagli tecnici», se usi la vista guidata.
      </p>
    </div>
  );
}

function dialogueDirectionStep7Block(ax, clip, p) {
  if (clip?.clipType !== "dialogue") return null;
  const dd =
    clip?.dialogueDirectionPlan && typeof clip.dialogueDirectionPlan === "object" ? clip.dialogueDirectionPlan : null;
  if (!dd) {
    return (
      <div style={{ ...cardPad(), borderColor: "rgba(129,140,248,0.35)", marginTop: 12 }}>
        <div style={{ ...fieldLabel(), color: "#818cf8" }}>Regia dialogica multi-soggetto</div>
        <p style={{ fontSize: 11, color: ax.text2, margin: "6px 0 0", lineHeight: 1.55 }}>
          Piano direction non ancora calcolato: esegui «Genera clip» per produrre <code style={{ fontSize: 10 }}>dialogueDirectionPlan</code>{" "}
          (motore <code style={{ fontSize: 10 }}>dialogueDirectionEngine</code>).
        </p>
      </div>
    );
  }
  const hdr = dd.dialogueDirectionConstraintReport && typeof dd.dialogueDirectionConstraintReport === "object" ? dd.dialogueDirectionConstraintReport : null;
  const shot = dd.dialogueShotPlan && typeof dd.dialogueShotPlan === "object" ? dd.dialogueShotPlan : null;
  const staging = dd.subjectStagingPlan && typeof dd.subjectStagingPlan === "object" ? dd.subjectStagingPlan : null;
  const presence = dd.dialoguePresencePlan && typeof dd.dialoguePresencePlan === "object" ? dd.dialoguePresencePlan : null;
  const multi =
    hdr?.multiSubjectPresenceSupport === "executed_now"
      ? "Supporto multi-presenza: eseguito (audio+video coerenti con limiti dichiarati)."
      : hdr?.multiSubjectPresenceSupport === "partially_honored"
        ? "Supporto multi-presenza: parziale — H8 multi-voice sì; video executor non fa coverage multi-soggetto reale."
        : hdr?.multiSubjectPresenceSupport === "future_executor_needed"
          ? "Supporto multi-presenza: richiede executor futuro (dati o regia non risolvibili oggi)."
          : "Supporto multi-presenza: advisory / intento — non spacciare per copertura cinematografica eseguita.";
  return (
    <div style={{ ...cardPad(), borderColor: "rgba(129,140,248,0.45)", marginTop: 12 }}>
      <div style={{ ...fieldLabel(), color: "#818cf8" }}>Regia dialogica multi-soggetto</div>
      <p style={{ fontSize: 11, color: ax.text2, margin: "6px 0 12px", lineHeight: 1.55 }}>
        Piano da <code style={{ fontSize: 10 }}>dialogueDirectionEngine</code> — separato dall&apos;audio H8; indica intenti visivi e limiti reali dell&apos;executor (
        <code style={{ fontSize: 10 }}>{p?.chosenExecutorType || "—"}</code>).
      </p>
      <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 11, color: ax.text2, lineHeight: 1.55 }}>
        <li>
          Tipo scena dialogica: <strong style={{ color: ax.text }}>{dd.dialogueSceneType || "—"}</strong>
        </li>
        <li>Speaker (reali): {dd.speakerCount ?? "—"}</li>
        <li>Soggetti presenti (unione cast / clip / battute): {(dd.presentSubjectIds || []).join(", ") || "—"}</li>
        <li>
          Frame dialogico: <code style={{ fontSize: 10 }}>{dd.dialogueFrameMode || "—"}</code> · presenza multi-soggetto:{" "}
          <code style={{ fontSize: 10 }}>{dd.multiSubjectPresenceMode || "—"}</code>
        </li>
        <li>
          Focus turno 0: speaker <code style={{ fontSize: 10 }}>{dd.speakerFocusPlan?.[0]?.speakerId || "—"}</code> · listener:{" "}
          {(dd.speakerFocusPlan?.[0]?.listenerIds || []).join(", ") || "—"}
        </li>
        <li>
          Shot dialogico (intent): archetype <code style={{ fontSize: 10 }}>{shot?.shotArchetype || "—"}</code> · coverage{" "}
          <code style={{ fontSize: 10 }}>{shot?.turnCoverageMode || "—"}</code>
          {shot?.reactionShotNeeded ? " · reazione desiderata (non eseguita su avatar)" : ""}
        </li>
        <li>
          Staging: foreground {(staging?.foregroundSubjects || []).join(", ") || "—"} · background{" "}
          {(staging?.backgroundSubjects || []).join(", ") || "—"} · fuori campo udibili{" "}
          {(staging?.offscreenButAudibleSubjects || []).join(", ") || "—"}
        </li>
        <li>
          Onestà executor: regia video <code style={{ fontSize: 10 }}>{hdr?.dialogueRegiaVideoTier || "—"}</code> · audio multi-voice{" "}
          <code style={{ fontSize: 10 }}>{hdr?.audioMultiVoice || "—"}</code>
        </li>
        <li style={{ marginTop: 6 }}>{multi}</li>
        {hdr?.summary?.avatarDegradesToSingleFaceLipSync ? (
          <li style={{ color: "#fbbf24", fontSize: 10 }}>
            Avatar: multi-speaker degrada a lip-sync su un volto / quadro unico (piano multi-soggetto resta advisory per shot/editing).
          </li>
        ) : null}
        {hdr?.summary?.cinematicCarriesRegiaAsTextOnly ? (
          <li style={{ fontSize: 10, color: ax.muted }}>
            Cinematic: regia dialogica entra come prompt/testo — nessuna multi-camera o shot editing nativo.
          </li>
        ) : null}
        {p?.compiledProviderPayloadIntent?.advisoryDialogueDirection ? (
          <li style={{ fontSize: 10, color: ax.muted }}>
            Payload intent: <code style={{ fontSize: 9 }}>advisoryDialogueDirection</code> allegato al piano provider (non inviato come body
            dedicato).
          </li>
        ) : null}
      </ul>
      {presence?.offscreenAudible?.length ? (
        <p style={{ fontSize: 10, color: ax.muted, margin: 0, lineHeight: 1.45 }}>
          Presenza / fuori campo: {presence.offscreenAudible.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function videoStrategyStep7(ax, clip, lastRun) {
  const s =
    (clip?.videoExecutionStrategy && typeof clip.videoExecutionStrategy === "object" ? clip.videoExecutionStrategy : null) ||
    (lastRun?.videoExecutionStrategy && typeof lastRun.videoExecutionStrategy === "object" ? lastRun.videoExecutionStrategy : null);
  const p =
    (clip?.videoRenderPlan && typeof clip.videoRenderPlan === "object" ? clip.videoRenderPlan : null) ||
    (lastRun?.videoRenderPlan && typeof lastRun.videoRenderPlan === "object" ? lastRun.videoRenderPlan : null);
  const vcr =
    (clip?.videoConstraintReport && typeof clip.videoConstraintReport === "object" ? clip.videoConstraintReport : null) ||
    (lastRun?.videoConstraintReport && typeof lastRun.videoConstraintReport === "object" ? lastRun.videoConstraintReport : null) ||
    (p?.videoConstraintReport && typeof p.videoConstraintReport === "object" ? p.videoConstraintReport : null);
  if (!s && !p) {
    return (
      <div style={{ ...cardPad(), borderColor: "rgba(251,191,36,0.35)" }}>
        <div style={{ ...fieldLabel(), color: "#fbbf24" }}>Strategia video (H5)</div>
        <p style={{ fontSize: 11, color: ax.text2, margin: "6px 0 0", lineHeight: 1.55 }}>
          Ancora nessun render clip: la classificazione e il piano provider compaiono qui dopo «Genera clip» (o ricostruisci l&apos;anteprima execution se il clip ha già gli oggetti persistiti).
        </p>
      </div>
    );
  }
  const lim = Array.isArray(s?.limitations) ? s.limitations : [];
  const failStage = clip?.videoExecutionFailureStage || null;
  const montageReady =
    p?.finalVideoReadyForMontage === true || (clip?.videoUrl && clip?.status === "ready_for_review");
  return (
    <div style={{ ...cardPad(), borderColor: "rgba(251,191,36,0.45)" }}>
      <div style={{ ...fieldLabel(), color: "#fbbf24" }}>Strategia video esecutiva (H5)</div>
      <p style={{ fontSize: 11, color: ax.text2, margin: "6px 0 12px", lineHeight: 1.55 }}>
        Classificazione operativa e scelta provider dichiarata dal motore <code style={{ fontSize: 10 }}>videoDirectionEngine</code>. Separazione netta tra intento regia (Director) e ciò che il provider accetta davvero oggi.
      </p>
      {failStage ? (
        <div
          style={{
            ...cardPad(),
            borderColor: "rgba(248,113,113,0.45)",
            background: "rgba(127,29,29,0.12)",
            marginBottom: 12,
          }}
        >
          <div style={{ ...fieldLabel(), color: "#f87171" }}>Fallimento pipeline video</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: 11, color: ax.text2, lineHeight: 1.5 }}>
            <li>
              Stage: <code style={{ fontSize: 10 }}>{failStage}</code>
            </li>
            {clip?.videoMuxFailure ? (
              <li>
                Mux: sì — <span style={{ color: "#f87171" }}>{String(clip.videoMuxFailureDetails || "dettaglio mancante")}</span>
              </li>
            ) : null}
            {clip?.videoExecutionFailureReason ? (
              <li>Motivo: {String(clip.videoExecutionFailureReason).slice(0, 280)}</li>
            ) : null}
          </ul>
        </div>
      ) : null}
      <div style={{ ...cardPad(), borderColor: "rgba(52,211,153,0.35)", marginBottom: 12 }}>
        <div style={{ ...fieldLabel(), color: "#34d399" }}>Assembly finale · montaggio</div>
        <ul style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: 11, color: ax.text2, lineHeight: 1.5 }}>
          <li>
            Modalità: <code style={{ fontSize: 10 }}>{p?.finalVideoAssemblyMode || "—"}</code>
          </li>
          <li>
            File per montaggio (clip.videoUrl): {montageReady ? "sì — allineato a muxed/avatar" : "no / non pronto"}
          </li>
          <li>Pronto montaggio (flag): {p?.finalVideoReadyForMontage === true ? "sì" : "no"}</li>
          {p?.muxAudioIntoVideoAfterProvider ? (
            <>
              <li>Output provider (pre-mux): {truncateUrl(p?.videoProviderOutputUrl)}</li>
              <li>Output muxato (post-ffmpeg): {truncateUrl(p?.muxedFinalVideoUrl || clip?.videoUrl)}</li>
              <li>Audio mux: {p?.audioMuxApplied ? "sì" : "no"} · sorgente {truncateUrl(p?.audioMuxSourceUrl)}</li>
              <li>Completato mux: {p?.audioMuxCompletedAt || p?.muxCompletedAt || "—"}</li>
            </>
          ) : (
            <li>
              Render nativo avatar: audio inviato al provider; <code style={{ fontSize: 10 }}>videoUrl</code> è già il
              container finale.
            </li>
          )}
        </ul>
      </div>
      {vcr ? (
        <div style={{ ...cardPad(), borderColor: "rgba(148,163,184,0.35)", marginBottom: 12 }}>
          <div style={{ ...fieldLabel(), color: ax.text2 }}>videoConstraintReport</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: 10, color: ax.muted, lineHeight: 1.5 }}>
            <li>promptDrivenOnly: {vcr.promptDrivenOnly ? "sì" : "no"}</li>
            <li>audio → provider: {vcr.audioSentToProvider ? "sì" : "no"}</li>
            <li>audio mux dopo provider: {vcr.audioMuxedAfterProvider ? "sì" : "no"}</li>
            <li>
              camera / shot / motion: {vcr.cameraControlMode} · {vcr.shotControlMode} · {vcr.motionControlMode}
            </li>
            <li>failureSurface: {(vcr.failureSurface || []).join(", ") || "—"}</li>
            {Array.isArray(vcr.honestyNotes) && vcr.honestyNotes.length ? (
              <li style={{ marginTop: 6 }}>
                Note: {vcr.honestyNotes.join(" ")}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
      {dialogueDirectionStep7Block(ax, clip, p)}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <div style={{ ...cardPad(), borderColor: "rgba(251,191,36,0.3)", margin: 0 }}>
          <div style={{ ...fieldLabel(), color: ax.text }}>Tipo strategia</div>
          <div style={{ fontSize: 12, color: ax.text, fontWeight: 700, marginTop: 6 }}>{s?.strategyType || "—"}</div>
          {Array.isArray(s?.strategyTags) && s.strategyTags.length > 1 && (
            <div style={{ fontSize: 10, color: ax.muted, marginTop: 4 }}>Tag: {s.strategyTags.join(" · ")}</div>
          )}
          <div style={{ fontSize: 10, color: ax.muted, marginTop: 6, lineHeight: 1.45 }}>{s?.rationale || ""}</div>
        </div>
        <div style={{ ...cardPad(), borderColor: "rgba(34,211,238,0.35)", margin: 0 }}>
          <div style={{ ...fieldLabel(), color: "#22d3ee" }}>Executor (split)</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: 11, color: ax.text2, lineHeight: 1.5 }}>
            <li>
              Tipo: <strong style={{ color: ax.text }}>{s?.videoExecutorType || p?.chosenExecutorType || "—"}</strong>
            </li>
            <li>
              Dispatch: <code style={{ fontSize: 10 }}>{s?.executorDispatchMode || "—"}</code>
            </li>
            <li>
              Avatar vs cinematic:{" "}
              {s?.videoExecutorType === "avatar_lipsync" || p?.chosenExecutorType === "avatar_lipsync"
                ? "talking-avatar (lip-sync)"
                : s?.videoExecutorType === "cinematic_i2v" || p?.chosenExecutorType === "cinematic_i2v"
                  ? "cinematic I2V (prompt + frame)"
                  : "—"}
            </li>
          </ul>
        </div>
        <div style={{ ...cardPad(), borderColor: "rgba(41,182,255,0.35)", margin: 0 }}>
          <div style={{ ...fieldLabel(), color: ax.electric }}>Motore / mode</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: 11, color: ax.text2, lineHeight: 1.5 }}>
            <li>
              Provider: <code style={{ fontSize: 10 }}>{s?.videoExecutorProvider || p?.chosenProvider || "—"}</code>
            </li>
            <li>
              Modello: <code style={{ fontSize: 10 }}>{String(p?.chosenModel || s?.videoExecutorModel || s?.providerMode || "").slice(0, 56)}</code>
            </li>
            <li>
              Scelta prodotto: <code style={{ fontSize: 10 }}>{s?.providerChoice || "—"}</code>
            </li>
            <li>Approccio: {s?.renderApproach || "—"}</li>
            <li>Archetipo: {s?.providerArchetype || "—"}</li>
          </ul>
        </div>
        <div style={{ ...cardPad(), borderColor: "rgba(167,139,250,0.35)", margin: 0 }}>
          <div style={{ ...fieldLabel(), color: ax.violet }}>Lip-sync, prompt, audio verso provider</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: 11, color: ax.text2, lineHeight: 1.5 }}>
            <li>Lip-sync previsto (tipo clip): {p?.usesLipSync === true ? "sì" : p?.usesLipSync === false ? "no" : s?.requiresLipSync ? "sì" : "no"}</li>
            <li>Prompt inviato al provider video: {p?.sendsPromptToProvider ? (p?.promptActuallySent ? "sì" : "previsto") : "no (solo avatar)"}</li>
            <li>Audio inviato al provider video: {p?.sendsAudioToProvider ? "sì" : p?.audioActuallySentToVideoProvider ? "sì" : "no (mux post-I2V se cinematic)"}</li>
            <li>Mux finale audio+video: {p?.muxAudioIntoVideoAfterProvider ? "sì (ffmpeg.wasm)" : "no"}</li>
            <li>
              Payload dichiarato:{" "}
              {p?.providerPayloadActuallySent?.audio_url || p?.sendsAudioToProvider
                ? "immagine + audio → avatar"
                : p?.providerPayloadActuallySent?.prompt != null
                  ? "start_image + prompt (O3)"
                  : "—"}
            </li>
            <li>
              Camera regia:{" "}
              {s?.cameraIntentHandling === "partial_honesty_via_prompt_only_no_explicit_camera_api"
                ? "solo testo prompt (O3 — nessun parametro camera nativo)"
                : s?.canHonorCameraIntent
                  ? "solo testo prompt (O3)"
                  : "non come parametri API (Avatar — solo immagine+audio)"}
            </li>
          </ul>
        </div>
      </div>
      {(Array.isArray(p?.executorLimitations) && p.executorLimitations.length > 0) || lim.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...fieldLabel(), color: ax.muted }}>Limiti / onestà</div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 10, color: ax.muted, lineHeight: 1.5 }}>
            {(p?.executorLimitations && p.executorLimitations.length ? p.executorLimitations : lim)
              .slice(0, 8)
              .map((t, i) => (
                <li key={i}>{t}</li>
              ))}
          </ul>
        </div>
      ) : null}
      {p?.motionExecutionMode && (
        <p style={{ fontSize: 10, color: ax.muted, margin: "10px 0 0", lineHeight: 1.45 }}>
          Piano render: motion <code style={{ fontSize: 9 }}>{p.motionExecutionMode}</code> · lip{" "}
          <code style={{ fontSize: 9 }}>{p.lipSyncMode}</code>
          {p.compiledAt ? ` · ${p.compiledAt}` : ""}
        </p>
      )}
    </div>
  );
}

/** Stessa catena del runtime: resolveNarratedClipNarrator → resolveElevenLabsVoiceId. */
function narratedNarratorExecutionPreview(clip, projectNarrators) {
  const list = Array.isArray(projectNarrators) ? projectNarrators : [];
  const resolution = resolveNarratedClipNarrator(clip, list);
  const elevenLabs = resolveElevenLabsVoiceId(resolution.narratorVoice?.voiceId);
  return { resolution, elevenLabs, projectNarratorsList: list };
}

function narratedClipNarratorPreviewCard(ax, clip, projectNarrators) {
  if (!clip || clip.clipType === CLIP_TYPE.DIALOGUE) return null;
  const { resolution: narrRes, elevenLabs: r11, projectNarratorsList: list } = narratedNarratorExecutionPreview(
    clip,
    projectNarrators
  );
  const mode = narrRes.narratorResolutionMode || "—";
  const narrRow =
    narrRes.resolvedNarratorId && list.length
      ? list.find((n) => n.id === narrRes.resolvedNarratorId)
      : null;
  let originIt = "—";
  let hintIt = null;
  switch (mode) {
    case "clip_explicit_project_narrator":
      originIt = "Narratore di progetto (scelto sul clip)";
      break;
    case "invalid_narrator_id":
      originIt = "Errore — ID narratore non valido o senza voce";
      hintIt = narrRes.narratorId ? `Riferimento clip: ${narrRes.narratorId}` : null;
      break;
    case "legacy_embedded_voice":
      originIt = "Voce sul clip (legacy); narratori di progetto presenti ma non usati per questo clip";
      hintIt =
        "Ordine runtime: `narratorId` di progetto sul clip → voce sul clip (legacy) → narratore predefinito / primo. Qui non c’è `narratorId` valido: si usa la voce sul clip.";
      break;
    case "legacy_embedded_voice_only":
      originIt = "Voce sul clip (nessun narratore di progetto nel capitolo)";
      break;
    case "project_default_narrator":
      originIt = "Predefinito di progetto";
      break;
    case "project_first_narrator":
      originIt = "Primo narratore del progetto (nessun predefinito esplicito)";
      hintIt = "Ambiguo: conviene marcare un narratore predefinito nel capitolo.";
      break;
    case "unresolved":
      originIt = "Non risolvibile — aggiungi un narratore con voce o una voce sul clip";
      break;
    default:
      originIt = String(mode);
  }

  const narratorName =
    narrRow?.name ||
    (String(mode).startsWith("legacy_embedded") &&
      (narrRes.narratorVoice?.voiceLabel || narrRes.narratorVoice?.voiceId || "Voce sul clip")) ||
    "—";

  const voiceLabel =
    narrRes.narratorVoice?.voiceLabel ||
    (narrRes.narratorVoice?.voiceId ? narrRes.narratorVoice.voiceId : "") ||
    "—";

  const apiVoiceId = r11.voiceId || "—";
  const configuredRaw = narrRes.narratorVoice?.voiceId || "";

  const severity =
    mode === "invalid_narrator_id" || mode === "unresolved"
      ? "error"
      : mode === "project_first_narrator" || (r11.error && configuredRaw)
        ? "warn"
        : "ok";

  const border =
    severity === "error"
      ? "rgba(248,113,113,0.45)"
      : severity === "warn"
        ? "rgba(251,191,36,0.4)"
        : "rgba(52,211,153,0.35)";

  return (
    <div
      style={{
        ...cardPad(),
        borderColor: border,
        background: severity === "error" ? "rgba(127,29,29,0.12)" : "rgba(6,78,59,0.08)",
        marginBottom: 12,
      }}
    >
      <div style={{ ...fieldLabel(), color: severity === "error" ? "#fca5a5" : "#6ee7b7" }}>
        Narrato — narratore risolto (stesso criterio della generazione)
      </div>
      <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 11, color: ax.text, lineHeight: 1.55 }}>
        <li>
          <strong>Narratore:</strong> {narratorName}
        </li>
        <li>
          <strong>Voce:</strong> {voiceLabel}
          {configuredRaw && voiceLabel !== configuredRaw ? (
            <span style={{ color: ax.muted }}>
              {" "}
              (<code style={{ fontSize: 10 }}>{configuredRaw}</code>)
            </span>
          ) : null}
        </li>
        <li>
          <strong>ID ElevenLabs (payload TTS):</strong>{" "}
          <code style={{ fontSize: 10 }}>{apiVoiceId}</code>
          {r11.error && configuredRaw ? (
            <span style={{ color: "#fca5a5", display: "block", marginTop: 4 }}>{r11.error}</span>
          ) : null}
        </li>
        <li>
          <strong>Origine:</strong> {originIt}
        </li>
        <li style={{ fontSize: 10, color: ax.muted }}>
          Modalità interna: <code style={{ fontSize: 9 }}>{mode}</code>
        </li>
      </ul>
      {hintIt ? (
        <p style={{ fontSize: 10, color: ax.text2, margin: "8px 0 0", lineHeight: 1.45 }}>{hintIt}</p>
      ) : null}
    </div>
  );
}

function executionLayerStep7(ax, preview, lastRun, clip, projectNarrators) {
  const snap = lastRun && typeof lastRun === "object" ? lastRun : preview;
  if (!snap?.videoExecutionInput) return null;
  const v = snap.videoExecutionInput;
  const a = snap.audioExecutionInput;
  const m = snap.mixExecutionPlan;
  const r = snap.executionConstraintReport;
  const et = r?.executionTruth && typeof r.executionTruth === "object" ? r.executionTruth : null;
  const mixDone = clip?.audioMixExecutionResult && typeof clip.audioMixExecutionResult === "object";
  const isCinematic = v.videoExecutorType === "cinematic_i2v";
  const advisoryVideoKeys = Object.entries(v.advisoryVideoParams || {}).filter(([, val]) => val != null && String(val).trim());
  const advisoryAudioKeys = Object.entries(a.advisoryAudioParams || {}).filter(([, val]) => val != null && String(val).trim());
  return (
    <div style={{ ...cardPad(), borderColor: "rgba(41,182,255,0.45)" }}>
      <div style={{ ...fieldLabel(), color: ax.electric }}>Livello execution (H2 · H6 · H7 · H8)</div>
      <p style={{ fontSize: 11, color: ax.text2, margin: "6px 0 12px", lineHeight: 1.55 }}>
        Separazione tra payload API minimi (enforceable), advisory Director, MVP reale (stem/mix clip) e ciò che resta per il film/motori futuri.
        {lastRun ? (
          <span>
            {" "}
            <strong style={{ color: ax.text }}>Sotto: ultimo snapshot da pipeline salvato sul clip</strong> (
            {lastRun.builtAt || "—"}).
          </span>
        ) : (
          <span> Anteprima da wizard: gli URL fal compaiono solo dopo «Genera clip».</span>
        )}
      </p>
      {et ? (
        <div
          style={{
            ...cardPad(),
            borderColor: "rgba(59,130,246,0.35)",
            background: "rgba(30,58,138,0.12)",
            marginBottom: 12,
          }}
        >
          <div style={{ ...fieldLabel(), color: "#93c5fd" }}>Verità runtime (constraint report)</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 10, color: ax.text2, lineHeight: 1.55 }}>
            <li>{et.clipAudioPipeline}</li>
            <li>{et.clipVideoPipeline}</li>
            <li>{et.montageFilm}</li>
            <li>{et.premiumVsMvp}</li>
          </ul>
        </div>
      ) : null}
      {narratedClipNarratorPreviewCard(ax, clip, projectNarrators)}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <div style={{ ...cardPad(), borderColor: "rgba(34,197,94,0.4)", margin: 0 }}>
          <div style={{ ...fieldLabel(), color: "#4ade80" }}>Eseguito oggi</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 11, color: ax.text, lineHeight: 1.5 }}>
            <li>
              <strong>ElevenLabs:</strong> {a.enforceableAudioParams?.voiceId || "—"} — testo TTS ({String(a.ttsText || "").length} car.)
            </li>
            <li>
              <strong>Video:</strong> <code style={{ fontSize: 10 }}>{v.providerMode}</code>
              {isCinematic ? (
                <span style={{ color: ax.muted }}>
                  {" "}
                  — cinematic: prompt + start_image verso O3; mix audio nel mux post-provider (non nel body API).
                </span>
              ) : (
                <span style={{ color: ax.muted }}>
                  {" "}
                  — avatar: <code style={{ fontSize: 9 }}>imageUrl</code> + <code style={{ fontSize: 9 }}>audioUrl</code>{" "}
                  (traccia mix clip).
                </span>
              )}
            </li>
            <li>
              <strong>Stem / mix clip:</strong>{" "}
              <code style={{ fontSize: 10 }}>{(m.currentExecutableStems || ["voice"]).join(", ")}</code>
              {mixDone ? (
                <span style={{ color: ax.muted }}>
                  {" "}
                  (
                  {clip.audioMixExecutionResult.strategy === "voice_only_no_beds"
                    ? "solo voce (nessun bed attivo/render)"
                    : "mix stereo con bed → WAV su fal"}
                  )
                </span>
              ) : (
                <span style={{ color: ax.muted }}>
                  {" "}
                  (anteprima: elenco stem pianificati; dopo «Genera clip» vedi risultato H7 sul clip)
                </span>
              )}
            </li>
            <li>
              <strong>Musica (H6):</strong>{" "}
              {clip?.musicProvider
                ? `${clip.musicProvider} · modello ${clip.musicRenderPlan?.chosenModel || clip.musicGenerationResult?.model || "—"} · sorgente ${clip.musicSourceType || "—"}${clip.musicFallbackUsed ? " · fallback synth" : ""}`
                : mixDone
                  ? "non persistita su questo clip"
                  : "provider dopo «Genera clip»"}
              {clip?.musicAssetDurationSec != null && clip?.audioDurationSeconds != null ? (
                <span style={{ color: ax.muted }}>
                  {" "}
                  (~asset {clip.musicAssetDurationSec}s vs voce {clip.audioDurationSeconds}s)
                </span>
              ) : null}
            </li>
            <li>
              <strong>Mix (H7):</strong>{" "}
              {clip?.audioMixExecutionResult?.mixEngineMode
                ? `${clip.audioMixExecutionResult.mixEngineMode}${clip.mixFallbackUsed ? " · fallback MVP" : ""}`
                : mixDone
                  ? "—"
                  : "dopo «Genera clip»"}
              {clip?.professionalMixStrategy ? (
                <span style={{ color: ax.muted }}>
                  {" "}
                  · loudness <code style={{ fontSize: 9 }}>{clip.professionalMixStrategy.targetLoudnessMode}</code>
                  {clip.professionalMixStrategy.peakSafetyLimiterEnabled ? " · peak safety" : ""}
                  {clip.professionalMixStrategy.autoDuckingEnabled ? " · ducking" : ""}
                </span>
              ) : null}
            </li>
          </ul>
        </div>
        <div style={{ ...cardPad(), borderColor: "rgba(167,139,250,0.4)", margin: 0 }}>
          <div style={{ ...fieldLabel(), color: ax.violet }}>Oltre il clip / film (future)</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 11, color: ax.text, lineHeight: 1.5 }}>
            <li>
              Non nel passo clip corrente — {(m.futureExecutableStems || []).join(", ") || "—"} (es. mastering film,
              hollywood mix).
            </li>
            <li>Strategia render: {m.audioRenderStrategy}</li>
            <li>
              Priorità mix: {m.mixPriority}
              {m.musicStemPlanned ? " · musica pianificata" : ""}
              {m.ambientStemPlanned ? " · ambiente pianificato" : ""}
              {m.sfxStemPlanned ? " · SFX pianificati" : ""}
            </li>
          </ul>
        </div>
        <div style={{ ...cardPad(), borderColor: "rgba(251,191,36,0.35)", margin: 0 }}>
          <div style={{ ...fieldLabel(), color: "#fbbf24" }}>Campi advisory (non nel payload API)</div>
          <p style={{ fontSize: 10, color: ax.muted, margin: "0 0 6px", lineHeight: 1.45 }}>
            Video: {advisoryVideoKeys.length} campi · Audio: {advisoryAudioKeys.length} campi compilati. Esempi: camera, tono, musica/ambiente nel compiled.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 10, color: ax.text2, lineHeight: 1.45, maxHeight: 120, overflow: "auto" }}>
            {advisoryVideoKeys.slice(0, 6).map(([k, val]) => (
              <li key={k}>
                <code>{k}</code>: {formatDirectorFieldValue(val).slice(0, 120)}
                {String(formatDirectorFieldValue(val)).length > 120 ? "…" : ""}
              </li>
            ))}
            {advisoryVideoKeys.length > 6 ? <li>… altri {advisoryVideoKeys.length - 6} (video)</li> : null}
            {advisoryAudioKeys.slice(0, 4).map(([k, val]) => (
              <li key={`a-${k}`}>
                <code>{k}</code>: {formatDirectorFieldValue(val).slice(0, 100)}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {r?.futureOnlyFields?.length ? (
        <p style={{ fontSize: 10, color: ax.muted, margin: "12px 0 0", lineHeight: 1.45 }}>
          <strong>Future-only:</strong>{" "}
          {r.futureOnlyFields.slice(0, 4).map((x) => x.field).join(", ")}
          {r.futureOnlyFields.length > 4 ? ` +${r.futureOnlyFields.length - 4}` : ""}
        </p>
      ) : null}
    </div>
  );
}

function stemStatusLine(ax, label, stem) {
  if (!stem || typeof stem !== "object") return `${label}: non ancora generato.`;
  const st = String(stem.status || "");
  const kind = String(stem.stemKind || "");
  const src = String(stem.sourceType || "");
  if (st === "ok" && stem.url) {
    return `${label}: ${kind === "rendered" ? "renderizzato" : kind} (${src}) · ~${stem.durationSec != null ? `${stem.durationSec}s` : "durata n/d"}`;
  }
  if (st === "skipped") return `${label}: non richiesto dal piano (${src}).`;
  return `${label}: ${st || "—"}`;
}

function audioDesignStep7Summary(ax, bundle, clip, plan) {
  const b = bundle && typeof bundle === "object" ? bundle : null;
  if (!b?.compiledMusicPlan) return null;
  const m = b.compiledMusicPlan;
  const amb = b.compiledAmbientPlan;
  const sfx = b.compiledSfxPlan;
  const mix = b.compiledAudioMixIntent;
  const exec = b.executionSurface;
  return (
    <div style={{ ...cardPad(), borderColor: "rgba(34,197,94,0.3)" }}>
      <div style={{ ...fieldLabel(), color: "#4ade80" }}>Audio Design Engine — piano di mix (MVP)</div>
      <p style={{ fontSize: 11, color: ax.text2, margin: "6px 0 12px", lineHeight: 1.55 }}>
        Sintesi dal motore audio: allineata a Director Engine e allo step Musica / ambiente. Dopo «Genera clip», H6 tenta musica reale (FAL Stable Audio di default, ElevenLabs compose se preferito/env), normalizza lo stem al frame voce e mixa; in fallback usa il pad sintetico MVP. Ambiente/SFX restano MVP sintetici finché non si collegano altri motori.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {audioDesignMiniCard(ax, "Musica", { color: "#86efac", border: "rgba(34,197,94,0.35)" }, [
          m.enabled ? `Attiva · umore: ${m.mood}` : "Non richiesta",
          `Intensità: ${m.intensity}`,
          m.suggestedStyle,
          m.suggestedUsage,
        ])}
        {audioDesignMiniCard(ax, "Ambiente", { color: "#6ee7b7", border: "rgba(45,212,191,0.35)" }, [
          amb.enabled ? `Attivo · preset: ${amb.preset}` : "Nessun bed ambientale",
          amb.texture,
          `Presenza: ${String(amb.backgroundPresence || "").replace(/_/g, " ")}`,
        ])}
        {audioDesignMiniCard(ax, "Effetti (SFX)", { color: "#a7f3d0", border: "rgba(16,185,129,0.35)" }, [
          sfx.enabled ? `Richiesti · categoria: ${String(sfx.effectCategory || "").replace(/_/g, " ")}` : "Nessun effetto",
          sfx.timingHint,
          `Discretezza: ${sfx.subtlety}`,
        ])}
        {audioDesignMiniCard(ax, "Intenzione di mix", { color: "#bbf7d0", border: "rgba(74,222,128,0.35)" }, [
          `Priorità voce: ${mix.voicePriority}`,
          `Musica sotto voce: ${mix.musicUnderVoice ? "sì" : "no"}`,
          `Bed ambiente: ${String(mix.ambientBed || "").replace(/_/g, " ")}`,
          `Energia sonora: ${mix.soundEnergy}`,
          `Arco emotivo: ${mix.emotionalArc}`,
        ])}
      </div>
      {exec && (
        <p style={{ fontSize: 10, color: ax.muted, margin: "12px 0 0", lineHeight: 1.5 }}>
          <strong>Flag bundle (post-compilazione wizard):</strong> {exec.voiceStemFromElevenLabs ? "voce ElevenLabs" : "—"}
          {exec.musicStemRendered ? " · musica stem MVP" : " · musica non attiva o non renderizzata"}
          {exec.ambientStemRendered ? " · ambiente stem MVP" : " · ambiente non attivo o non renderizzato"}
          {exec.sfxStemRendered ? " · SFX MVP" : " · SFX non attivi o non renderizzati"}. {exec.note}
        </p>
      )}
      {clip && (clip.voiceStem || clip.musicStem || clip.ambientStem || clip.sfxStem || clip.lastAudioRenderAt) && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 10, border: `1px solid ${ax.border}`, background: "rgba(0,0,0,0.18)" }}>
          <div style={{ ...fieldLabel(), color: ax.text }}>Stem persistiti (ultimo render)</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 11, color: ax.text2, lineHeight: 1.55 }}>
            <li>{stemStatusLine(ax, "Voce / dialogo (mix)", clip.voiceStem)}</li>
            {clip.clipType === CLIP_TYPE.DIALOGUE && clip.dialogueStem ? (
              <li>{stemStatusLine(ax, "Dialogo multi-voice (stem)", clip.dialogueStem)}</li>
            ) : null}
            <li>{stemStatusLine(ax, "Musica", clip.musicStem)}</li>
            <li>{stemStatusLine(ax, "Ambiente", clip.ambientStem)}</li>
            <li>{stemStatusLine(ax, "SFX", clip.sfxStem)}</li>
          </ul>
          {clip.audioMixExecutionResult?.strategy && (
            <p style={{ fontSize: 10, color: ax.muted, margin: "8px 0 0" }}>
              Mix: <code style={{ fontSize: 10 }}>{clip.audioMixExecutionResult.strategy}</code>
              {clip.lastAudioRenderAt ? ` · ${clip.lastAudioRenderAt}` : ""}
            </p>
          )}
          {clip?.dialogueExecutionStrategy && clip.clipType === CLIP_TYPE.DIALOGUE && (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                borderRadius: 10,
                border: "1px solid rgba(52,211,153,0.4)",
                background: "rgba(6,78,59,0.15)",
              }}
            >
              <div style={{ ...fieldLabel(), color: "#6ee7b7" }}>Dialogo multi-voice (H8)</div>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 11, color: ax.text2, lineHeight: 1.55 }}>
                <li>
                  <strong>Modalità:</strong> {clip.dialogueExecutionStrategy.dialogueMode || "—"} · speaker{" "}
                  {clip.dialogueExecutionStrategy.speakerCount ?? "—"}
                </li>
                <li>
                  <strong>Render multi-turn:</strong>{" "}
                  {clip.multiVoiceRenderResult?.lineRenderCount != null
                    ? `sì (${clip.multiVoiceRenderResult.lineRenderCount} segmenti TTS)`
                    : "no / non ancora generato"}
                </li>
                <li>
                  <strong>Fallback voce:</strong> {clip.dialogueFallbackUsed ? "sì (almeno un parlante)" : "no"}
                </li>
                {clip.speakerVoiceMap && (
                  <li style={{ fontSize: 10, color: ax.muted }}>
                    <strong>Mappa voci:</strong>{" "}
                    {Object.entries(clip.speakerVoiceMap)
                      .map(([id, v]) => `${planCharacterDisplayName(plan, id)} → ${v.voiceSourceType || "—"}`)
                      .join(" · ") || "—"}
                  </li>
                )}
                {clip.dialogueConstraintReport?.unresolvedCharacterIds?.length ? (
                  <li style={{ color: "#fbbf24", fontSize: 10 }}>
                    Non risolti: {clip.dialogueConstraintReport.unresolvedCharacterIds.join(", ")}
                  </li>
                ) : null}
              </ul>
            </div>
          )}
          {clip?.professionalMixStrategy && (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                borderRadius: 10,
                border: "1px solid rgba(244,114,182,0.35)",
                background: "rgba(131,24,67,0.12)",
              }}
            >
              <div style={{ ...fieldLabel(), color: "#f9a8d4" }}>Professional mix (H7)</div>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 11, color: ax.text2, lineHeight: 1.55 }}>
                <li>
                  <strong>Modalità:</strong> {clip.audioMixExecutionResult?.mixEngineMode || "—"} · path{" "}
                  <code style={{ fontSize: 10 }}>{clip.professionalMixResult?.executionPath || "—"}</code>
                </li>
                <li>
                  <strong>Priorità voce:</strong> parlato in primo piano (somma + ducking sui bed) ·{" "}
                  <strong>Ducking:</strong> {clip.professionalMixStrategy.autoDuckingEnabled ? "sì" : "no"}
                </li>
                <li>
                  <strong>Loudness:</strong> {clip.professionalMixStrategy.targetLoudnessMode || "—"} ·{" "}
                  <strong>Peak safety:</strong> {clip.professionalMixStrategy.peakSafetyLimiterEnabled ? "sì" : "no"}
                </li>
                <li>
                  <strong>Fallback mix MVP:</strong> {clip.mixFallbackUsed ? "sì" : "no"}
                </li>
                {clip.finalAudioMixMetrics?.peakAfterProcessing != null ? (
                  <li style={{ fontSize: 10, color: ax.muted }}>
                    Picco ~{clip.finalAudioMixMetrics.peakAfterProcessing.toFixed(4)} · RMS ~{" "}
                    {clip.finalAudioMixMetrics.rmsFinal != null ? clip.finalAudioMixMetrics.rmsFinal.toFixed(5) : "—"}
                  </li>
                ) : null}
                {clip.finalAudioMixConstraintReport?.limitations?.length ? (
                  <li style={{ fontSize: 10, color: ax.muted }}>
                    <strong>Limiti:</strong> {clip.finalAudioMixConstraintReport.limitations[0]}
                    {clip.finalAudioMixConstraintReport.limitations.length > 1 ? "…" : ""}
                  </li>
                ) : null}
              </ul>
            </div>
          )}
          {(clip.musicExecutionStrategy || clip.musicProvider) && (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                borderRadius: 10,
                border: "1px solid rgba(59,130,246,0.35)",
                background: "rgba(30,58,138,0.12)",
              }}
            >
              <div style={{ ...fieldLabel(), color: "#93c5fd" }}>Music source layer (H6)</div>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 11, color: ax.text2, lineHeight: 1.55 }}>
                <li>
                  <strong>Provider:</strong> {clip.musicProvider || clip.musicExecutionStrategy?.providerChoice || "—"}
                </li>
                <li>
                  <strong>Mode / modello:</strong> {clip.musicRenderPlan?.chosenModel || "—"} ·{" "}
                  <code style={{ fontSize: 10 }}>{clip.musicRenderPlan?.providerEndpointKey || "—"}</code>
                </li>
                <li>
                  <strong>Tipo sorgente:</strong> {clip.musicSourceType || "—"}{" "}
                  {clip.musicFallbackUsed ? (
                    <span style={{ color: "#fbbf24" }}>(fallback synth MVP)</span>
                  ) : (
                    <span style={{ color: "#4ade80" }}>(provider-based)</span>
                  )}
                </li>
                <li>
                  <strong>Durata:</strong> attesa voce ~{clip.audioDurationSeconds != null ? `${clip.audioDurationSeconds}s` : "—"} · asset
                  provider ~{clip.musicAssetDurationSec != null ? `${clip.musicAssetDurationSec}s` : "—"}
                </li>
                {clip.musicConstraintReport?.limitations?.length ? (
                  <li style={{ fontSize: 10, color: ax.muted }}>
                    <strong>Limiti:</strong> {clip.musicConstraintReport.limitations.slice(0, 2).join(" · ")}
                    {clip.musicConstraintReport.limitations.length > 2 ? "…" : ""}
                  </li>
                ) : null}
              </ul>
            </div>
          )}
        </div>
      )}
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
  directorProject = null,
  directorChapter = null,
  projectCharacterMasters = null,
  projectNarrators = null,
}) {
  const [step, setStep] = useState(1);
  const [consumerBriefMode, setConsumerBriefMode] = useState(true);
  const cmap = useMemo(() => charById(plan), [plan]);
  const scene = clip?.sceneId ? sceneById(plan, clip.sceneId) : null;
  const presentChars = useMemo(() => charactersPresentInScene(plan, clip?.sceneId), [plan, clip?.sceneId]);
  const autoSec = clip ? estimateClipDurationAuto(clip) : 0;
  const effectiveDur = clip ? resolveClipDurationSeconds(clip) : null;
  const narratorsList = useMemo(
    () => (Array.isArray(projectNarrators) ? projectNarrators : []),
    [projectNarrators]
  );
  const readiness = clip
    ? getClipGenerationReadiness(clip, {
        characterVoiceMasters,
        projectCharacterMasters: projectCharacterMasters && typeof projectCharacterMasters === "object" ? projectCharacterMasters : null,
        projectNarrators: narratorsList,
        plan,
        sceneResults,
      })
    : { ok: false, reasons: [] };

  const patch = useCallback((p) => onPatch(p), [onPatch]);

  const briefs = useMemo(() => (clip ? buildClipStructuredPrompts(clip, plan) : null), [clip, plan]);

  const directorCompile = useMemo(() => {
    if (!clip || !briefs) return null;
    return compileClipDirectorBundle({
      project: directorProject,
      chapter: directorChapter,
      plan,
      scene,
      clip,
      clipDirectionPromptFinal: briefs.clipDirectionPromptFinal,
      clipAudioDirectionPrompt: briefs.clipAudioDirectionPrompt,
      clipCreativeBriefFinal: briefs.clipCreativeBriefFinal,
    });
  }, [clip, plan, scene, directorProject, directorChapter, briefs]);

  const audioDesignBundle = useMemo(() => {
    if (!clip || !briefs || !directorCompile) return null;
    return compileAudioDesignBundle({
      clip,
      compiledAudioDirection: directorCompile.compiledAudioDirection,
      compiledCreativeIntent: directorCompile.compiledCreativeIntent,
      clipAudioDirectionPrompt: briefs.clipAudioDirectionPrompt,
      clipCreativeBriefFinal: briefs.clipCreativeBriefFinal,
    });
  }, [clip, briefs, directorCompile]);

  const executionPreview = useMemo(() => {
    if (!clip || !directorCompile || !audioDesignBundle) return null;
    const type = clip.clipType === CLIP_TYPE.DIALOGUE ? CLIP_TYPE.DIALOGUE : CLIP_TYPE.NARRATED;
    let ttsText = "";
    let ttsVoiceId = "";
    if (type === CLIP_TYPE.NARRATED) {
      ttsText = String(clip.narratorText || "").trim();
      const { elevenLabs } = narratedNarratorExecutionPreview(clip, narratorsList);
      ttsVoiceId = elevenLabs.voiceId || "—";
    } else {
      ttsText = buildDialogueTtsText(clip, plan);
      ttsVoiceId = "(H8: una voce ElevenLabs per personaggio / battuta — vedi speakerVoiceMap dopo generazione)";
    }
    const snapshot = {
      compiledVideoDirection: clip.compiledVideoDirection || directorCompile.compiledVideoDirection,
      compiledAudioDirection: clip.compiledAudioDirection || directorCompile.compiledAudioDirection,
      compiledCreativeIntent: clip.compiledCreativeIntent || directorCompile.compiledCreativeIntent,
      compiledPromptBundle: clip.compiledPromptBundle || directorCompile.compiledPromptBundle,
    };
    return compileClipExecutionPreview({
      clip,
      compiledSnapshot: snapshot,
      audioDesignBundle: clip.compiledAudioDesignBundle || audioDesignBundle,
      tts: { text: ttsText || "—", voiceId: ttsVoiceId || "—" },
      policySource: "ui-preview",
    });
  }, [clip, plan, directorCompile, audioDesignBundle, narratorsList]);

  const step7TechnicalStack = useMemo(() => {
    if (!clip) return null;
    return (
      <>
        <div style={{ ...cardPad(), borderColor: `rgba(41,182,255,0.25)` }}>
          <div style={{ ...fieldLabel(), color: ax.electric }}>Brief automatici (pipeline)</div>
          <p style={{ fontSize: 11, color: ax.text2, margin: "6px 0 10px", lineHeight: 1.55 }}>
            Generati dai campi del wizard e salvati sul capitolo: pronti per export e per integrazioni video/audio successive.
          </p>
          <div style={{ marginBottom: 12 }}>
            <div style={{ ...fieldLabel(), color: ax.text }}>Regia video — clipDirectionPromptFinal</div>
            <pre
              style={{
                margin: "6px 0 0",
                padding: 10,
                borderRadius: 10,
                border: `1px solid ${ax.border}`,
                background: ax.bg,
                color: ax.text2,
                fontSize: 11,
                lineHeight: 1.45,
                maxHeight: 200,
                overflow: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {String(clip.clipDirectionPromptFinal || briefs?.clipDirectionPromptFinal || "").trim() || "—"}
            </pre>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ ...fieldLabel(), color: ax.text }}>Direzione audio — clipAudioDirectionPrompt</div>
            <pre
              style={{
                margin: "6px 0 0",
                padding: 10,
                borderRadius: 10,
                border: `1px solid ${ax.border}`,
                background: ax.bg,
                color: ax.text2,
                fontSize: 11,
                lineHeight: 1.45,
                maxHeight: 200,
                overflow: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {String(clip.clipAudioDirectionPrompt || briefs?.clipAudioDirectionPrompt || "").trim() || "—"}
            </pre>
          </div>
          <div>
            <div style={{ ...fieldLabel(), color: ax.text }}>Creative brief — clipCreativeBriefFinal</div>
            <pre
              style={{
                margin: "6px 0 0",
                padding: 10,
                borderRadius: 10,
                border: `1px solid ${ax.border}`,
                background: ax.bg,
                color: ax.text2,
                fontSize: 11,
                lineHeight: 1.45,
                maxHeight: 160,
                overflow: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {String(clip.clipCreativeBriefFinal || briefs?.clipCreativeBriefFinal || "").trim() || "—"}
            </pre>
          </div>
        </div>

        {audioDesignStep7Summary(ax, clip.compiledAudioDesignBundle || audioDesignBundle, clip, plan)}

        {videoStrategyStep7(ax, clip, clip.lastExecutionSnapshot)}

        {executionLayerStep7(ax, executionPreview, clip.lastExecutionSnapshot, clip, projectNarrators)}

        <div style={{ ...cardPad(), borderColor: `rgba(167,139,250,0.35)` }}>
          <div style={{ ...fieldLabel(), color: ax.violet }}>Director Engine — istruzioni operative</div>
          <p style={{ fontSize: 11, color: ax.text2, margin: "6px 0 12px", lineHeight: 1.55 }}>
            Output strutturato dal prompt compiler, persistito sul clip. La pipeline compila il livello{" "}
            <code style={{ fontSize: 10 }}>execution</code> (video/audio/mix/constraints) e lo salva in{" "}
            <code style={{ fontSize: 10 }}>lastExecutionSnapshot</code> dopo una generazione riuscita; in anteprima si ricostruisce dai compiled senza URL fal.
          </p>
          <div
            style={{
              fontSize: 11,
              color: ax.text,
              lineHeight: 1.55,
              marginBottom: 12,
              padding: 10,
              borderRadius: 10,
              border: `1px solid ${ax.border}`,
              background: "rgba(0,0,0,0.2)",
            }}
          >
            <strong style={{ color: ax.electric }}>Nota onesta</strong>
            <div style={{ marginTop: 6 }}>
              Runtime clip: ElevenLabs + H8 multi-voice se dialogo; H6/H4/H7 come sopra. Video: Avatar Kling (immagine + URL mix) oppure O3 cinematic (prompt+frame) poi mux con lo stesso mix. Dettaglio negli snapshot Step 7.
            </div>
          </div>
          {directorCompiledSection(ax, "compiledVideoDirection", clip.compiledVideoDirection || directorCompile?.compiledVideoDirection)}
          {directorCompiledSection(ax, "compiledAudioDirection", clip.compiledAudioDirection || directorCompile?.compiledAudioDirection)}
          {directorCompiledSection(ax, "compiledCreativeIntent", clip.compiledCreativeIntent || directorCompile?.compiledCreativeIntent)}
          <div style={{ marginTop: 4 }}>
            <div style={{ ...fieldLabel(), color: ax.text }}>compiledPromptBundle (export)</div>
            <pre
              style={{
                margin: "6px 0 0",
                padding: 10,
                borderRadius: 10,
                border: `1px solid ${ax.border}`,
                background: ax.bg,
                color: ax.text2,
                fontSize: 10,
                lineHeight: 1.4,
                maxHeight: 220,
                overflow: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {(() => {
                const b = clip.compiledPromptBundle || directorCompile?.compiledPromptBundle;
                return b && typeof b === "object" ? JSON.stringify(b, null, 2) : "—";
              })()}
            </pre>
          </div>
        </div>
      </>
    );
  }, [ax, clip, briefs, audioDesignBundle, executionPreview, directorCompile, projectNarrators, plan]);

  useEffect(() => {
    if (!briefs || !directorCompile || !clip?.id) return;
    const patchPayload = {};
    if ((clip.clipDirectionPromptFinal || "") !== briefs.clipDirectionPromptFinal) {
      patchPayload.clipDirectionPromptFinal = briefs.clipDirectionPromptFinal;
    }
    if ((clip.clipAudioDirectionPrompt || "") !== briefs.clipAudioDirectionPrompt) {
      patchPayload.clipAudioDirectionPrompt = briefs.clipAudioDirectionPrompt;
    }
    if ((clip.clipCreativeBriefFinal || "") !== briefs.clipCreativeBriefFinal) {
      patchPayload.clipCreativeBriefFinal = briefs.clipCreativeBriefFinal;
    }
    const prevD = {
      compiledVideoDirection: clip.compiledVideoDirection,
      compiledAudioDirection: clip.compiledAudioDirection,
      compiledCreativeIntent: clip.compiledCreativeIntent,
      compiledPromptBundle: clip.compiledPromptBundle,
    };
    const nextD = {
      compiledVideoDirection: directorCompile.compiledVideoDirection,
      compiledAudioDirection: directorCompile.compiledAudioDirection,
      compiledCreativeIntent: directorCompile.compiledCreativeIntent,
      compiledPromptBundle: directorCompile.compiledPromptBundle,
    };
    if (!directorCompiledPayloadEqual(prevD, nextD)) {
      patchPayload.compiledVideoDirection = directorCompile.compiledVideoDirection;
      patchPayload.compiledAudioDirection = directorCompile.compiledAudioDirection;
      patchPayload.compiledCreativeIntent = directorCompile.compiledCreativeIntent;
      patchPayload.compiledPromptBundle = directorCompile.compiledPromptBundle;
    }
    if (
      audioDesignBundle &&
      !audioDesignBundleContentEqual(clip.compiledAudioDesignBundle || null, audioDesignBundle)
    ) {
      patchPayload.compiledAudioDesignBundle = audioDesignBundle;
    }
    if (Object.keys(patchPayload).length) onPatch(patchPayload);
  }, [
    briefs,
    directorCompile,
    audioDesignBundle,
    clip?.id,
    clip?.clipDirectionPromptFinal,
    clip?.clipAudioDirectionPrompt,
    clip?.clipCreativeBriefFinal,
    clip?.compiledVideoDirection,
    clip?.compiledAudioDirection,
    clip?.compiledCreativeIntent,
    clip?.compiledPromptBundle,
    clip?.compiledAudioDesignBundle,
    onPatch,
  ]);

  const togglePresentChar = (ref, on) => {
    const cur = new Set(clip.clipPresentCharacterIds || []);
    if (on) cur.add(ref);
    else cur.delete(ref);
    patch({ clipPresentCharacterIds: [...cur] });
  };

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
  const isNarrated = clip.clipType !== CLIP_TYPE.DIALOGUE;

  const clipTypeLabel = isNarrated ? "Narrato" : "Dialogato";
  const sceneTitle = scene?.title_it || clip.sceneId || "—";
  const narOrDialPreview = isNarrated
    ? String(clip.narratorText || "").trim() || "—"
    : (clip.dialogLines || [])
        .map((l) => {
          const ch = cmap.get(l.characterId);
          return `${ch?.name || "?"}: ${String(l.text || "").trim()}`;
        })
        .join("\n") || "—";

  const modal = (
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
        padding: "clamp(10px, 2.5vw, 20px)",
      }}
    >
      <div
        style={{
          width: "min(1180px, calc(100vw - 20px))",
          height: "min(96vh, 1080px)",
          maxHeight: "min(96vh, 1080px)",
          minHeight: "min(520px, 92vh)",
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
              Clip Builder · AXSTUDIO
            </div>
            <div style={{ fontSize: 11, color: ax.muted, marginTop: 2 }}>
              Passo {step} di 7 · {stepMeta.label}
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

        <div style={{ padding: "8px 16px 10px", borderBottom: `1px solid ${ax.border}`, background: ax.surface, flexShrink: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, rowGap: 6 }}>
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

        <div
          className="ax-modal-scroll-y"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            padding: "20px 22px 24px",
            WebkitOverflowScrolling: "touch",
            scrollbarGutter: "stable",
          }}
        >
          {/* Step 1 — Tipo, titolo, scena */}
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Tipo di clip</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => setClipType(CLIP_TYPE.NARRATED)}
                    style={{
                      padding: 14,
                      borderRadius: 12,
                      border: isNarrated ? `2px solid ${ax.electric}` : `1px solid ${ax.border}`,
                      background: isNarrated ? "rgba(41,182,255,0.08)" : ax.bg,
                      color: ax.text,
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>Narrato</div>
                    <div style={{ fontSize: 12, color: ax.text2, lineHeight: 1.45 }}>
                      Voce fuori campo: narratore guida il clip; focus su regia e atmosfera.
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setClipType(CLIP_TYPE.DIALOGUE)}
                    style={{
                      padding: 14,
                      borderRadius: 12,
                      border: !isNarrated ? `2px solid ${ax.violet}` : `1px solid ${ax.border}`,
                      background: !isNarrated ? "rgba(123,77,255,0.1)" : ax.bg,
                      color: ax.text,
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>Dialogato</div>
                    <div style={{ fontSize: 12, color: ax.text2, lineHeight: 1.45 }}>
                      Battute e personaggi parlanti. H8: TTS ElevenLabs separato per battuta con voice master (o override battuta); i segmenti si concatenano in un unico file dialogo.
                    </div>
                  </button>
                </div>
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Titolo clip</div>
                <input
                  value={clip.title || ""}
                  onChange={(e) => patch({ title: e.target.value, label: e.target.value })}
                  placeholder="es. Nazaret — apertura dal cielo"
                  style={selectStyle(ax)}
                />
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Scena sorgente (approvata)</div>
                <select
                  value={clip.sceneId || ""}
                  onChange={(e) => patch({ sceneId: e.target.value })}
                  style={selectStyle(ax)}
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
                    <HiMap size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                    Personaggi nel piano per questa scena:{" "}
                    <strong style={{ color: ax.text }}>{presentChars.map((c) => c.name).join(", ") || "—"}</strong>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step 2 — Contenuto */}
          {step === 2 && isNarrated && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Testo narratore</div>
                <textarea
                  value={clip.narratorText || ""}
                  onChange={(e) => patch({ narratorText: e.target.value })}
                  rows={5}
                  placeholder="Ciò che il narratore dice in voce…"
                  style={{ ...selectStyle(ax), resize: "vertical", minHeight: 100 }}
                />
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Cosa succede visivamente</div>
                <textarea
                  value={clip.clipVisualActionSummary || ""}
                  onChange={(e) => patch({ clipVisualActionSummary: e.target.value })}
                  rows={3}
                  placeholder="Breve descrizione dell’azione o delle immagini che il pubblico vede…"
                  style={{ ...selectStyle(ax), resize: "vertical" }}
                />
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Personaggi presenti nel clip</div>
                <p style={{ fontSize: 11, color: ax.muted, marginBottom: 8 }}>Spunta chi compare visivamente o è centrale per questo momento.</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {presentChars.length === 0 && <span style={{ fontSize: 12, color: ax.muted }}>Nessun personaggio nel piano per questa scena.</span>}
                  {presentChars.map((c) => {
                    const ref = stableCharacterKey(c);
                    const on = (clip.clipPresentCharacterIds || []).includes(ref);
                    return (
                      <label key={ref} style={rowToggle(ax)}>
                        <input type="checkbox" checked={on} onChange={(e) => togglePresentChar(ref, e.target.checked)} />
                        {c.name}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Obiettivo narrativo del clip</div>
                <textarea
                  value={clip.clipNarrativeGoal || ""}
                  onChange={(e) => patch({ clipNarrativeGoal: e.target.value })}
                  rows={3}
                  placeholder="Che funzione ha questo clip nel capitolo? Cosa deve lasciare allo spettatore?"
                  style={{ ...selectStyle(ax), resize: "vertical" }}
                />
              </div>
            </div>
          )}

          {step === 2 && !isNarrated && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                style={{
                  ...cardPad(),
                  borderColor: ax.violet,
                  background: "rgba(123,77,255,0.06)",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 800, color: ax.violet, letterSpacing: "0.04em", marginBottom: 6 }}>
                  Dialogato · H8 multi-voice
                </div>
                <p style={{ fontSize: 12, color: ax.text2, lineHeight: 1.55, margin: 0 }}>
                  Pipeline H8: una chiamata TTS per battuta con la voce del personaggio (voice master o override sulla riga); pause brevi tra battute; file WAV unico per Kling/mix.
                </p>
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Cosa fanno i personaggi nel clip</div>
                <textarea
                  value={clip.clipDialogActionSummary || ""}
                  onChange={(e) => patch({ clipDialogActionSummary: e.target.value })}
                  rows={3}
                  placeholder="Azioni, gesti, dinamica tra i personaggi…"
                  style={{ ...selectStyle(ax), resize: "vertical" }}
                />
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Personaggi presenti / in campo</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {presentChars.map((c) => {
                    const ref = stableCharacterKey(c);
                    const on = (clip.clipPresentCharacterIds || []).includes(ref);
                    return (
                      <label key={ref} style={rowToggle(ax)}>
                        <input type="checkbox" checked={on} onChange={(e) => togglePresentChar(ref, e.target.checked)} />
                        {c.name}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Obiettivo narrativo del clip</div>
                <textarea
                  value={clip.clipNarrativeGoal || ""}
                  onChange={(e) => patch({ clipNarrativeGoal: e.target.value })}
                  rows={2}
                  placeholder="Ruolo del dialogo nella scena…"
                  style={{ ...selectStyle(ax), resize: "vertical" }}
                />
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
                <div style={{ fontSize: 12, color: ax.muted }}>Aggiungi almeno una battuta.</div>
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
                    <div style={{ marginBottom: 10 }}>
                      <div style={fieldLabel()}>Chi parla</div>
                      <select
                        value={lineRef}
                        onChange={(e) => {
                          const cid = e.target.value;
                          const rawVm = voiceMasterRawForRef(characterVoiceMasters, cid, plan);
                          updateLine(idx, { characterId: cid, voiceId: rawVm?.voiceId || "" });
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
                    <div>
                      <div style={fieldLabel()}>Testo</div>
                      <textarea
                        value={line.text}
                        onChange={(e) => updateLine(idx, { text: e.target.value })}
                        rows={3}
                        style={{ ...selectStyle(ax), resize: "vertical", minHeight: 64 }}
                      />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
                      <div>
                        <div style={fieldLabel()}>Azione (note)</div>
                        <input value={line.action} onChange={(e) => updateLine(idx, { action: e.target.value })} style={selectStyle(ax)} placeholder="Opzionale" />
                      </div>
                      <div>
                        <div style={fieldLabel()}>Espressione</div>
                        <input value={line.expression} onChange={(e) => updateLine(idx, { expression: e.target.value })} style={selectStyle(ax)} placeholder="Opzionale" />
                      </div>
                      <div>
                        <div style={fieldLabel()}>Movimento</div>
                        <input value={line.bodyMovement} onChange={(e) => updateLine(idx, { bodyMovement: e.target.value })} style={selectStyle(ax)} placeholder="Opzionale" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Step 3 — Audio e voce */}
          {step === 3 && isNarrated && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Narratore per questo clip</div>
                <p style={{ fontSize: 11, color: ax.muted, margin: "0 0 10px", lineHeight: 1.5 }}>
                  Con narratori di progetto (fase Personaggi): usa il predefinito o scegli un narratore; oppure «Voce solo
                  su questo clip» per compatibilità con progetti vecchi o override puntuale.
                </p>
                <select
                  value={narratedClipNarratorControlValue(clip)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === PROJECT_DEFAULT) {
                      patch({ narratorId: null, narratorVoice: null });
                      return;
                    }
                    if (v === CLIP_EMBEDDED) {
                      patch({ narratorId: null });
                      return;
                    }
                    patch({ narratorId: v, narratorVoice: null });
                  }}
                  style={selectStyle(ax)}
                >
                  <option value={PROJECT_DEFAULT}>
                    {narratorsList.length
                      ? "Narratore predefinito di progetto (automatico)"
                      : "Automatico (nessun narratore in lista — vedi sotto)"}
                  </option>
                  {narratorsList.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                      {n.isDefaultNarrator ? " ★" : ""}
                    </option>
                  ))}
                  <option value={CLIP_EMBEDDED}>Voce solo su questo clip (override / legacy)</option>
                </select>
                {narratedClipNarratorControlValue(clip) === CLIP_EMBEDDED ? (
                  <div style={{ marginTop: 12 }}>
                    <ScenografieCharacterVoicePicker
                      ax={ax}
                      compact
                      vm={normalizeCharacterVoiceMaster(
                        {
                          characterId: "clip_embedded_narrator",
                          voiceId: clip.narratorVoice?.voiceId || "",
                          voiceLabel: clip.narratorVoice?.voiceLabel || "",
                          voiceProvider: "elevenlabs",
                          voiceSourceType: "",
                          voicePreviewUrl: "",
                          voiceAssignedAt: null,
                          voiceCatalogSnapshot: null,
                          voiceAssignmentHistory: [],
                          isNarratorDefault: false,
                          elevenLabs: {},
                        },
                        "clip_embedded_narrator",
                      )}
                      disabled={pipelineLocked || pipelineBusy}
                      onAssign={(partial) =>
                        patch({
                          narratorVoice: normalizeNarratorVoice({
                            voiceId: partial.voiceId,
                            voiceLabel: partial.voiceLabel,
                            voiceProvider: "elevenlabs",
                          }),
                        })
                      }
                    />
                  </div>
                ) : null}
                {narratorsList.length === 0 ? (
                  <p style={{ fontSize: 10, color: ax.muted, margin: "10px 0 0" }}>
                    Nessun narratore in progetto: aggiungine dalla fase «Generazione personaggi» oppure usa «Voce solo su
                    questo clip».
                  </p>
                ) : null}
              </div>
              <div style={{ ...cardPad(), display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div>
                  <div style={fieldLabel()}>Tono narratore</div>
                  <select value={clip.narratorDeliveryTone || ""} onChange={(e) => patch({ narratorDeliveryTone: e.target.value })} style={selectStyle(ax)}>
                    {CLIP_NARRATOR_TONE.map((o) => (
                      <option key={o.id || "x"} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={fieldLabel()}>Ritmo lettura</div>
                  <select value={clip.narratorPace || ""} onChange={(e) => patch({ narratorPace: e.target.value })} style={selectStyle(ax)}>
                    {CLIP_NARRATOR_PACE.map((o) => (
                      <option key={o.id || "x"} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={fieldLabel()}>Pause naturali</div>
                  <select value={clip.narratorPauseStyle || ""} onChange={(e) => patch({ narratorPauseStyle: e.target.value })} style={selectStyle(ax)}>
                    {CLIP_NARRATOR_PAUSES.map((o) => (
                      <option key={o.id || "x"} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Indicazioni audio aggiuntive</div>
                <textarea
                  value={clip.clipAudioDirection || ""}
                  onChange={(e) => patch({ clipAudioDirection: e.target.value })}
                  rows={2}
                  placeholder="Es. sottovoce sul finale, enfasi sul nome del luogo…"
                  style={{ ...selectStyle(ax), resize: "vertical" }}
                />
              </div>
            </div>
          )}

          {step === 3 && !isNarrated && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ ...cardPad(), display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={fieldLabel()}>Tono delle battute</div>
                  <select value={clip.dialogueDeliveryTone || ""} onChange={(e) => patch({ dialogueDeliveryTone: e.target.value })} style={selectStyle(ax)}>
                    {CLIP_DIALOGUE_TONE.map((o) => (
                      <option key={o.id || "x"} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={fieldLabel()}>Chi parla per primo (roadmap regia)</div>
                  <select
                    value={resolveLineCharacterRef(
                      presentChars.length ? presentChars : plan?.characters || [],
                      clip.dialogFirstSpeakerId,
                    )}
                    onChange={(e) => patch({ dialogFirstSpeakerId: e.target.value })}
                    style={selectStyle(ax)}
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
                </div>
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Narratore esterno (opzionale)</div>
                <textarea
                  value={clip.clipExternalNarratorNote || ""}
                  onChange={(e) => patch({ clipExternalNarratorNote: e.target.value })}
                  rows={2}
                  placeholder="Se un voce fuori campo accompagna o incornicia il dialogo, descrivilo qui…"
                  style={{ ...selectStyle(ax), resize: "vertical" }}
                />
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Voice master personaggi (ElevenLabs)</div>
                <p style={{ fontSize: 11, color: ax.muted, marginBottom: 10, lineHeight: 1.45 }}>
                  Catalogo da API (Le mie voci + libreria) e preset IT .env. Obbligatorio: voice ID risolvibile per ogni
                  parlante. Puoi modificare la voce in qualsiasi momento; i clip già generati restano con l&apos;audio
                  precedente finché non li rigeneri.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
                          background: ax.surface || ax.bg,
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700, color: ax.text, marginBottom: 8 }}>
                          <HiUser size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                          {c.name}
                        </div>
                        <ScenografieCharacterVoicePicker
                          ax={ax}
                          compact
                          vm={vm}
                          disabled={pipelineLocked || pipelineBusy}
                          onAssign={(partial) => onVoiceMasterPatch(c.id, partial)}
                        />
                        <label style={{ ...rowToggle(ax), marginTop: 8 }}>
                          <input
                            type="checkbox"
                            checked={vm.isNarratorDefault}
                            disabled={pipelineLocked || pipelineBusy}
                            onChange={(e) => onVoiceMasterPatch(c.id, { isNarratorDefault: e.target.checked })}
                          />
                          Default narratore
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Step 4 — Durata e regia */}
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
                <label style={rowToggle(ax)}>
                  <input type="radio" checked={clip.durationMode !== "manual"} onChange={() => patch({ durationMode: "auto", durationSeconds: null })} />
                  Automatica (da testo / battute)
                </label>
                <label style={rowToggle(ax)}>
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
              <div style={{ ...cardPad(), display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={fieldLabel()}>Tipo apertura</div>
                  <select value={clip.clipOpeningStyle || ""} onChange={(e) => patch({ clipOpeningStyle: e.target.value })} style={selectStyle(ax)}>
                    {CLIP_OPENING_STYLES.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={fieldLabel()}>Tipo chiusura</div>
                  <select value={clip.clipClosingStyle || ""} onChange={(e) => patch({ clipClosingStyle: e.target.value })} style={selectStyle(ax)}>
                    {CLIP_CLOSING_STYLES.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ ...cardPad(), display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={fieldLabel()}>Movimento camera (preset)</div>
                  <select value={clip.clipCameraPreset || ""} onChange={(e) => patch({ clipCameraPreset: e.target.value })} style={selectStyle(ax)}>
                    {NARRATED_CAMERA_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={fieldLabel()}>Intensità movimento</div>
                  <select value={clip.clipCameraIntensity || ""} onChange={(e) => patch({ clipCameraIntensity: e.target.value })} style={selectStyle(ax)}>
                    {CLIP_CAMERA_INTENSITY.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ ...cardPad(), display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={fieldLabel()}>Focus visivo principale</div>
                  <select value={clip.clipFocusSubject || ""} onChange={(e) => patch({ clipFocusSubject: e.target.value })} style={selectStyle(ax)}>
                    {CLIP_FOCUS_SUBJECT.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                {!isNarrated && (
                  <div>
                    <div style={fieldLabel()}>Comportamento camera (dialogo)</div>
                    <select value={clip.cameraDirection || ""} onChange={(e) => patch({ cameraDirection: e.target.value })} style={selectStyle(ax)}>
                      {DIALOGUE_CAMERA_BEHAVIORS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Progressione del clip (note)</div>
                <textarea
                  value={clip.clipProgressionNote || ""}
                  onChange={(e) => patch({ clipProgressionNote: e.target.value })}
                  rows={2}
                  placeholder="Come evolve il momento: es. parte ampia, stringe sul volto…"
                  style={{ ...selectStyle(ax), resize: "vertical" }}
                />
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Intensità emotiva (legacy / mix)</div>
                <select value={clip.emotionalIntensity || "medium"} onChange={(e) => patch({ emotionalIntensity: e.target.value })} style={selectStyle(ax)}>
                  <option value="low">Bassa</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                </select>
              </div>
            </div>
          )}

          {/* Step 5 — Musica, ambiente, tono */}
          {step === 5 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ ...cardPad(), borderColor: "rgba(34,197,94,0.35)" }}>
                <div style={{ ...fieldLabel(), color: "#4ade80" }}>Audio Design Engine</div>
                <p style={{ fontSize: 12, color: ax.text, lineHeight: 1.55, margin: "6px 0 0" }}>
                  Le scelte qui sotto alimentano il motore <strong>audio design</strong>: alla chiusura del wizard viene compilato un{" "}
                  <code style={{ fontSize: 10 }}>compiledAudioDesignBundle</code> (musica, ambiente, effetti, intenzione di mix) e salvato sul clip. Con «Genera clip»,{" "}
                  <strong>H6</strong> tenta <strong>musica provider</strong> (FAL Stable Audio di default, ElevenLabs compose se imposti preferenza o env), normalizza lo stem alla voce e mixa; in fallback usa il pad musica MVP. <strong>H4</strong> resta su pad <strong>ambiente/SFX MVP</strong> (sintetici). Libreria licenziata / cataloghi / cue pre-approvati sono step futuri sullo stesso contratto stem.
                </p>
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Tono emotivo del clip</div>
                <textarea
                  value={clip.clipEmotionalTone || ""}
                  onChange={(e) => patch({ clipEmotionalTone: e.target.value, mood: e.target.value })}
                  rows={2}
                  placeholder="Es. solenne e dolce, intimo, senso di attesa…"
                  style={{ ...selectStyle(ax), resize: "vertical" }}
                />
              </div>
              <div style={{ ...cardPad(), display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={fieldLabel()}>Musica</div>
                  <select
                    value={clip.clipMusicMood || "none"}
                    onChange={(e) => {
                      const id = e.target.value;
                      patch({ clipMusicMood: id, backgroundMusicEnabled: id !== "none" });
                    }}
                    style={selectStyle(ax)}
                  >
                    {CLIP_MUSIC_MOOD.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={fieldLabel()}>Suoni ambiente</div>
                  <select
                    value={clip.clipAmbientSoundPreset || "none"}
                    onChange={(e) => {
                      const id = e.target.value;
                      patch({ clipAmbientSoundPreset: id, ambientSoundEnabled: id !== "none" });
                    }}
                    style={selectStyle(ax)}
                  >
                    {CLIP_AMBIENT_PRESET.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Energia complessiva</div>
                <select value={clip.clipEnergyLevel || ""} onChange={(e) => patch({ clipEnergyLevel: e.target.value })} style={selectStyle(ax)}>
                  {CLIP_ENERGY_LEVEL.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <label
                style={{
                  ...cardPad(),
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  cursor: "pointer",
                  margin: 0,
                }}
              >
                <input
                  type="checkbox"
                  checked={clip.effectsEnabled === true}
                  onChange={(e) => patch({ effectsEnabled: e.target.checked })}
                  style={{ marginTop: 3 }}
                />
                <span style={{ fontSize: 12, color: ax.text, lineHeight: 1.45 }}>
                  <strong style={{ display: "block", marginBottom: 4 }}>Effetti sonori / sound design</strong>
                  Includi indicazioni per rumori puntuali, transizioni e dettaglio nel brief audio automatico.
                </span>
              </label>
              <p style={{ fontSize: 11, color: ax.muted, lineHeight: 1.55, margin: 0 }}>
                Persistiti sul clip e inclusi nel piano audio strutturato (vedi riepilogo passo 7). Modifiche qui aggiornano automaticamente il bundle al salvataggio.
              </p>
            </div>
          )}

          {/* Step 6 — Prompt regia clip */}
          {step === 6 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ ...cardPad(), borderColor: `rgba(41,182,255,0.35)` }}>
                <div style={{ ...fieldLabel(), color: ax.electric }}>Prompt regia clip</div>
                <p style={{ fontSize: 11, color: ax.text2, marginBottom: 10, lineHeight: 1.55 }}>
                  Istruzioni creative per il motore: come si muove la camera, cosa si vede per primo, atmosfera, respiro dello shot. Questo dato è persistito e tracciato in console all’avvio della pipeline.
                </p>
                <textarea
                  value={clip.clipDirectionPrompt || ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    patch({
                      clipDirectionPrompt: v,
                      lastClipDirectionPromptEditedAt: new Date().toISOString(),
                    });
                  }}
                  rows={8}
                  placeholder="Es. Apertura cinematografica da molto lontano. La camera attraversa lentamente il cielo…"
                  style={{ ...selectStyle(ax), resize: "vertical", minHeight: 160, fontSize: 13, lineHeight: 1.5 }}
                />
              </div>
              <div style={cardPad()}>
                <div style={fieldLabel()}>Sintesi regia (opzionale)</div>
                <textarea
                  value={clip.clipDirectionSummary || ""}
                  onChange={(e) => patch({ clipDirectionSummary: e.target.value })}
                  rows={2}
                  placeholder="Una riga per scheda / export…"
                  style={{ ...selectStyle(ax), resize: "vertical" }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const src = String(clip.clipDirectionPrompt || "").trim();
                    if (!src) return;
                    patch({ clipDirectionSummary: src.length > 200 ? `${src.slice(0, 197)}…` : src });
                  }}
                  style={{ marginTop: 8, ...ghostSm(ax) }}
                >
                  Compila sintesi dai primi caratteri del prompt
                </button>
              </div>
            </div>
          )}

          {/* Step 7 — Riepilogo e generazione */}
          {step === 7 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: ax.muted, textTransform: "uppercase" }}>Passo 7</span>
                <button
                  type="button"
                  onClick={() => setConsumerBriefMode(true)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: `1px solid ${consumerBriefMode ? ax.electric : ax.border}`,
                    background: consumerBriefMode ? "rgba(41,182,255,0.15)" : "transparent",
                    color: consumerBriefMode ? ax.electric : ax.text2,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Vista guidata
                </button>
                <button
                  type="button"
                  onClick={() => setConsumerBriefMode(false)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: `1px solid ${!consumerBriefMode ? ax.violet : ax.border}`,
                    background: !consumerBriefMode ? "rgba(123,77,255,0.12)" : "transparent",
                    color: !consumerBriefMode ? "#c4b5fd" : ax.text2,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Vista completa (tecnica)
                </button>
              </div>
              {consumerBriefMode ? clipStep7ConsumerGuide(ax, executionPreview, clip, readiness) : null}
              <div style={cardPad()}>
                <div style={{ ...fieldLabel(), color: ax.text }}>Riepilogo</div>
                <div style={{ marginTop: 4 }}>
                  {summaryRow(ax, "Tipo clip", clipTypeLabel)}
                  {summaryRow(ax, "Titolo", clip.title || "—")}
                  {summaryRow(ax, "Scena", sceneTitle)}
                  {summaryRow(ax, "Durata", clip.durationMode === "manual" && effectiveDur != null ? `${effectiveDur}s (manuale)` : `${autoSec || "—"}s (stima auto)`)}
                  {summaryRow(ax, "Narrazione / dialoghi", narOrDialPreview)}
                  {summaryRow(ax, "Voce", isNarrated ? clip.narratorVoice?.voiceLabel || clip.narratorVoice?.voiceId || "—" : "Voice master (vedi passo 3)")}
                  {summaryRow(ax, "Apertura / chiusura", `${optionLabel(CLIP_OPENING_STYLES, clip.clipOpeningStyle)} → ${optionLabel(CLIP_CLOSING_STYLES, clip.clipClosingStyle)}`)}
                  {summaryRow(ax, "Camera", `${optionLabel(NARRATED_CAMERA_PRESETS, clip.clipCameraPreset)} · intensità ${optionLabel(CLIP_CAMERA_INTENSITY, clip.clipCameraIntensity)}`)}
                  {summaryRow(ax, "Focus visivo", optionLabel(CLIP_FOCUS_SUBJECT, clip.clipFocusSubject))}
                  {summaryRow(ax, "Tono emotivo", clip.clipEmotionalTone || "—")}
                  {summaryRow(ax, "Musica / ambiente", `${optionLabel(CLIP_MUSIC_MOOD, clip.clipMusicMood)} · ${optionLabel(CLIP_AMBIENT_PRESET, clip.clipAmbientSoundPreset)}`)}
                  {summaryRow(ax, "Effetti / sound design", clip.effectsEnabled ? "Sì" : "No")}
                  {summaryRow(ax, "Energia", optionLabel(CLIP_ENERGY_LEVEL, clip.clipEnergyLevel))}
                  {summaryRow(ax, "Prompt regia", String(clip.clipDirectionPrompt || "").trim() || "—")}
                </div>
              </div>

              {consumerBriefMode ? (
                <details
                  style={{
                    borderRadius: 12,
                    border: `1px solid ${ax.border}`,
                    background: "rgba(0,0,0,0.12)",
                    padding: "10px 12px",
                  }}
                >
                  <summary
                    style={{
                      cursor: "pointer",
                      fontWeight: 800,
                      fontSize: 13,
                      color: ax.electric,
                      userSelect: "none",
                    }}
                  >
                    Dettagli tecnici (testi, strategia video, Director…)
                  </summary>
                  <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>{step7TechnicalStack}</div>
                </details>
              ) : (
                step7TechnicalStack
              )}

              {!readiness.ok && (
                <div style={{ ...cardPad(), borderColor: "rgba(248,113,113,0.35)" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#fca5a5", marginBottom: 6 }}>Completa prima di generare</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: ax.text2, lineHeight: 1.55 }}>
                    {readiness.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {clip.lastGenerationError && clip.status === SCENE_VIDEO_CLIP_STATUS.FAILED && (
                <div style={{ ...cardPad(), borderColor: "rgba(248,113,113,0.35)" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#fca5a5", marginBottom: 6 }}>Generazione non riuscita</div>
                  <div style={{ fontSize: 12, color: ax.text2, lineHeight: 1.5 }}>
                    {clip.lastWorkflowFailure?.errorMessageUser || clip.lastGenerationError}
                  </div>
                  {clip.lastWorkflowFailure?.suggestedAction ? (
                    <div style={{ fontSize: 11, color: ax.muted, marginTop: 8 }}>
                      Suggerimento:{" "}
                      <strong style={{ color: ax.text }}>
                        {SUGGESTED_ACTION_LABEL_IT[clip.lastWorkflowFailure.suggestedAction] ||
                          clip.lastWorkflowFailure.suggestedAction}
                      </strong>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: ax.muted, marginTop: 8 }}>
                      Puoi correggere i dati sopra e usare di nuovo «Genera» sulla clip.
                    </div>
                  )}
                  {clip.lastWorkflowFailure?.errorMessageTechnical ? (
                    <details style={{ marginTop: 8, fontSize: 10, color: ax.muted }}>
                      <summary style={{ cursor: "pointer" }}>Dettaglio tecnico</summary>
                      <pre style={{ whiteSpace: "pre-wrap", margin: "6px 0 0", fontFamily: "monospace" }}>
                        {String(clip.lastWorkflowFailure.errorMessageTechnical)}
                      </pre>
                    </details>
                  ) : null}
                  {clip.clipPipelineLastFailedAt ? (
                    <div style={{ fontSize: 10, color: ax.muted, marginTop: 6 }}>Ultimo tentativo: {clip.clipPipelineLastFailedAt}</div>
                  ) : null}
                </div>
              )}

              {pipelineBusy && (
                <div style={{ ...cardPad(), borderColor: `rgba(41,182,255,0.35)`, display: "flex", alignItems: "center", gap: 10 }}>
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
                  <video src={clip.videoUrl} controls style={{ width: "100%", maxHeight: 220, borderRadius: 10, background: "#000" }} />
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
                      ? "Avvia ElevenLabs → fal → Kling"
                      : readiness.reasons.join(" · ")
                }
                style={{
                  padding: "14px 18px",
                  borderRadius: 12,
                  border: "none",
                  background: readiness.ok && !pipelineBusy ? ax.gradPrimary : ax.border,
                  color: readiness.ok && !pipelineBusy ? "#fff" : ax.muted,
                  fontWeight: 800,
                  fontSize: 14,
                  cursor: pipelineLocked || pipelineBusy || !readiness.ok ? "not-allowed" : "pointer",
                  opacity: pipelineLocked ? 0.5 : 1,
                }}
              >
                <HiSparkles size={18} style={{ verticalAlign: "middle", marginRight: 8 }} />
                Genera clip
              </button>
              <p style={{ fontSize: 11, color: ax.text2, lineHeight: 1.45, marginTop: 0 }}>
                Richiede <code style={{ fontSize: 10 }}>REACT_APP_ELEVENLABS_API_KEY</code> e <code style={{ fontSize: 10 }}>REACT_APP_FAL_API_KEY</code>. I brief creativi (regia, audio, sintesi) e il prompt autore sono loggati in console all’avvio pipeline.
              </p>

              <div style={cardPad()}>
                <div style={fieldLabel()}>Note integrative (revisione)</div>
                <textarea
                  value={clip.lastEditPrompt || ""}
                  onChange={(e) => patch({ lastEditPrompt: e.target.value || null })}
                  rows={2}
                  placeholder="Note interne per iterazione o feedback (opzionale)"
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
            padding: "14px 20px",
            borderTop: `1px solid ${ax.border}`,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
            background: ax.surface,
          }}
        >
          <button type="button" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step <= 1} style={ghostSm(ax)}>
            Indietro
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {step < 7 && (
              <button type="button" onClick={() => setStep((s) => Math.min(7, s + 1))} style={primarySm(ax)}>
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

  return createPortal(modal, document.body);
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
