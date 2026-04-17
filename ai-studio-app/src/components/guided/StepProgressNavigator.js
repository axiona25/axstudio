/**
 * Barra progresso wizard — step cliccabili, stati, warning prerequisiti.
 */

import React from "react";
import { HiCheck, HiExclamationTriangle, HiChevronRight, HiAdjustmentsHorizontal, HiStar } from "react-icons/hi2";

/** @typedef {{ id: string, label: string, anchor: string, status: string, prereqWarning: string|null, blocked?: boolean, blockedReason?: string|null, recommendedNext?: boolean }} WizardStepRow */

const DEFAULT_AX = {
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
};

function statusColor(ax, status) {
  switch (status) {
    case "complete":
      return "#4ade80";
    case "in_progress":
      return ax.electric;
    case "needs_review":
      return "#fbbf24";
    default:
      return ax.muted;
  }
}

function statusLabelIt(status) {
  switch (status) {
    case "complete":
      return "Completato";
    case "in_progress":
      return "In corso";
    case "needs_review":
      return "Da revisionare";
    default:
      return "Non iniziato";
  }
}

/**
 * @param {{
 *   ax?: typeof DEFAULT_AX,
 *   steps: WizardStepRow[],
 *   activeStepId: string,
 *   onSelectStep: (id: string) => void,
 *   guidedMode: boolean,
 *   onToggleGuidedMode: () => void,
 *   disabled?: boolean,
 * }} props
 */
export function StepProgressNavigator({
  ax: axProp,
  steps,
  activeStepId,
  onSelectStep,
  guidedMode,
  onToggleGuidedMode,
  disabled = false,
}) {
  const ax = axProp || DEFAULT_AX;

  return (
    <div
      style={{
        marginBottom: 18,
        padding: "14px 16px",
        borderRadius: 14,
        border: `1px solid ${ax.border}`,
        background: `linear-gradient(165deg, ${ax.surface} 0%, ${ax.card} 100%)`,
        boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", color: ax.muted, textTransform: "uppercase" }}>
          Percorso guidato AXSTUDIO
        </div>
        <button
          type="button"
          onClick={onToggleGuidedMode}
          disabled={disabled}
          title={
            guidedMode
              ? "Mostra solo il flusso (AXSTUDIO AI resta disponibile dall’icona in alto a destra)"
              : "Attiva scelte guidate e preset (assistente dall’icona AXSTUDIO accanto al badge Fal.ai)"
          }
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 999,
            border: `1px solid ${guidedMode ? ax.electric : ax.border}`,
            background: guidedMode ? "rgba(41,182,255,0.12)" : ax.surface,
            color: guidedMode ? ax.electric : ax.text2,
            fontSize: 11,
            fontWeight: 700,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.55 : 1,
          }}
        >
          <HiAdjustmentsHorizontal size={16} aria-hidden />
          {guidedMode ? "Modalità guidata" : "Modalità avanzata"}
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Step del workflow capitolo"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "stretch",
          gap: 8,
        }}
      >
        {steps.map((step, idx) => {
          const active = step.id === activeStepId;
          const dotColor = statusColor(ax, step.status);
          const warn = !!step.prereqWarning && step.status === "not_started";
          const blocked = step.blocked === true;
          const rec = step.recommendedNext === true;
          const tip = [step.blockedReason, step.prereqWarning, statusLabelIt(step.status)].filter(Boolean).join(" · ");
          return (
            <React.Fragment key={step.id}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                disabled={disabled}
                onClick={() => onSelectStep(step.id)}
                title={tip}
                style={{
                  flex: "1 1 88px",
                  minWidth: 72,
                  maxWidth: 140,
                  padding: "10px 8px",
                  borderRadius: 12,
                  border: active
                    ? `2px solid ${ax.electric}`
                    : blocked
                      ? `1px dashed ${ax.muted}`
                      : rec
                        ? `1px solid rgba(251,191,36,0.45)`
                        : `1px solid ${ax.border}`,
                  background: active ? "rgba(41,182,255,0.1)" : ax.bg,
                  color: ax.text,
                  cursor: disabled ? "not-allowed" : "pointer",
                  textAlign: "left",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  opacity: disabled ? 0.55 : 1,
                  boxShadow: active ? `0 0 24px -8px ${ax.electric}` : rec ? `0 0 18px -10px rgba(251,191,36,0.35)` : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: blocked ? ax.muted : dotColor,
                      flexShrink: 0,
                      boxShadow: step.status === "in_progress" && !blocked ? `0 0 10px ${dotColor}` : "none",
                    }}
                  />
                  {step.status === "complete" ? (
                    <HiCheck size={14} style={{ color: dotColor, flexShrink: 0 }} aria-hidden />
                  ) : rec ? (
                    <HiStar size={14} style={{ color: "#fbbf24", flexShrink: 0 }} aria-hidden />
                  ) : warn ? (
                    <HiExclamationTriangle size={14} style={{ color: "#fbbf24", flexShrink: 0 }} aria-hidden />
                  ) : blocked ? (
                    <HiExclamationTriangle size={14} style={{ color: ax.muted, flexShrink: 0 }} aria-hidden />
                  ) : (
                    <span style={{ fontSize: 9, fontWeight: 800, color: ax.muted }}>{idx + 1}</span>
                  )}
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    lineHeight: 1.25,
                    color: active ? ax.text : ax.text2,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {step.label}
                </span>
              </button>
              {idx < steps.length - 1 ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    color: ax.muted,
                    flex: "0 0 auto",
                    padding: "0 2px",
                  }}
                  aria-hidden
                >
                  <HiChevronRight size={14} />
                </div>
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
