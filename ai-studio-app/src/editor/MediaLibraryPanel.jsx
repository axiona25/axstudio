import React, { useRef, useCallback, memo } from "react";
import { HiFilm, HiPhoto, HiMusicalNote, HiFolder, HiDocumentPlus, HiArrowUpTray } from "react-icons/hi2";

const AX = {
  bg: "#0A0A0F", surface: "#1A1F2B", border: "#2A3142",
  hover: "#232A38", text: "#F5F7FF", text2: "#C9D1E3", muted: "#8E97AA",
  electric: "#4FD8FF", violet: "#7B4DFF", magenta: "#FF4FA3", orange: "#FF8A2A",
};

const TYPE_ICONS = {
  video: <HiFilm size={16} />,
  image: <HiPhoto size={16} />,
  audio: <HiMusicalNote size={16} />,
};

const FILTERS = [
  { id: "all", label: "Tutti" },
  { id: "video", label: "Video" },
  { id: "image", label: "Immagini" },
  { id: "audio", label: "Audio" },
];

export default memo(function MediaLibraryPanel({ mediaItems, filter, onFilterChange, onAddMedia, onRemoveMedia }) {
  const fileInputRef = useRef(null);

  const handleFileSelect = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const url = URL.createObjectURL(file);
      onAddMedia({
        name: file.name,
        objectURL: url,
        src: url,
        size: file.size,
      }, {
        duration: 5,
      });
    });
    e.target.value = "";
  }, [onAddMedia]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    files.forEach(file => {
      const url = URL.createObjectURL(file);
      onAddMedia({
        name: file.name,
        objectURL: url,
        src: url,
        size: file.size,
      }, {
        duration: 5,
      });
    });
  }, [onAddMedia]);

  const handleDragStart = useCallback((e, item) => {
    e.dataTransfer.setData("application/json", JSON.stringify(item));
    e.dataTransfer.effectAllowed = "copy";
  }, []);

  const filteredItems = filter === "all" ? mediaItems : mediaItems.filter(m => m.type === filter);

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "rgba(17,19,26,0.6)",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 12px 8px", borderBottom: `1px solid ${AX.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: AX.text, letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 6 }}>
          <HiFolder size={16} style={{ color: AX.electric, opacity: 0.8 }} /> Libreria Media
        </span>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={{
            padding: "4px 10px", borderRadius: 6, border: `1px solid ${AX.border}`,
            background: "transparent", color: AX.electric, fontSize: 11, fontWeight: 600,
            cursor: "pointer",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(79,216,255,0.1)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        >+ Importa</button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*,image/*,audio/*"
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 4, padding: "8px 12px", flexWrap: "wrap" }}>
        {FILTERS.map(f => (
          <button key={f.id} type="button"
            onClick={() => onFilterChange(f.id)}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600,
              border: `1px solid ${filter === f.id ? "rgba(79,216,255,0.4)" : AX.border}`,
              background: filter === f.id ? "rgba(79,216,255,0.1)" : "transparent",
              color: filter === f.id ? AX.electric : AX.muted,
              cursor: "pointer",
            }}
          >{f.label}</button>
        ))}
      </div>

      {/* Drop zone / items */}
      <div
        style={{
          flex: 1, overflow: "auto", padding: "4px 8px",
          display: "flex", flexDirection: "column", gap: 4,
        }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
        onDrop={handleDrop}
      >
        {filteredItems.length === 0 && (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: 8, padding: 20,
            border: `2px dashed ${AX.border}`, borderRadius: 12, margin: "8px 4px",
          }}>
            <HiArrowUpTray size={28} style={{ color: AX.muted, opacity: 0.4 }} />
            <span style={{ fontSize: 11, color: AX.muted, textAlign: "center" }}>
              Trascina file qui o clicca<br />
              <strong style={{ color: AX.text2 }}>+ Importa</strong>
            </span>
            <span style={{ fontSize: 9, color: "rgba(142,151,170,0.5)" }}>
              MP4, MOV, PNG, JPG, MP3, WAV
            </span>
          </div>
        )}

        {filteredItems.map(item => (
          <div
            key={item.id}
            draggable
            onDragStart={(e) => handleDragStart(e, item)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
              borderRadius: 8, border: `1px solid transparent`,
              cursor: "grab", transition: "background 0.15s, border-color 0.15s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = AX.hover;
              e.currentTarget.style.borderColor = AX.border;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderColor = "transparent";
            }}
          >
            {/* Thumbnail */}
            <div style={{
              width: 44, height: 32, borderRadius: 4, flexShrink: 0, overflow: "hidden",
              background: AX.surface, display: "flex", alignItems: "center", justifyContent: "center",
              border: `1px solid ${AX.border}`,
            }}>
              {(item.type === "video" || item.type === "image") && item.thumbnail ? (
                <img
                  src={item.thumbnail}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  onError={(e) => { e.target.style.display = "none"; }}
                />
              ) : (
                <span style={{ color: AX.electric, opacity: 0.7, display: "flex", alignItems: "center", justifyContent: "center" }}>{TYPE_ICONS[item.type] || <HiDocumentPlus size={16} />}</span>
              )}
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 11, fontWeight: 500, color: AX.text,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>{item.name}</div>
              <div style={{ fontSize: 9, color: AX.muted }}>
                {item.type} · {item.duration ? `${item.duration.toFixed(1)}s` : "—"}
              </div>
            </div>

            {/* Remove */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemoveMedia(item.id); }}
              style={{
                width: 18, height: 18, borderRadius: 4, border: "none",
                background: "transparent", color: AX.muted, cursor: "pointer",
                fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center",
                opacity: 0.5,
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = AX.magenta; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = "0.5"; e.currentTarget.style.color = AX.muted; }}
              title="Rimuovi"
            >✕</button>
          </div>
        ))}
      </div>
    </div>
  );
});
