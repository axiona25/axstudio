/**
 * Shell e controlli condivisi tra modale creazione progetto libera e wizard guidato (Film Studio).
 */

import React from "react";
import { HiXMark } from "react-icons/hi2";

export const PC_AX = {
  bg: "#0a0a0f",
  surface: "#13131a",
  card: "#1a1a24",
  border: "#23232e",
  text: "#f4f4f8",
  text2: "#a1a1b5",
  muted: "#6b6b80",
  electric: "#29b6ff",
  violet: "#7b4dff",
  gradPrimary: "linear-gradient(135deg, #29b6ff 0%, #7b4dff 100%)",
};

export const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 100000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  background: "rgba(6,6,12,0.88)",
  backdropFilter: "blur(12px)",
};

export const modalDialogStyle = (maxWidth = 720) => ({
  width: "100%",
  maxWidth,
  borderRadius: 20,
  background: PC_AX.card,
  border: "1px solid rgba(41,182,255,0.18)",
  boxShadow:
    "0 32px 90px rgba(0,0,0,0.6), 0 0 0 1px rgba(123,77,255,0.12), 0 0 48px rgba(41,182,255,0.08)",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  maxHeight: "min(92vh, 900px)",
});

export const modalGradientBarStyle = { height: 3, background: PC_AX.gradPrimary, width: "100%", flexShrink: 0 };

export const labelStyle = {
  display: "block",
  fontSize: 11,
  fontWeight: 700,
  color: PC_AX.muted,
  marginBottom: 8,
  letterSpacing: "0.06em",
};

export const inputFieldStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(41,182,255,0.15)",
  background: "linear-gradient(180deg, rgba(22,22,30,0.98) 0%, rgba(13,13,18,1) 100%)",
  color: PC_AX.text,
  fontSize: 14,
  outline: "none",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
};

export const textareaFieldStyle = {
  ...inputFieldStyle,
  resize: "vertical",
  lineHeight: 1.5,
  fontFamily: "inherit",
};

export const modalCloseButtonStyle = (disabled) => ({
  flexShrink: 0,
  width: 40,
  height: 40,
  borderRadius: 10,
  border: `1px solid ${PC_AX.border}`,
  background: PC_AX.surface,
  color: PC_AX.text2,
  cursor: disabled ? "not-allowed" : "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
});

export const footerDividerStyle = {
  paddingTop: 4,
  borderTop: "1px solid rgba(255,255,255,0.06)",
};

export const btnSecondaryFooter = {
  padding: "10px 18px",
  borderRadius: 10,
  border: `1px solid ${PC_AX.border}`,
  background: PC_AX.surface,
  color: PC_AX.text2,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

export const btnPrimaryFooter = (disabled) => ({
  padding: "10px 22px",
  borderRadius: 10,
  border: "none",
  background: PC_AX.gradPrimary,
  color: "#fff",
  fontSize: 14,
  fontWeight: 700,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.45 : 1,
  boxShadow: disabled ? "none" : "0 4px 24px rgba(41,182,255,0.35), 0 0 20px rgba(123,77,255,0.12)",
});

/**
 * Griglia stili (stesso pattern modale libera).
 * @param {{ presets: Array<{ id: string, label: string }>, value: string, onChange: (id: string) => void, disabled?: boolean, maxHeight?: number }} props
 */
export function ProjectStylePresetGrid({ presets = [], value, onChange, disabled = false, maxHeight = 200 }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
        gap: 10,
        maxHeight,
        overflowY: "auto",
        padding: 10,
        borderRadius: 14,
        border: `1px solid ${PC_AX.border}`,
        background: "linear-gradient(165deg, rgba(26,26,36,0.5) 0%, rgba(15,15,22,0.65) 100%)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
      }}
    >
      {presets.map((pr) => {
        const on = value === pr.id;
        return (
          <button
            key={pr.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(pr.id)}
            style={{
              textAlign: "left",
              padding: "12px 12px",
              borderRadius: 12,
              border: on ? "1px solid rgba(41,182,255,0.55)" : `1px solid ${PC_AX.border}`,
              background: on
                ? "linear-gradient(145deg, rgba(41,182,255,0.14), rgba(123,77,255,0.08))"
                : "rgba(19,19,26,0.85)",
              color: PC_AX.text,
              cursor: disabled ? "not-allowed" : "pointer",
              fontSize: 12,
              fontWeight: 700,
              lineHeight: 1.35,
              transition: "border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease",
              boxShadow: on ? "0 0 22px rgba(41,182,255,0.18), inset 0 1px 0 rgba(255,255,255,0.05)" : "none",
            }}
          >
            {pr.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Header modale creazione (libera o guidata).
 * @param {{
 *   eyebrow: string,
 *   badge?: string,
 *   title: string,
 *   titleAdornment?: React.ReactNode,
 *   subtitle: React.ReactNode,
 *   onClose: () => void,
 *   closeDisabled?: boolean,
 *   titleId?: string,
 * }} props
 */
export function ProjectCreationModalHeader({ eyebrow, badge, title, titleAdornment, subtitle, onClose, closeDisabled = false, titleId }) {
  return (
    <div style={{ padding: "22px 24px 10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: PC_AX.muted, letterSpacing: "0.12em", marginBottom: 8 }}>{eyebrow}</div>
        {badge ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: PC_AX.electric,
              marginBottom: 8,
              padding: "4px 10px",
              borderRadius: 999,
              border: "1px solid rgba(41,182,255,0.35)",
              background: "rgba(41,182,255,0.08)",
            }}
          >
            {badge}
          </div>
        ) : null}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {titleAdornment}
          <h2 id={titleId} style={{ margin: 0, fontSize: 22, fontWeight: 800, color: PC_AX.text, letterSpacing: "-0.03em", lineHeight: 1.2 }}>{title}</h2>
        </div>
        <div style={{ margin: "10px 0 0", fontSize: 14, color: PC_AX.text2, lineHeight: 1.55, maxWidth: 560 }}>{subtitle}</div>
      </div>
      <button type="button" aria-label="Chiudi" onClick={onClose} disabled={closeDisabled} style={modalCloseButtonStyle(closeDisabled)}>
        <HiXMark size={20} />
      </button>
    </div>
  );
}
