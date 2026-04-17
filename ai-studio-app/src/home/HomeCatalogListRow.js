import React, { useState, useEffect, useCallback, useRef } from "react";
import { HiFilm, HiPhoto } from "react-icons/hi2";

/** Coerente con App.js (sidebar / tile). */
const THUMB_COVER_POSITION = "50% 22%";

function guessImageMime(fileName) {
  const n = (fileName || "").toLowerCase();
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function mediaFileUrl(filePath, isElectron) {
  if (!filePath || typeof filePath !== "string" || !isElectron) return null;
  return `axstudio-local://asset?p=${encodeURIComponent(filePath)}`;
}

const THUMB_W = 120;
const THUMB_H = 68;

/**
 * Riga elenco catalogo Home (immagini / video liberi).
 * @param {{ entry: object, onOpenPreview: (e: object) => void, ax: { border: string, surface: string, text: string, text2: string, muted: string, electric: string, violet: string, bg: string } }} props
 */
export const HomeCatalogListRow = React.memo(function HomeCatalogListRow({ entry, onOpenPreview, ax }) {
  const isVideo = entry.type === "video";
  const isElectron = typeof window !== "undefined" && !!(window.electronAPI);
  const fileUrl = entry.filePath ? mediaFileUrl(entry.filePath, isElectron) : null;
  const [displaySrc, setDisplaySrc] = useState(fileUrl);
  const [mediaErr, setMediaErr] = useState(false);
  const fallbackTried = useRef(false);

  useEffect(() => {
    setDisplaySrc(fileUrl);
    fallbackTried.current = false;
    setMediaErr(false);
  }, [entry.filePath, fileUrl]);

  const onImageError = useCallback(async () => {
    if (isVideo || !isElectron || !entry.filePath || fallbackTried.current) {
      setMediaErr(true);
      return;
    }
    fallbackTried.current = true;
    try {
      const r = await window.electronAPI.loadFile(entry.filePath);
      if (r?.success && r.data) {
        setDisplaySrc(`data:${guessImageMime(entry.fileName)};base64,${r.data}`);
      } else {
        setMediaErr(true);
      }
    } catch {
      setMediaErr(true);
    }
  }, [isVideo, entry.filePath, entry.fileName, isElectron]);

  const title =
    (entry.params?.promptIT || entry.params?.userIdea || entry.prompt || "").trim() ||
    entry.fileName ||
    (isVideo ? "Video" : "Immagine");
  const sub =
    entry.createdAt != null
      ? `${isVideo ? "Video" : "Immagine"} · ${new Date(entry.createdAt).toLocaleString("it-IT", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : isVideo
        ? "Video"
        : "Immagine";

  const onRowClick = () => {
    if (!entry.filePath) return;
    if (typeof onOpenPreview === "function") onOpenPreview(entry);
  };

  const src = displaySrc;
  const canOpen = Boolean(entry.filePath);
  const rowShadowRest = "0 2px 10px rgba(0,0,0,0.18)";
  const rowShadowHoverOpen =
    "0 18px 44px rgba(0,0,0,0.38), 0 0 0 1px rgba(41,182,255,0.5), 0 0 32px rgba(41,182,255,0.24)";

  return (
    <button
      type="button"
      onClick={onRowClick}
      disabled={!canOpen}
      title={title}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        width: "100%",
        minWidth: 0,
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${canOpen ? ax.border : "rgba(251,191,36,0.35)"}`,
        background: "rgba(16,18,26,0.75)",
        cursor: canOpen ? "pointer" : "default",
        textAlign: "left",
        boxSizing: "border-box",
        boxShadow: rowShadowRest,
        transition: "border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease",
      }}
      onMouseEnter={(e) => {
        if (!canOpen) return;
        const t = e.currentTarget;
        t.style.borderColor = ax.electric;
        t.style.background = "rgba(41,182,255,0.07)";
        t.style.boxShadow = rowShadowHoverOpen;
      }}
      onMouseLeave={(e) => {
        const t = e.currentTarget;
        t.style.borderColor = canOpen ? ax.border : "rgba(251,191,36,0.35)";
        t.style.background = "rgba(16,18,26,0.75)";
        t.style.boxShadow = rowShadowRest;
      }}
    >
      <div
        style={{
          width: THUMB_W,
          height: THUMB_H,
          flexShrink: 0,
          borderRadius: 8,
          overflow: "hidden",
          background: ax.bg,
          border: `1px solid ${ax.border}`,
          boxSizing: "border-box",
        }}
      >
        {src && !mediaErr && !isVideo && (
          <img
            alt=""
            src={src}
            loading="lazy"
            decoding="async"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: THUMB_COVER_POSITION,
              display: "block",
            }}
            onError={onImageError}
          />
        )}
        {src && !mediaErr && isVideo && (
          <video
            src={src}
            muted
            playsInline
            preload="metadata"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: THUMB_COVER_POSITION,
              pointerEvents: "none",
              display: "block",
            }}
            onError={() => setMediaErr(true)}
            onLoadedData={(e) => {
              try {
                const v = e.currentTarget;
                if (v.duration && !Number.isNaN(v.duration)) v.currentTime = Math.min(0.05, v.duration * 0.01);
              } catch {
                /* noop */
              }
            }}
          />
        )}
        {(!src || mediaErr) && (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: isVideo
                ? "linear-gradient(145deg, rgba(123,77,255,0.25), rgba(41,182,255,0.12))"
                : "linear-gradient(145deg, rgba(41,182,255,0.25), rgba(255,138,42,0.1))",
              color: ax.text2,
            }}
          >
            {isVideo ? <HiFilm size={22} /> : <HiPhoto size={22} />}
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: ax.text,
            lineHeight: 1.3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 12,
            color: ax.muted,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sub}
        </div>
      </div>
      <span
        style={{
          flexShrink: 0,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.04em",
          padding: "4px 8px",
          borderRadius: 6,
          background: isVideo ? "rgba(123,77,255,0.85)" : "rgba(41,182,255,0.85)",
          color: ax.bg,
        }}
      >
        {isVideo ? "VIDEO" : "IMG"}
      </span>
    </button>
  );
});
