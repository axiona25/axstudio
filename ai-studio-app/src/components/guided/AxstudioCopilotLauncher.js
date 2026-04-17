/**
 * Pulsante header — apre il copilota AXSTUDIO (modale).
 */

import React, { forwardRef } from "react";
import { HiSparkles } from "react-icons/hi2";

const DEFAULT_AX = {
  border: "#23232e",
  surface: "#13131a",
  text: "#f4f4f8",
  text2: "#a1a1b5",
  electric: "#29b6ff",
  violet: "#7b4dff",
  gradPrimary: "linear-gradient(135deg, #29b6ff 0%, #7b4dff 100%)",
};

/**
 * @param {{
 *   ax?: typeof DEFAULT_AX,
 *   attention?: boolean,
 *   onClick: () => void,
 *   ariaExpanded?: boolean,
 * }} props
 */
export const AxstudioCopilotLauncher = forwardRef(function AxstudioCopilotLauncher(
  { ax: axProp, attention = false, onClick, ariaExpanded = false },
  ref,
) {
  const ax = axProp || DEFAULT_AX;

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label="Apri assistente AXSTUDIO"
      aria-expanded={ariaExpanded}
      title="AXSTUDIO ti guida"
      className={attention ? "ax-copilot-launcher ax-copilot-launcher--attention" : "ax-copilot-launcher"}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 40,
        height: 40,
        borderRadius: 12,
        border: `1px solid ${attention ? "rgba(41,182,255,0.55)" : ax.border}`,
        background: attention ? "rgba(41,182,255,0.12)" : ax.surface,
        color: attention ? ax.electric : ax.text2,
        cursor: "pointer",
        flexShrink: 0,
        transition: "border-color 0.2s ease, background 0.2s ease, color 0.2s ease",
      }}
    >
      <HiSparkles size={22} aria-hidden style={{ opacity: 0.95 }} />
      {attention ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 7,
            height: 7,
            borderRadius: 999,
            background: "linear-gradient(135deg,#29b6ff,#ff4fa3)",
            boxShadow: "0 0 10px rgba(255,79,163,0.55)",
          }}
        />
      ) : null}
    </button>
  );
});
