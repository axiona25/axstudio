import React, { useRef, useEffect, useState, memo } from "react";

const AX = {
  bg: "#0A0A0F", surface: "#1A1F2B", border: "#2A3142",
  text: "#F5F7FF", text2: "#C9D1E3", muted: "#8E97AA",
  blue: "#29B6FF", electric: "#4FD8FF", violet: "#7B4DFF", magenta: "#FF4FA3",
};

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 30);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

const PlayIcon = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>;
const PauseIcon = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>;
const StopIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>;
const ExpandIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>;
const PrevFrameIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z"/></svg>;
const NextFrameIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2V6zM6 18l8.5-6L6 6v12z"/></svg>;
const VolumeIcon = ({ muted }) => muted
  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12A4.5 4.5 0 0014 8.18v2.24l2.45 2.45c.03-.29.05-.58.05-.87zm2.5 0c0 .94-.2 1.84-.54 2.64l1.51 1.51A8.8 8.8 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
  : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.18v7.64c1.48-.73 2.5-2.25 2.5-3.82zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>;

export default memo(function PreviewPlayer({
  playheadTime, totalDuration, isPlaying, playbackSpeed,
  onPlay, onPause, onStop, onSeek, onStepFrame,
  onSpeedChange, tracks, resolution,
}) {
  const canvasRef = useRef(null);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [, setIsFullscreen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    const activeClips = [];
    (tracks || []).forEach(track => {
      if (track.muted) return;
      track.clips.forEach(clip => {
        if (playheadTime >= clip.startTime && playheadTime < clip.startTime + clip.duration) {
          activeClips.push({ ...clip, trackType: track.type, trackId: track.id });
        }
      });
    });

    const videoClips = activeClips.filter(c => c.trackType === "video");
    const textClips = activeClips.filter(c => c.trackType === "text");

    if (videoClips.length > 0) {
      const clip = videoClips[0];
      if (clip.thumbnail) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, w, h);

          const scale = Math.min(w / img.width, h / img.height);
          const dw = img.width * scale;
          const dh = img.height * scale;
          ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);

          drawTextOverlays(ctx, textClips, w, h, playheadTime);
          drawTimecode(ctx, w, h);
        };
        img.src = clip.thumbnail;
      } else {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, "rgba(123,77,255,0.15)");
        grad.addColorStop(1, "rgba(255,79,163,0.1)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = AX.muted;
        ctx.font = "14px 'DM Sans', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(clip.name, w / 2, h / 2);
        drawTextOverlays(ctx, textClips, w, h, playheadTime);
        drawTimecode(ctx, w, h);
      }
    } else {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "rgba(10,10,15,1)");
      grad.addColorStop(0.5, "rgba(26,31,43,0.5)");
      grad.addColorStop(1, "rgba(10,10,15,1)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(42,49,66,0.3)";
      ctx.lineWidth = 1;
      for (let i = 0; i < w; i += 40) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
      }
      for (let i = 0; i < h; i += 40) {
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
      }

      ctx.fillStyle = AX.muted;
      ctx.font = "13px 'DM Sans', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Trascina un clip sulla timeline per iniziare", w / 2, h / 2 - 10);
      ctx.font = "11px 'DM Sans', sans-serif";
      ctx.fillStyle = "rgba(142,151,170,0.5)";
      ctx.fillText(`${resolution?.width || 1920}×${resolution?.height || 1080}`, w / 2, h / 2 + 14);

      drawTimecode(ctx, w, h);
    }

    function drawTimecode(c, cw, ch) {
      c.fillStyle = "rgba(0,0,0,0.6)";
      c.fillRect(cw - 120, ch - 26, 115, 22);
      c.fillStyle = AX.electric;
      c.font = "bold 11px 'DM Sans', monospace";
      c.textAlign = "right";
      c.fillText(formatTime(playheadTime), cw - 10, ch - 10);
    }

    function drawTextOverlays(c, clips, cw, ch) {
      clips.forEach(tc => {
        c.fillStyle = "rgba(255,255,255,0.95)";
        c.font = "bold 24px 'DM Sans', sans-serif";
        c.textAlign = "center";
        c.fillText(tc.name || "Testo", cw / 2, ch / 2 + 60);
      });
    }
  }, [playheadTime, tracks, resolution]);

  const handleSeekBar = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(pct * (totalDuration || 1));
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
      setIsFullscreen(false);
    } else {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    }
  };

  const progress = totalDuration > 0 ? (playheadTime / totalDuration) * 100 : 0;

  return (
    <div ref={containerRef} style={{
      display: "flex", flexDirection: "column",
      background: "#000", borderRadius: 12, overflow: "hidden",
      border: `1px solid ${AX.border}`,
    }}>
      {/* Canvas preview */}
      <div style={{ position: "relative", aspectRatio: "16/9", background: "#000" }}>
        <canvas
          ref={canvasRef}
          width={resolution?.width || 1920}
          height={resolution?.height || 1080}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      </div>

      {/* Seek bar */}
      <div
        style={{
          height: 4, background: "rgba(42,49,66,0.6)", cursor: "pointer",
          position: "relative",
        }}
        onClick={handleSeekBar}
      >
        <div style={{
          height: "100%", background: `linear-gradient(90deg, ${AX.violet}, ${AX.magenta})`,
          width: `${progress}%`, transition: isPlaying ? "none" : "width 0.1s ease",
        }} />
      </div>

      {/* Controls */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4, padding: "6px 10px",
        background: "rgba(10,10,15,0.9)",
      }}>
        <CtrlBtn onClick={isPlaying ? onPause : onPlay} title={isPlaying ? "Pausa" : "Play"}>
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </CtrlBtn>
        <CtrlBtn onClick={onStop} title="Stop"><StopIcon /></CtrlBtn>

        <div style={{ width: 1, height: 20, background: AX.border, margin: "0 4px" }} />

        <CtrlBtn onClick={() => onStepFrame(-1)} title="Frame precedente"><PrevFrameIcon /></CtrlBtn>
        <CtrlBtn onClick={() => onStepFrame(1)} title="Frame successivo"><NextFrameIcon /></CtrlBtn>

        <div style={{ width: 1, height: 20, background: AX.border, margin: "0 4px" }} />

        <span style={{ fontSize: 11, color: AX.text2, fontFamily: "monospace", minWidth: 90, textAlign: "center" }}>
          {formatTime(playheadTime)}
        </span>
        <span style={{ fontSize: 10, color: AX.muted }}>/ {formatTime(totalDuration)}</span>

        <div style={{ flex: 1 }} />

        {/* Speed control */}
        <select
          value={playbackSpeed}
          onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
          style={{
            background: AX.surface, color: AX.text2, border: `1px solid ${AX.border}`,
            borderRadius: 6, padding: "3px 6px", fontSize: 10, cursor: "pointer",
            outline: "none", fontFamily: "'DM Sans', sans-serif",
          }}
        >
          <option value={0.25}>0.25x</option>
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2x</option>
        </select>

        <div style={{ width: 1, height: 20, background: AX.border, margin: "0 4px" }} />

        {/* Volume */}
        <CtrlBtn onClick={() => setIsMuted(!isMuted)} title={isMuted ? "Unmute" : "Mute"}>
          <VolumeIcon muted={isMuted} />
        </CtrlBtn>
        <input
          type="range" min={0} max={1} step={0.01} value={isMuted ? 0 : volume}
          onChange={(e) => { setVolume(parseFloat(e.target.value)); setIsMuted(false); }}
          style={{ width: 60 }}
        />

        <CtrlBtn onClick={toggleFullscreen} title="Fullscreen"><ExpandIcon /></CtrlBtn>
      </div>
    </div>
  );
});

function CtrlBtn({ children, onClick, title }) {
  return (
    <button
      type="button" onClick={onClick} title={title}
      style={{
        width: 32, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
        background: "none", border: "none", borderRadius: 6, color: AX.text2,
        cursor: "pointer", transition: "background 0.15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "rgba(123,77,255,0.15)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
    >{children}</button>
  );
}
