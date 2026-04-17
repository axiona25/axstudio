import React, { useRef, useCallback, useState, useEffect, memo } from "react";

const AX = {
  bg: "#0A0A0F", sidebar: "#11131A", surface: "#1A1F2B", border: "#2A3142",
  hover: "#232A38", text: "#F5F7FF", text2: "#C9D1E3", muted: "#8E97AA",
  blue: "#29B6FF", electric: "#4FD8FF", violet: "#7B4DFF", magenta: "#FF4FA3",
  orange: "#FF8A2A", gold: "#FFB347",
};

const TRACK_COLORS = {
  video: { bg: "rgba(123,77,255,0.18)", border: "rgba(123,77,255,0.45)", clip: "rgba(123,77,255,0.35)", clipBorder: "rgba(123,77,255,0.6)" },
  audio: { bg: "rgba(41,182,255,0.12)", border: "rgba(41,182,255,0.35)", clip: "rgba(41,182,255,0.3)", clipBorder: "rgba(41,182,255,0.55)" },
  text: { bg: "rgba(255,79,163,0.12)", border: "rgba(255,79,163,0.35)", clip: "rgba(255,79,163,0.3)", clipBorder: "rgba(255,79,163,0.55)" },
};

const TRACK_HEIGHT = 56;
const HEADER_WIDTH = 140;
const RULER_HEIGHT = 28;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const BASE_PPS = 100;

function formatTimecode(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 30);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

function RulerBar({ zoom, scrollX, totalDuration, playheadTime, onSeek, pxPerSec }) {
  const canvasRef = useRef(null);
  const isDraggingRef = useRef(false);

  const getTimeFromMouseEvent = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const scaleX = canvas.width / rect.width;
    const canvasX = cssX * scaleX;
    return Math.max(0, (canvasX + scrollX) / pxPerSec);
  }, [scrollX, pxPerSec]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const cssW = Math.round(parent.clientWidth);
    if (canvas.width !== cssW) canvas.width = cssW;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "rgba(17,19,26,0.95)";
    ctx.fillRect(0, 0, w, h);

    let majorStep, minorStep, microStep;
    if (pxPerSec >= 300) {
      majorStep = 1; minorStep = 0.5; microStep = 0.1;
    } else if (pxPerSec >= 120) {
      majorStep = 1; minorStep = 0.5; microStep = 0.1;
    } else if (pxPerSec >= 60) {
      majorStep = 2; minorStep = 1; microStep = 0.2;
    } else if (pxPerSec >= 30) {
      majorStep = 5; minorStep = 1; microStep = 0.5;
    } else {
      majorStep = 10; minorStep = 2; microStep = 1;
    }

    const startSec = Math.floor(scrollX / pxPerSec / majorStep) * majorStep - majorStep;
    const endSec = Math.ceil((scrollX + w) / pxPerSec / majorStep) * majorStep + majorStep;

    ctx.strokeStyle = AX.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();

    const eps = microStep * 0.01;
    for (let t = startSec; t <= endSec; t = Math.round((t + microStep) * 1000) / 1000) {
      const x = t * pxPerSec - scrollX;
      if (x < -10 || x > w + 10) continue;

      const isMajor = Math.abs(t % majorStep) < eps || Math.abs(t % majorStep - majorStep) < eps;
      const isMinor = !isMajor && (Math.abs(t % minorStep) < eps || Math.abs(t % minorStep - minorStep) < eps);

      let tickTop, color;
      if (isMajor) {
        tickTop = 8; color = AX.muted;
      } else if (isMinor) {
        tickTop = 15; color = "rgba(142,151,170,0.4)";
      } else {
        tickTop = 20; color = "rgba(42,49,66,0.7)";
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, tickTop);
      ctx.lineTo(Math.round(x) + 0.5, h);
      ctx.stroke();

      if (isMajor) {
        ctx.fillStyle = AX.muted;
        ctx.font = "10px 'DM Sans', sans-serif";
        ctx.textAlign = "center";
        const label = t >= 60 ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : `${t}s`;
        ctx.fillText(label, x, 7);
      }
    }

    const phX = playheadTime * pxPerSec - scrollX;
    if (phX >= -10 && phX <= w + 10) {
      ctx.fillStyle = AX.magenta;
      ctx.beginPath();
      ctx.moveTo(phX - 6, 0);
      ctx.lineTo(phX + 6, 0);
      ctx.lineTo(phX + 3, 8);
      ctx.lineTo(phX, 12);
      ctx.lineTo(phX - 3, 8);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = AX.magenta;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(phX, 12);
      ctx.lineTo(phX, h);
      ctx.stroke();
    }
  }, [zoom, scrollX, totalDuration, playheadTime, pxPerSec]);

  const handleMouseDown = useCallback((e) => {
    isDraggingRef.current = true;
    onSeek(getTimeFromMouseEvent(e));

    const handleMouseMove = (ev) => {
      if (!isDraggingRef.current) return;
      onSeek(getTimeFromMouseEvent(ev));
    };
    const handleMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [getTimeFromMouseEvent, onSeek]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={RULER_HEIGHT}
      style={{ display: "block", cursor: "pointer", width: "100%", height: RULER_HEIGHT }}
      onMouseDown={handleMouseDown}
    />
  );
}

const ClipBlock = memo(function ClipBlock({ clip, track, pxPerSec, scrollX, selected, onSelect, onDragStart, onResizeStart, onContextMenu }) {
  const colors = TRACK_COLORS[track.type] || TRACK_COLORS.video;
  const left = clip.startTime * pxPerSec - scrollX;
  const width = Math.max(clip.duration * pxPerSec, 4);

  if (left + width < -20 || left > 4000) return null;

  return (
    <div
      style={{
        position: "absolute", left, width, top: 4, bottom: 4,
        background: selected ? colors.clip.replace(/[\d.]+\)$/, "0.55)") : colors.clip,
        border: `1px solid ${selected ? AX.electric : colors.clipBorder}`,
        borderRadius: 6, cursor: "grab", overflow: "hidden",
        display: "flex", alignItems: "center", userSelect: "none",
        boxShadow: selected ? `0 0 12px ${AX.electric}40, inset 0 0 8px rgba(79,216,255,0.1)` : "none",
        transition: "box-shadow 0.15s ease",
      }}
      onClick={(e) => { e.stopPropagation(); onSelect(clip.id, e.metaKey || e.ctrlKey); }}
      onMouseDown={(e) => { if (e.button === 0) onDragStart(e, clip); }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(e, clip); }}
    >
      {clip.thumbnail && track.type === "video" && (
        <div style={{
          width: 44, height: "100%", flexShrink: 0, backgroundImage: `url(${clip.thumbnail})`,
          backgroundSize: "cover", backgroundPosition: "center", opacity: 0.6,
          borderRight: `1px solid ${colors.clipBorder}`,
        }} />
      )}
      <span style={{
        flex: 1, padding: "0 6px", fontSize: 11, fontWeight: 600, color: AX.text,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        textShadow: "0 1px 3px rgba(0,0,0,0.5)",
      }}>
        {clip.name}
      </span>
      <span style={{ fontSize: 9, color: AX.muted, paddingRight: 6, flexShrink: 0 }}>
        {clip.duration.toFixed(1)}s
      </span>

      {/* Left resize handle */}
      <div
        style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, cursor: "col-resize", zIndex: 2 }}
        onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, clip, "left"); }}
      >
        <div style={{ position: "absolute", left: 1, top: "50%", transform: "translateY(-50%)", width: 2, height: 16, borderRadius: 1, background: "rgba(255,255,255,0.3)" }} />
      </div>

      {/* Right resize handle */}
      <div
        style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "col-resize", zIndex: 2 }}
        onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, clip, "right"); }}
      >
        <div style={{ position: "absolute", right: 1, top: "50%", transform: "translateY(-50%)", width: 2, height: 16, borderRadius: 1, background: "rgba(255,255,255,0.3)" }} />
      </div>
    </div>
  );
});

function TrackHeader({ track, onMute, onLock }) {
  const colors = TRACK_COLORS[track.type] || TRACK_COLORS.video;
  return (
    <div style={{
      width: HEADER_WIDTH, height: TRACK_HEIGHT, flexShrink: 0, boxSizing: "border-box",
      display: "flex", alignItems: "center", padding: "0 8px", gap: 6,
      borderBottom: `1px solid ${AX.border}`, borderRight: `1px solid ${AX.border}`,
      background: "rgba(17,19,26,0.7)",
    }}>
      <div style={{
        width: 4, height: 28, borderRadius: 2,
        background: colors.border,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: AX.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.label}</div>
        <div style={{ fontSize: 9, color: AX.muted, textTransform: "uppercase" }}>{track.type}</div>
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        <button type="button" onClick={() => onMute(track.id)} style={{
          width: 20, height: 20, borderRadius: 4, border: "none", cursor: "pointer",
          background: track.muted ? "rgba(255,79,163,0.25)" : "transparent",
          color: track.muted ? AX.magenta : AX.muted, fontSize: 10, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} title={track.muted ? "Unmute" : "Mute"}>M</button>
        <button type="button" onClick={() => onLock(track.id)} style={{
          width: 20, height: 20, borderRadius: 4, border: "none", cursor: "pointer",
          background: track.locked ? "rgba(255,138,42,0.25)" : "transparent",
          color: track.locked ? AX.orange : AX.muted, fontSize: 10, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} title={track.locked ? "Unlock" : "Lock"}>L</button>
      </div>
    </div>
  );
}

function TrackLane({ track, pxPerSec, scrollX, selectedClipIds, onSelectClip, onDragStart, onResizeStart, onDrop, onContextMenu }) {
  const colors = TRACK_COLORS[track.type] || TRACK_COLORS.video;
  const laneRef = useRef(null);
  const [dropPreview, setDropPreview] = useState(null);

  const trackEndTime = track.clips.reduce((m, c) => Math.max(m, c.startTime + c.duration), 0);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    try {
      const types = e.dataTransfer.types || [];
      if (types.includes("application/json")) {
        const left = trackEndTime * pxPerSec - scrollX;
        setDropPreview({ left, width: 5 * pxPerSec });
      }
    } catch {}
  }, [trackEndTime, pxPerSec, scrollX]);

  const handleDragLeave = useCallback(() => { setDropPreview(null); }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDropPreview(null);
    const data = e.dataTransfer.getData("application/json");
    if (data) {
      try { onDrop(JSON.parse(data), track.id); } catch {}
    }
  }, [onDrop, track.id]);

  return (
    <div
      ref={laneRef}
      style={{
        height: TRACK_HEIGHT, position: "relative",
        background: dropPreview ? colors.bg.replace(/[\d.]+\)$/, "0.35)") : colors.bg,
        borderBottom: `1px solid ${dropPreview ? AX.electric : AX.border}`,
        minWidth: 0, transition: "border-color 0.15s, background 0.15s",
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => onSelectClip(null, false)}
    >
      {track.clips.map(clip => (
        <ClipBlock
          key={clip.id}
          clip={clip}
          track={track}
          pxPerSec={pxPerSec}
          scrollX={scrollX}
          selected={(selectedClipIds || []).includes(clip.id)}
          onSelect={onSelectClip}
          onDragStart={onDragStart}
          onResizeStart={onResizeStart}
          onContextMenu={onContextMenu}
        />
      ))}

      {dropPreview && (
        <div style={{
          position: "absolute",
          left: dropPreview.left,
          width: Math.max(dropPreview.width, 20),
          top: 4, bottom: 4,
          background: colors.clip.replace(/[\d.]+\)$/, "0.3)"),
          border: `2px dashed ${AX.electric}`,
          borderRadius: 6,
          pointerEvents: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontSize: 9, color: AX.electric, fontWeight: 700, opacity: 0.8 }}>DROP</span>
        </div>
      )}
    </div>
  );
}

export default function Timeline({
  tracks, playheadTime, isPlaying, zoom, scrollX, selectedClipIds, totalDuration,
  onSeek, onZoomChange, onScrollChange, onToggleSelectClip, onMoveClip, onResizeClip,
  onBeginMultiDrag, onUpdateMultiDrag, onEndMultiDrag,
  onSplitClip, onRemoveClip, onDropMedia, onToggleMute, onToggleLock,
}) {
  const containerRef = useRef(null);
  const tracksAreaRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [dragging, setDragging] = useState(null);
  const [resizing, setResizing] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);

  const pxPerSec = BASE_PPS * zoom;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width - HEADER_WIDTH);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const handleWheel = useCallback((e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      onZoomChange(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor)));
    } else {
      onScrollChange(Math.max(0, scrollX + e.deltaX + e.deltaY));
    }
  }, [zoom, scrollX, onZoomChange, onScrollChange]);

  const handleDragStart = useCallback((e, clip) => {
    const isMulti = (selectedClipIds || []).includes(clip.id) && (selectedClipIds || []).length > 1;
    setDragging({
      clipId: clip.id,
      trackId: clip.trackId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      originalStart: clip.startTime,
      originalTrackId: clip.trackId,
      isMulti,
    });
    if (isMulti) {
      onBeginMultiDrag();
    } else if (!(e.metaKey || e.ctrlKey)) {
      onToggleSelectClip(clip.id, false);
    }
  }, [onToggleSelectClip, onBeginMultiDrag, selectedClipIds]);

  const handleResizeStart = useCallback((e, clip, side) => {
    setResizing({
      clipId: clip.id,
      side,
      startMouseX: e.clientX,
      originalStart: clip.startTime,
      originalDuration: clip.duration,
      clipType: clip.type,
      clipOriginalDuration: clip.originalDuration || clip.duration,
      clipTrimStart: clip.trimStart || 0,
    });
  }, []);

  useEffect(() => {
    if (!dragging && !resizing) return;

    const handleMouseMove = (e) => {
      if (dragging) {
        const dx = e.clientX - dragging.startMouseX;
        const deltaTime = dx / pxPerSec;
        const dy = e.clientY - dragging.startMouseY;
        const trackShift = Math.round(dy / TRACK_HEIGHT);

        if (dragging.isMulti) {
          onUpdateMultiDrag(deltaTime, trackShift);
        } else {
          const newStart = Math.max(0, dragging.originalStart + deltaTime);
          let newTrackId = dragging.originalTrackId;
          if (trackShift !== 0) {
            const currentIdx = tracks.findIndex(t => t.id === dragging.originalTrackId);
            const newIdx = Math.max(0, Math.min(tracks.length - 1, currentIdx + trackShift));
            if (tracks[newIdx].type === tracks[currentIdx].type) {
              newTrackId = tracks[newIdx].id;
            }
          }
          onMoveClip(dragging.clipId, newTrackId, newStart);
        }
      }

      if (resizing) {
        const dx = e.clientX - resizing.startMouseX;
        const deltaSec = dx / pxPerSec;
        const isUnlimited = resizing.clipType === "image" || resizing.clipType === "text";
        const maxDuration = isUnlimited ? Infinity : resizing.clipOriginalDuration;

        if (resizing.side === "right") {
          let newDuration = Math.max(0.2, resizing.originalDuration + deltaSec);
          if (!isUnlimited) {
            const usedByTrim = resizing.clipTrimStart;
            newDuration = Math.min(newDuration, maxDuration - usedByTrim);
          }
          onResizeClip(resizing.clipId, { duration: newDuration });
        } else {
          const shift = Math.min(deltaSec, resizing.originalDuration - 0.2);
          const newStart = resizing.originalStart + shift;
          const newDuration = resizing.originalDuration - shift;
          if (newStart >= 0 && newDuration >= 0.2) {
            if (!isUnlimited && newDuration > maxDuration) return;
            onResizeClip(resizing.clipId, { startTime: newStart, duration: newDuration, trimStart: shift });
          }
        }
      }
    };

    const handleMouseUp = () => {
      if (dragging?.isMulti) onEndMultiDrag();
      setDragging(null);
      setResizing(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, resizing, pxPerSec, tracks, onMoveClip, onUpdateMultiDrag, onEndMultiDrag, onResizeClip]);

  const handleContextMenu = useCallback((e, clip) => {
    setContextMenu({ x: e.clientX, y: e.clientY, clipId: clip.id });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  const playheadX = playheadTime * pxPerSec - scrollX;

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1, display: "flex", flexDirection: "column", minHeight: 0,
        background: AX.bg, borderTop: `1px solid ${AX.border}`,
        userSelect: (dragging || resizing) ? "none" : "auto",
      }}
      onWheel={handleWheel}
    >
      {/* Ruler */}
      <div style={{ display: "flex" }}>
        <div style={{
          width: HEADER_WIDTH, flexShrink: 0, height: RULER_HEIGHT, boxSizing: "border-box",
          background: "rgba(17,19,26,0.95)", borderBottom: `1px solid ${AX.border}`,
          borderRight: `1px solid ${AX.border}`, display: "flex", alignItems: "center",
          justifyContent: "center",
        }}>
          <span style={{ fontSize: 9, color: AX.muted, fontWeight: 600, letterSpacing: "0.05em" }}>
            {formatTimecode(playheadTime)}
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <RulerBar
            zoom={zoom}
            scrollX={scrollX}
            totalDuration={totalDuration}
            playheadTime={playheadTime}
            onSeek={onSeek}
            pxPerSec={pxPerSec}
          />
        </div>
      </div>

      {/* Tracks area */}
      <div ref={tracksAreaRef} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", position: "relative" }}>
        {tracks.map(track => (
          <div key={track.id} style={{ display: "flex" }}>
            <TrackHeader track={track} onMute={onToggleMute} onLock={onToggleLock} />
            <div style={{ flex: 1, minWidth: 0, overflow: "hidden", position: "relative" }}>
              <TrackLane
                track={track}
                pxPerSec={pxPerSec}
                scrollX={scrollX}
                selectedClipIds={selectedClipIds}
                onSelectClip={onToggleSelectClip}
                onDragStart={handleDragStart}
                onResizeStart={handleResizeStart}
                onDrop={onDropMedia}
                onContextMenu={handleContextMenu}
              />
            </div>
          </div>
        ))}

        {/* Playhead line (over tracks) */}
        {playheadX >= 0 && playheadX <= containerWidth && (
          <div style={{
            position: "absolute", left: HEADER_WIDTH + playheadX, top: 0, bottom: 0,
            width: 2, background: AX.magenta, zIndex: 10, pointerEvents: "none",
            boxShadow: `0 0 8px ${AX.magenta}60`,
          }} />
        )}
      </div>

      {/* Zoom controls */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
        borderTop: `1px solid ${AX.border}`, background: "rgba(17,19,26,0.8)",
      }}>
        <button type="button" onClick={() => onZoomChange(Math.max(MIN_ZOOM, zoom * 0.8))}
          style={{ background: "none", border: "none", color: AX.muted, cursor: "pointer", fontSize: 16, fontWeight: 700 }}>−</button>
        <input
          type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={zoom}
          onChange={(e) => onZoomChange(parseFloat(e.target.value))}
          style={{ width: 100 }}
        />
        <button type="button" onClick={() => onZoomChange(Math.min(MAX_ZOOM, zoom * 1.25))}
          style={{ background: "none", border: "none", color: AX.muted, cursor: "pointer", fontSize: 16, fontWeight: 700 }}>+</button>
        <span style={{ fontSize: 10, color: AX.muted, marginLeft: 4 }}>{Math.round(zoom * 100)}%</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: AX.muted }}>
          Durata: {totalDuration.toFixed(1)}s
        </span>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div style={{
          position: "fixed", left: contextMenu.x, top: contextMenu.y, zIndex: 9999,
          background: AX.surface, border: `1px solid ${AX.border}`, borderRadius: 8,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)", backdropFilter: "blur(12px)",
          padding: "4px 0", minWidth: 160,
        }}>
          {[
            { label: "✂ Dividi al playhead", action: () => onSplitClip(contextMenu.clipId, playheadTime) },
            { label: "🗑 Elimina clip", action: () => onRemoveClip(contextMenu.clipId) },
          ].map((item, i) => (
            <button key={i} type="button"
              onClick={() => { item.action(); setContextMenu(null); }}
              style={{
                display: "block", width: "100%", padding: "8px 14px", textAlign: "left",
                background: "none", border: "none", color: AX.text, fontSize: 12,
                cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = AX.hover; }}
              onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
            >{item.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
