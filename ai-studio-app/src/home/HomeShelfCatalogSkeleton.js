import React from "react";

/** Placeholder neutro Home «Ultimi risultati» finché storage + scan disco non hanno committato il dataset. */
export function HomeShelfCatalogSkeleton({ label = "Caricamento catalogo…" }) {
  return (
    <div
      style={{
        flex: "1 1 0%",
        minHeight: 120,
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: "28px 16px",
        color: "#6b6b80",
        fontSize: 13,
        fontWeight: 600,
      }}
      aria-busy="true"
      aria-live="polite"
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 72px))",
          gap: 10,
          opacity: 0.45,
        }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            style={{
              aspectRatio: "1",
              borderRadius: 10,
              background: "linear-gradient(90deg, rgba(40,44,58,0.5) 0%, rgba(55,60,78,0.85) 50%, rgba(40,44,58,0.5) 100%)",
              backgroundSize: "200% 100%",
              animation: "axstudio-shelf-shimmer 1.1s ease-in-out infinite",
              animationDelay: `${(i % 4) * 0.07}s`,
            }}
          />
        ))}
      </div>
      <span>{label}</span>
      <style>{`
        @keyframes axstudio-shelf-shimmer {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>
    </div>
  );
}
