/**
 * Primo bivio UX — scelta tra percorso guidato (wizard) o progetto libero (modale creazione classica).
 */

import React, { useEffect } from "react";
import { HiXMark, HiSparkles, HiFilm } from "react-icons/hi2";

const AX = {
  card: "#1a1a24",
  surface: "#13131a",
  border: "#23232e",
  text: "#f4f4f8",
  text2: "#a1a1b5",
  muted: "#6b6b80",
  electric: "#29b6ff",
  violet: "#7b4dff",
  gradPrimary: "linear-gradient(135deg, #29b6ff 0%, #7b4dff 100%)",
};

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   onChooseGuided: () => void,
 *   onChooseFree: () => void,
 *   disabled?: boolean,
 * }} props
 */
export default function ScenografieProjectStartChoiceModal({
  open,
  onClose,
  onChooseGuided,
  onChooseFree,
  disabled = false,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const cardBase = {
    textAlign: "left",
    padding: "22px 22px 20px",
    borderRadius: 16,
    border: `1px solid ${AX.border}`,
    background: "linear-gradient(165deg, rgba(26,26,36,0.98) 0%, rgba(15,15,22,0.99) 100%)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
    transition: "border-color 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease",
    boxShadow: "0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    minHeight: 168,
    boxSizing: "border-box",
  };

  return (
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
        background: "rgba(6,6,12,0.88)",
        backdropFilter: "blur(12px)",
      }}
      onClick={disabled ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="scenografie-start-choice-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 720,
          borderRadius: 20,
          background: AX.card,
          border: `1px solid rgba(41,182,255,0.18)`,
          boxShadow:
            "0 32px 90px rgba(0,0,0,0.6), 0 0 0 1px rgba(123,77,255,0.12), 0 0 48px rgba(41,182,255,0.08)",
          overflow: "hidden",
        }}
      >
        <div style={{ height: 3, background: AX.gradPrimary, width: "100%" }} />
        <div style={{ padding: "22px 24px 10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: AX.muted, letterSpacing: "0.12em", marginBottom: 8 }}>AXSTUDIO · FILM STUDIO</div>
            <h2 id="scenografie-start-choice-title" style={{ margin: 0, fontSize: 22, fontWeight: 800, color: AX.text, letterSpacing: "-0.03em", lineHeight: 1.2 }}>
              Come vuoi iniziare?
            </h2>
            <p style={{ margin: "10px 0 0", fontSize: 14, color: AX.text2, lineHeight: 1.55, maxWidth: 520 }}>
              Scegli il tipo di esperienza più adatta al tuo progetto.
            </p>
          </div>
          <button
            type="button"
            aria-label="Chiudi"
            onClick={onClose}
            disabled={disabled}
            style={{
              flexShrink: 0,
              width: 40,
              height: 40,
              borderRadius: 10,
              border: `1px solid ${AX.border}`,
              background: AX.surface,
              color: AX.text2,
              cursor: disabled ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <HiXMark size={20} />
          </button>
        </div>

        <div
          style={{
            padding: "8px 24px 26px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              onChooseGuided();
            }}
            style={cardBase}
            onMouseEnter={(e) => {
              if (disabled) return;
              e.currentTarget.style.borderColor = "rgba(123,77,255,0.55)";
              e.currentTarget.style.boxShadow =
                "0 8px 32px rgba(0,0,0,0.45), 0 0 28px rgba(123,77,255,0.18), inset 0 1px 0 rgba(255,255,255,0.06)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = AX.border;
              e.currentTarget.style.boxShadow = "0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)";
              e.currentTarget.style.transform = "none";
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: "linear-gradient(145deg, rgba(123,77,255,0.22), rgba(41,182,255,0.12))",
                border: "1px solid rgba(123,77,255,0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 20px rgba(123,77,255,0.15)",
              }}
            >
              <HiSparkles size={26} style={{ color: AX.violet }} aria-hidden />
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: AX.text, letterSpacing: "-0.02em" }}>Film guidato</div>
            <p style={{ margin: 0, fontSize: 13, color: AX.text2, lineHeight: 1.55, flex: 1 }}>
              AXSTUDIO ti accompagna step by step con wizard, suggerimenti, scelte consigliate e supporto AI.
            </p>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              onChooseFree();
            }}
            style={cardBase}
            onMouseEnter={(e) => {
              if (disabled) return;
              e.currentTarget.style.borderColor = "rgba(41,182,255,0.5)";
              e.currentTarget.style.boxShadow =
                "0 8px 32px rgba(0,0,0,0.45), 0 0 28px rgba(41,182,255,0.14), inset 0 1px 0 rgba(255,255,255,0.06)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = AX.border;
              e.currentTarget.style.boxShadow = "0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)";
              e.currentTarget.style.transform = "none";
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: "linear-gradient(145deg, rgba(41,182,255,0.18), rgba(26,26,36,0.9))",
                border: "1px solid rgba(41,182,255,0.32)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 18px rgba(41,182,255,0.12)",
              }}
            >
              <HiFilm size={26} style={{ color: AX.electric }} aria-hidden />
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: AX.text, letterSpacing: "-0.02em" }}>Film libero</div>
            <p style={{ margin: 0, fontSize: 13, color: AX.text2, lineHeight: 1.55, flex: 1 }}>
              Entra direttamente nel progetto e lavora in autonomia, senza percorso guidato.
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}
