import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  HiFilm, HiPhoto, HiMusicalNote, HiFolder, HiFolderOpen,
  HiArrowUpTray, HiChevronDown, HiChevronRight, HiQueueList,
  HiPlayCircle, HiClock, HiDocumentPlus, HiSquares2X2, HiSquaresPlus,
} from "react-icons/hi2";

const AX = {
  bg: "#0A0A0F", surface: "#1A1F2B", border: "#2A3142",
  hover: "#232A38", text: "#F5F7FF", text2: "#C9D1E3", muted: "#8E97AA",
  electric: "#4FD8FF", violet: "#7B4DFF", magenta: "#FF4FA3", orange: "#FF8A2A",
};

const TABS = [
  { id: "video",        label: "Video",          icon: HiFilm },
  { id: "image",        label: "Immagini",       icon: HiPhoto },
  { id: "screenplay",   label: "Sceneggiature",  icon: HiFolder },
  { id: "audio",        label: "Audio",          icon: HiMusicalNote },
];


function formatDuration(sec) {
  if (!sec || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function detectAspectRatio(w, h) {
  if (!w || !h) return { label: "", ratio: 16 / 9 };
  const r = w / h;
  if (Math.abs(r - 16 / 9) < 0.15) return { label: "16:9", ratio: 16 / 9 };
  if (Math.abs(r - 9 / 16) < 0.1) return { label: "9:16", ratio: 9 / 16 };
  if (Math.abs(r - 4 / 3) < 0.1) return { label: "4:3", ratio: 4 / 3 };
  if (Math.abs(r - 3 / 4) < 0.1) return { label: "3:4", ratio: 3 / 4 };
  if (Math.abs(r - 1) < 0.1) return { label: "1:1", ratio: 1 };
  if (Math.abs(r - 21 / 9) < 0.2) return { label: "21:9", ratio: 21 / 9 };
  return { label: `${w}×${h}`, ratio: r };
}

function VideoThumbnail({ src, onAspect }) {
  const canvasRef = useRef(null);
  const [captured, setCaptured] = useState(false);

  useEffect(() => {
    if (!src || captured) return;
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "metadata";

    video.onloadeddata = () => { video.currentTime = 0.5; };
    video.onseeked = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const vw = video.videoWidth || 80;
      const vh = video.videoHeight || 45;
      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, vw, vh);
      setCaptured(true);
      if (onAspect) onAspect(detectAspectRatio(vw, vh));
      video.src = "";
    };
    video.onerror = () => { setCaptured(false); };
    video.src = src;
    return () => { video.src = ""; };
  }, [src, captured, onAspect]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 4, display: "block" }} />;
}

function ImageThumbnail({ src, onAspect }) {
  const handleLoad = useCallback((e) => {
    const img = e.target;
    if (onAspect && img.naturalWidth && img.naturalHeight) {
      onAspect(detectAspectRatio(img.naturalWidth, img.naturalHeight));
    }
  }, [onAspect]);

  return (
    <img src={src} alt="" onLoad={handleLoad}
      style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 4 }}
      onError={e => { e.target.style.display = "none"; }}
    />
  );
}

export default function MediaLibraryPanel({ history, mediaFileUrl, timeline }) {
  const [tab, setTab] = useState("video");
  const [gridCols, setGridCols] = useState(3);
  const [expandedSp, setExpandedSp] = useState({});
  const audioInputRef = useRef(null);
  const [audioFiles, setAudioFiles] = useState([]);

  const allImages = useMemo(() =>
    (history || [])
      .filter(h => h.type === "image" && h.filePath)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),
    [history]
  );

  const singleVideos = useMemo(() =>
    (history || [])
      .filter(h => h.type === "video" && h.filePath && !h.params?.screenplayId)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),
    [history]
  );

  const screenplayGroups = useMemo(() => {
    const byId = {};
    (history || [])
      .filter(h => h.type === "video" && h.filePath && h.params?.screenplayId)
      .forEach(h => {
        const spId = h.params.screenplayId;
        if (!byId[spId]) {
          byId[spId] = {
            id: spId,
            name: h.params.screenplayName || "Sceneggiatura",
            summary: h.params.screenplaySummary || "",
            clips: [],
            lastUpdated: h.createdAt,
          };
        }
        byId[spId].clips.push(h);
        const t = new Date(h.createdAt || 0).getTime();
        if (t > new Date(byId[spId].lastUpdated || 0).getTime()) byId[spId].lastUpdated = h.createdAt;
      });
    Object.values(byId).forEach(g => {
      g.clips.sort((a, b) => (a.params?.clipIndex ?? 999) - (b.params?.clipIndex ?? 999));
    });
    return Object.values(byId).sort((a, b) => new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0));
  }, [history]);

  const makeDragData = useCallback((item, type) => {
    const dur = parseFloat(item.params?.duration) || (type === "image" ? 5 : 5);
    return JSON.stringify({
      type,
      filePath: item.filePath,
      fileName: item.fileName,
      name: item.fileName || item.prompt || type,
      duration: dur,
      src: mediaFileUrl ? mediaFileUrl(item.filePath) : "",
      thumbnail: mediaFileUrl ? mediaFileUrl(item.filePath) : "",
    });
  }, [mediaFileUrl]);

  const handleDragStart = useCallback((e, item, type) => {
    e.dataTransfer.setData("application/json", makeDragData(item, type));
    e.dataTransfer.effectAllowed = "copy";
  }, [makeDragData]);

  const addAllToTimeline = useCallback((group) => {
    if (!timeline) return;
    const tracks = timeline.tracks || [];
    const v1 = tracks.find(t => t.id === "V1") || tracks.find(t => t.type === "video");
    if (!v1) return;

    group.clips.forEach(clip => {
      const dur = parseFloat(clip.params?.duration) || 5;
      const mediaData = {
        type: "video",
        filePath: clip.filePath,
        fileName: clip.fileName,
        name: clip.fileName || clip.prompt || "Clip",
        duration: dur,
        src: mediaFileUrl ? mediaFileUrl(clip.filePath) : "",
        thumbnail: mediaFileUrl ? mediaFileUrl(clip.filePath) : "",
      };
      timeline.addClip(mediaData, v1.id);
    });
  }, [timeline, mediaFileUrl]);

  const toggleSp = useCallback((id) => {
    setExpandedSp(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleAudioImport = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    files.forEach(f => {
      setAudioFiles(prev => [...prev, {
        id: `audio-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: f.name,
        src: URL.createObjectURL(f),
        size: f.size,
        duration: 0,
      }]);
    });
    e.target.value = "";
  }, []);

  const renderThumbnail = useCallback((item, type) => {
    const url = mediaFileUrl ? mediaFileUrl(item.filePath) : null;
    if (type === "video" && url) return <VideoThumbnail src={url} />;
    if (type === "image" && url) return <ImageThumbnail src={url} />;
    return <HiDocumentPlus size={16} style={{ color: AX.muted, opacity: 0.5 }} />;
  }, [mediaFileUrl]);

  const gap = 6;
  const GRID_TILE_W = `calc(${100 / gridCols}% - ${gap * (gridCols - 1) / gridCols}px)`;

  const MediaCard = ({ item, type }) => {
    const dur = parseFloat(item.params?.duration) || 0;
    const [aspect, setAspect] = useState(null);
    const url = mediaFileUrl ? mediaFileUrl(item.filePath) : null;

    const thumbRatio = aspect ? aspect.ratio : 16 / 9;
    const isPortrait = thumbRatio < 1;
    const innerWidthPct = isPortrait ? `${(thumbRatio / (16 / 9)) * 100}%` : "100%";

    return (
      <div
        draggable
        onDragStart={(e) => handleDragStart(e, item, type)}
        style={{
          width: GRID_TILE_W, borderRadius: 8, border: "1px solid transparent",
          cursor: "grab", transition: "background 0.15s, border-color 0.15s",
          overflow: "hidden", flexShrink: 0, boxSizing: "border-box",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = AX.hover; e.currentTarget.style.borderColor = AX.border; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}
      >
        <div style={{
          width: "100%", aspectRatio: "16/9",
          borderRadius: "7px 7px 0 0", overflow: "hidden",
          background: AX.surface, display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative",
        }}>
          <div style={{ width: innerWidthPct, height: "100%", overflow: "hidden", borderRadius: isPortrait ? 4 : 0 }}>
            {url ? (type === "video" ? <VideoThumbnail src={url} onAspect={setAspect} /> : <ImageThumbnail src={url} onAspect={setAspect} />) : <HiDocumentPlus size={16} style={{ color: AX.muted, opacity: 0.5 }} />}
          </div>
          {type === "video" && dur > 0 && (
            <span style={{
              position: "absolute", bottom: 4, right: 4, fontSize: 9, fontWeight: 700,
              background: "rgba(0,0,0,0.75)", color: "#fff", padding: "2px 5px", borderRadius: 4,
            }}>{formatDuration(dur)}</span>
          )}
        </div>
        <div style={{ padding: "5px 6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{
              flex: 1, minWidth: 0, fontSize: 10, fontWeight: 500, color: AX.text,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{item.fileName || item.prompt || type}</div>
            {aspect?.label && (
              <span style={{
                fontSize: 7, fontWeight: 700, color: AX.violet, flexShrink: 0,
                background: "rgba(123,77,255,0.15)", padding: "1px 4px", borderRadius: 3,
              }}>{aspect.label}</span>
            )}
          </div>
          <div style={{ fontSize: 8, color: AX.muted, marginTop: 1 }}>
            {formatDate(item.createdAt)}
            {item.projectId ? " · Progetto" : " · Libero"}
          </div>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    switch (tab) {
      case "video":
        if (singleVideos.length === 0) return <EmptyState text="Nessun video" desc='Genera video in "Video libero" o nei progetti' />;
        return <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{singleVideos.map(item => <MediaCard key={item.id} item={item} type="video" />)}</div>;

      case "image":
        if (allImages.length === 0) return <EmptyState text="Nessuna immagine" desc='Genera immagini in "Immagine libera" o nei progetti' />;
        return <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{allImages.map(item => <MediaCard key={item.id} item={item} type="image" />)}</div>;

      case "screenplay":
        if (screenplayGroups.length === 0) return <EmptyState text="Nessuna sceneggiatura" desc="Genera sceneggiature multi-clip per vederle qui" />;
        return screenplayGroups.map(group => (
          <ScreenplayFolder
            key={group.id}
            group={group}
            expanded={!!expandedSp[group.id]}
            onToggle={() => toggleSp(group.id)}
            onDragStart={handleDragStart}
            onAddAll={() => addAllToTimeline(group)}
            mediaFileUrl={mediaFileUrl}
            renderThumbnail={renderThumbnail}
          />
        ));

      case "audio":
        return (
          <>
            {audioFiles.length === 0 ? (
              <div style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", gap: 8, padding: 20,
                border: `2px dashed ${AX.border}`, borderRadius: 12, margin: "8px 4px",
              }}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
                onDrop={e => {
                  e.preventDefault();
                  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("audio/"));
                  files.forEach(f => {
                    setAudioFiles(prev => [...prev, {
                      id: `audio-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                      name: f.name, src: URL.createObjectURL(f), size: f.size, duration: 0,
                    }]);
                  });
                }}
              >
                <HiArrowUpTray size={28} style={{ color: AX.muted, opacity: 0.4 }} />
                <span style={{ fontSize: 11, color: AX.muted, textAlign: "center" }}>
                  Trascina file audio qui o clicca<br />
                  <strong style={{ color: AX.text2 }}>+ Importa audio</strong>
                </span>
                <span style={{ fontSize: 9, color: "rgba(142,151,170,0.5)" }}>MP3, WAV, M4A, OGG</span>
              </div>
            ) : (
              audioFiles.map(af => (
                <div key={af.id} draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/json", JSON.stringify({
                      type: "audio", name: af.name, src: af.src, duration: af.duration || 10,
                    }));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
                    borderRadius: 8, border: "1px solid transparent", cursor: "grab",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = AX.hover; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 6, flexShrink: 0,
                    background: "rgba(41,182,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <HiMusicalNote size={16} style={{ color: AX.electric }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: AX.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{af.name}</div>
                  </div>
                </div>
              ))
            )}
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "rgba(17,19,26,0.6)" }}>
      {/* Header */}
      <div style={{
        padding: "12px 12px 8px", borderBottom: `1px solid ${AX.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: AX.text, letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 6 }}>
          <HiFolder size={16} style={{ color: AX.electric, opacity: 0.8 }} /> Libreria Media
        </span>
        {tab === "audio" && (
          <>
            <button type="button" onClick={() => audioInputRef.current?.click()} style={{
              padding: "4px 10px", borderRadius: 6, border: `1px solid ${AX.border}`,
              background: "transparent", color: AX.electric, fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}>+ Importa</button>
            <input ref={audioInputRef} type="file" multiple accept="audio/*" style={{ display: "none" }} onChange={handleAudioImport} />
          </>
        )}
      </div>

      {/* Tabs + grid size toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "8px 10px" }}>
        {TABS.map(t => {
          const active = tab === t.id;
          const Icon = t.icon;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} style={{
              padding: "4px 9px", borderRadius: 6, fontSize: 10, fontWeight: 600,
              border: `1px solid ${active ? "rgba(79,216,255,0.4)" : AX.border}`,
              background: active ? "rgba(79,216,255,0.1)" : "transparent",
              color: active ? AX.electric : AX.muted,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
            }}>
              <Icon size={12} /> {t.label}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        {(tab === "video" || tab === "image") && (
          <div style={{ display: "flex", gap: 2, background: AX.surface, borderRadius: 6, padding: 2, border: `1px solid ${AX.border}` }}>
            {[3, 2].map(n => (
              <button key={n} type="button" onClick={() => setGridCols(n)} style={{
                width: 24, height: 22, borderRadius: 4, border: "none",
                background: gridCols === n ? "rgba(79,216,255,0.15)" : "transparent",
                color: gridCols === n ? AX.electric : AX.muted,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s",
              }}>
                {n === 3 ? <HiSquaresPlus size={14} /> : <HiSquares2X2 size={14} />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "4px 8px" }}>
        {renderContent()}
      </div>
    </div>
  );
}

function ScreenplayFolder({ group, expanded, onToggle, onDragStart, onAddAll, mediaFileUrl, renderThumbnail }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <button type="button" onClick={onToggle} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px",
        borderRadius: 8, border: `1px solid ${expanded ? AX.border : "transparent"}`,
        background: expanded ? AX.hover : "transparent",
        cursor: "pointer", textAlign: "left", transition: "all 0.15s",
        fontFamily: "'DM Sans', sans-serif",
      }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = AX.hover; }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = "transparent"; }}
      >
        {expanded ? <HiFolderOpen size={16} style={{ color: AX.electric, flexShrink: 0 }} /> : <HiFolder size={16} style={{ color: AX.muted, flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: AX.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {group.name}
          </div>
          <div style={{ fontSize: 9, color: AX.muted }}>
            {group.clips.length} clip · {formatDate(group.lastUpdated)}
            {group.summary ? ` — "${group.summary.slice(0, 40)}${group.summary.length > 40 ? "…" : ""}"` : ""}
          </div>
        </div>
        {expanded ? <HiChevronDown size={14} style={{ color: AX.muted }} /> : <HiChevronRight size={14} style={{ color: AX.muted }} />}
      </button>

      {expanded && (
        <div style={{ paddingLeft: 20, paddingTop: 4 }}>
          {group.clips.map((clip, i) => {
            const dur = parseFloat(clip.params?.duration) || 0;
            return (
              <div key={clip.id || i}
                draggable
                onDragStart={(e) => onDragStart(e, clip, "video")}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "4px 8px",
                  borderRadius: 6, cursor: "grab", transition: "background 0.15s",
                  border: "1px solid transparent",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = AX.hover; e.currentTarget.style.borderColor = AX.border; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}
              >
                <div style={{
                  width: 44, height: 30, borderRadius: 4, flexShrink: 0, overflow: "hidden",
                  background: AX.surface, display: "flex", alignItems: "center", justifyContent: "center",
                  border: `1px solid ${AX.border}`, position: "relative",
                }}>
                  {renderThumbnail(clip, "video")}
                  {dur > 0 && (
                    <span style={{
                      position: "absolute", bottom: 1, right: 2, fontSize: 7, fontWeight: 700,
                      background: "rgba(0,0,0,0.7)", color: "#fff", padding: "1px 3px", borderRadius: 2,
                    }}>{formatDuration(dur)}</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 500, color: AX.text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    Clip {(clip.params?.clipIndex ?? i) + 1}
                  </div>
                  {dur > 0 && <div style={{ fontSize: 8, color: AX.muted }}><HiClock size={8} style={{ verticalAlign: "middle" }} /> {dur.toFixed(1)}s</div>}
                </div>
                <HiPlayCircle size={16} style={{ color: AX.muted, opacity: 0.4, flexShrink: 0 }} />
              </div>
            );
          })}

          <button type="button" onClick={onAddAll} style={{
            display: "flex", alignItems: "center", gap: 6, width: "100%",
            padding: "6px 8px", marginTop: 4, borderRadius: 6,
            border: `1px solid rgba(123,77,255,0.3)`,
            background: "rgba(123,77,255,0.08)", color: AX.violet,
            cursor: "pointer", fontSize: 10, fontWeight: 600,
            fontFamily: "'DM Sans', sans-serif",
            transition: "all 0.15s",
          }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(123,77,255,0.18)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(123,77,255,0.08)"; }}
          >
            <HiQueueList size={14} /> Aggiungi tutti alla timeline
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyState({ text, desc }) {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: 8, padding: 24,
    }}>
      <HiArrowUpTray size={28} style={{ color: AX.muted, opacity: 0.3 }} />
      <span style={{ fontSize: 13, fontWeight: 600, color: AX.text2 }}>{text}</span>
      <span style={{ fontSize: 11, color: AX.muted, textAlign: "center", lineHeight: 1.5 }}>{desc}</span>
    </div>
  );
}
