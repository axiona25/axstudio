/**
 * Indicatore header — crediti fal.ai disponibili (diamante + badge numerico), stile AXSTUDIO.
 */

import React, { useCallback, useEffect, useId, useState } from "react";
import { fetchFalAccountCredits } from "../../services/falTransport.js";

const DEFAULT_AX = {
  border: "#23232e",
  surface: "#13131a",
  text: "#f4f4f8",
  text2: "#a1a1b5",
  muted: "#6b6b80",
  electric: "#29b6ff",
  violet: "#7b4dff",
  gradPrimary: "linear-gradient(135deg, #29b6ff 0%, #7b4dff 100%)",
};

const POLL_MS = 120000;

function formatCreditsDisplay(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "–";
  const abs = Math.abs(n);
  if (abs >= 10000) return n.toLocaleString("it-IT", { maximumFractionDigits: 0 });
  if (abs >= 1000) return n.toLocaleString("it-IT", { maximumFractionDigits: 1 });
  return n.toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * @param {{ ax?: typeof DEFAULT_AX }} props
 */
export function AxstudioCreditsIndicator({ ax: axProp }) {
  const ax = axProp || DEFAULT_AX;
  const gradId = useId().replace(/:/g, "");
  const [phase, setPhase] = useState("loading");
  const [balance, setBalance] = useState(null);
  const [currency, setCurrency] = useState(null);

  const load = useCallback(async () => {
    const r = await fetchFalAccountCredits();
    if (r.ok) {
      setBalance(r.balance);
      setCurrency(r.currency);
      setPhase("ready");
    } else if (r.error === "no_key") {
      setBalance(null);
      setCurrency(null);
      setPhase("no_key");
    } else {
      setBalance(null);
      setCurrency(null);
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  const label =
    phase === "ready" && balance != null
      ? `Crediti disponibili (fal.ai): ${formatCreditsDisplay(balance)}${currency ? ` ${currency}` : ""}. Clic per la dashboard.`
      : phase === "no_key"
        ? "Chiave API fal non configurata (REACT_APP_FAL_API_KEY). Imposta il .env per vedere il saldo."
        : phase === "error"
          ? "Saldo crediti non disponibile (rete o API). Riprova più tardi."
          : "Caricamento saldo crediti…";

  const badgeText =
    phase === "loading" ? "…" : phase === "ready" && balance != null ? formatCreditsDisplay(balance) : "–";

  return (
    <a
      href="https://fal.ai/dashboard/billing"
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <span
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 40,
          height: 40,
          borderRadius: 12,
          border: `1px solid ${ax.border}`,
          background: ax.surface,
          boxSizing: "border-box",
        }}
      >
        <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden style={{ display: "block" }}>
          <defs>
            <linearGradient id={`ax-cr-${gradId}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#29b6ff" />
              <stop offset="55%" stopColor="#7b4dff" />
              <stop offset="100%" stopColor="#4fd8ff" />
            </linearGradient>
          </defs>
          <path
            d="M12 2.25L20.25 12 12 21.75 3.75 12 12 2.25z"
            fill={`url(#ax-cr-${gradId})`}
            opacity={0.95}
          />
          <path
            d="M12 2.25L20.25 12 12 21.75 3.75 12 12 2.25z"
            fill="none"
            stroke="rgba(79,216,255,0.4)"
            strokeWidth="0.75"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 44,
          padding: "5px 10px",
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 800,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.02em",
          border: `1px solid rgba(41,182,255,0.38)`,
          background: "linear-gradient(145deg, rgba(123,77,255,0.14), rgba(41,182,255,0.08))",
          color: phase === "ready" ? ax.electric : ax.muted,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
      >
        {badgeText}
      </span>
    </a>
  );
}
