/**
 * Modale / popover ancorato al launcher — contenuto guida AXSTUDIO.
 */

import React, { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HiXMark } from "react-icons/hi2";
import { AxstudioGuideBody } from "./AxstudioGuidePanel.js";

const DEFAULT_AX = {
  border: "#23232e",
  surface: "#13131a",
  card: "#1a1a24",
  text: "#f4f4f8",
  muted: "#6b6b80",
  electric: "#29b6ff",
};

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   launcherRef: { current: HTMLElement | null },
 *   ax?: typeof DEFAULT_AX,
 *   stepId: string,
 *   snapshot: Record<string, unknown>,
 *   model: import("../../services/axstudioCopilotHeuristics.js").AxstudioCopilotGuideModel,
 *   guidedMode: boolean,
 *   onGuideAction: (action: Record<string, unknown>) => void,
 *   advancedExpanded: boolean,
 *   onToggleAdvanced: () => void,
 * }} props
 */
export function AxstudioCopilotModal({
  open,
  onClose,
  launcherRef,
  ax: axProp,
  stepId,
  snapshot,
  model,
  guidedMode,
  onGuideAction,
  advancedExpanded,
  onToggleAdvanced,
}) {
  const ax = axProp || DEFAULT_AX;
  const [box, setBox] = useState(() => ({ top: 72, right: 24, width: 380 }));

  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const el = launcherRef?.current;
      if (!el || typeof window === "undefined") {
        setBox({ top: 72, right: 24, width: 380 });
        return;
      }
      const r = el.getBoundingClientRect();
      const pad = 8;
      const w = Math.min(400, Math.max(300, window.innerWidth - 32));
      const right = Math.max(12, window.innerWidth - r.right);
      setBox({
        top: r.bottom + pad,
        right,
        width: w,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, launcherRef]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const maxH = typeof window !== "undefined" ? Math.max(220, window.innerHeight - box.top - 24) : 480;

  return createPortal(
    <>
      <div
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 100090,
          background: "rgba(6,6,12,0.12)",
        }}
        onClick={onClose}
        onKeyDown={() => {}}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Assistente AXSTUDIO"
        style={{
          position: "fixed",
          top: box.top,
          right: box.right,
          width: box.width,
          maxHeight: maxH,
          zIndex: 100091,
          borderRadius: 16,
          border: `1px solid ${ax.border}`,
          borderTop: `2px solid ${ax.electric}`,
          background: `linear-gradient(165deg, ${ax.surface} 0%, ${ax.card} 52%, #0f0f16 100%)`,
          boxShadow: "0 28px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "6px 8px 0",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi assistente"
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: `1px solid ${ax.border}`,
              background: "transparent",
              color: ax.muted,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <HiXMark size={16} aria-hidden />
            Chiudi
          </button>
        </div>
        <div className="ax-modal-scroll-y" style={{ overflowY: "auto", overflowX: "hidden", flex: 1, minHeight: 0 }}>
          <AxstudioGuideBody
            ax={ax}
            stepId={stepId}
            snapshot={snapshot}
            model={model}
            guidedMode={guidedMode}
            onGuideAction={onGuideAction}
            advancedExpanded={advancedExpanded}
            onToggleAdvanced={onToggleAdvanced}
          />
        </div>
      </div>
    </>,
    document.body,
  );
}
