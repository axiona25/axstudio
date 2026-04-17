/**
 * Shell minima per navigazione locale tra step del wizard (footer).
 */

import React from "react";
import { HiChevronLeft, HiChevronRight, HiSparkles } from "react-icons/hi2";

/**
 * @param {{
 *   ax?: Record<string, string>,
 *   stepLabel: string,
 *   stepStatusLabel?: string,
 *   prevId?: string|null,
 *   nextId?: string|null,
 *   onGoStep?: (id: string) => void,
 *   onOpenCopilot?: () => void,
 * }} props
 */
export function WizardStepPageFooter({
  ax: axProp,
  stepLabel,
  stepStatusLabel,
  prevId,
  nextId,
  onGoStep,
  onOpenCopilot,
}) {
  const ax = axProp || {
    border: "#23232e",
    surface: "#13131a",
    text: "#f4f4f8",
    text2: "#a1a1b5",
    muted: "#6b6b80",
    electric: "#29b6ff",
    violet: "#7b4dff",
    gradPrimary: "linear-gradient(135deg, #29b6ff 0%, #7b4dff 100%)",
  };

  return (
    <div
      style={{
        marginTop: 22,
        paddingTop: 16,
        borderTop: `1px solid ${ax.border}`,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: ax.text, letterSpacing: "-0.02em" }}>{stepLabel}</div>
        {stepStatusLabel ? (
          <div style={{ fontSize: 10, fontWeight: 600, color: ax.muted, marginTop: 4 }}>{stepStatusLabel}</div>
        ) : null}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          disabled={!prevId}
          onClick={() => prevId && onGoStep?.(prevId)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
            borderRadius: 10,
            border: `1px solid ${ax.border}`,
            background: ax.surface,
            color: ax.text2,
            fontSize: 11,
            fontWeight: 700,
            cursor: prevId ? "pointer" : "not-allowed",
            opacity: prevId ? 1 : 0.45,
          }}
        >
          <HiChevronLeft size={16} aria-hidden />
          Step precedente
        </button>
        <button
          type="button"
          disabled={!nextId}
          onClick={() => nextId && onGoStep?.(nextId)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
            borderRadius: 10,
            border: `1px solid ${ax.electric}`,
            background: "rgba(41,182,255,0.08)",
            color: ax.electric,
            fontSize: 11,
            fontWeight: 700,
            cursor: nextId ? "pointer" : "not-allowed",
            opacity: nextId ? 1 : 0.45,
          }}
        >
          Step successivo
          <HiChevronRight size={16} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => onOpenCopilot?.()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
            borderRadius: 10,
            border: "none",
            background: ax.gradPrimary,
            color: "#fff",
            fontSize: 11,
            fontWeight: 800,
            cursor: "pointer",
            boxShadow: "0 6px 18px rgba(123,77,255,0.22)",
          }}
        >
          <HiSparkles size={15} aria-hidden />
          AXSTUDIO AI
        </button>
      </div>
    </div>
  );
}
