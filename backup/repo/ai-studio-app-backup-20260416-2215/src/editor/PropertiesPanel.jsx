import React, { memo } from "react";

const AX = {
  bg: "#0A0A0F", surface: "#1A1F2B", border: "#2A3142",
  hover: "#232A38", text: "#F5F7FF", text2: "#C9D1E3", muted: "#8E97AA",
  electric: "#4FD8FF", violet: "#7B4DFF", magenta: "#FF4FA3", orange: "#FF8A2A",
};

function PropRow({ label, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 11, color: AX.muted, fontWeight: 500, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>{children}</div>
    </div>
  );
}

function SliderProp({ label, value, min, max, step, onChange, unit }) {
  return (
    <PropRow label={label}>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: 80 }}
      />
      <span style={{ fontSize: 10, color: AX.text2, minWidth: 36, textAlign: "right", fontFamily: "monospace" }}>
        {typeof value === "number" ? value.toFixed(step < 1 ? 2 : 0) : value}{unit || ""}
      </span>
    </PropRow>
  );
}

function InputProp({ label, value, onChange, type = "text" }) {
  return (
    <PropRow label={label}>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(type === "number" ? parseFloat(e.target.value) || 0 : e.target.value)}
        style={{
          width: 100, padding: "4px 8px", borderRadius: 6,
          background: AX.bg, border: `1px solid ${AX.border}`,
          color: AX.text, fontSize: 11, outline: "none",
          fontFamily: "'DM Sans', sans-serif",
        }}
      />
    </PropRow>
  );
}

function SectionHeader({ title }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: AX.muted, letterSpacing: "0.1em",
      textTransform: "uppercase", marginBottom: 10, marginTop: 6, paddingBottom: 6,
      borderBottom: `1px solid ${AX.border}`,
    }}>{title}</div>
  );
}

export default memo(function PropertiesPanel({ selectedClip, onUpdateClip, projectFps, projectResolution, onResolutionChange, onFpsChange }) {
  if (!selectedClip) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", height: "100%",
      }}>
        <div style={{ padding: 16 }}>
          <SectionHeader title="Progetto" />
          <PropRow label="Risoluzione">
            <select
              value={`${projectResolution?.width}x${projectResolution?.height}`}
              onChange={(e) => {
                const [w, h] = e.target.value.split("x").map(Number);
                onResolutionChange?.({ width: w, height: h });
              }}
              style={{
                background: AX.bg, color: AX.text2, border: `1px solid ${AX.border}`,
                borderRadius: 6, padding: "3px 6px", fontSize: 10, cursor: "pointer",
                outline: "none", fontFamily: "'DM Sans', sans-serif",
              }}
            >
              <option value="1280x720">720p</option>
              <option value="1920x1080">1080p</option>
              <option value="2560x1440">2K</option>
              <option value="3840x2160">4K</option>
              <option value="1080x1920">9:16</option>
              <option value="1080x1080">1:1</option>
            </select>
          </PropRow>
          <PropRow label="FPS">
            <select
              value={projectFps}
              onChange={(e) => onFpsChange?.(parseInt(e.target.value))}
              style={{
                background: AX.bg, color: AX.text2, border: `1px solid ${AX.border}`,
                borderRadius: 6, padding: "3px 6px", fontSize: 10, cursor: "pointer",
                outline: "none", fontFamily: "'DM Sans', sans-serif",
              }}
            >
              <option value={24}>24 fps</option>
              <option value={25}>25 fps</option>
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </PropRow>
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <span style={{ fontSize: 11, color: AX.muted, textAlign: "center", lineHeight: 1.6 }}>
            Seleziona un clip nella timeline<br />per modificarne le proprietà
          </span>
        </div>
      </div>
    );
  }

  const update = (key, val) => onUpdateClip(selectedClip.id, { [key]: val });

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
    }}>
      <div style={{
        padding: "10px 16px 6px", display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{
          fontSize: 9, padding: "2px 6px", borderRadius: 4,
          background: "rgba(123,77,255,0.15)", color: AX.violet, fontWeight: 600,
          textTransform: "uppercase",
        }}>{selectedClip.type}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: AX.text }}>{selectedClip.name}</span>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "6px 16px 16px" }}>
        <SectionHeader title="Generale" />
        <InputProp label="Nome" value={selectedClip.name} onChange={(v) => update("name", v)} />
        <InputProp label="Inizio (s)" value={selectedClip.startTime.toFixed(2)} onChange={(v) => update("startTime", parseFloat(v) || 0)} type="number" />
        <InputProp label="Durata (s)" value={selectedClip.duration.toFixed(2)} onChange={(v) => update("duration", Math.max(0.1, parseFloat(v) || 0.1))} type="number" />

        {selectedClip.type === "video" && (
          <>
            <SectionHeader title="Video" />
            <SliderProp label="Opacità" value={selectedClip.opacity ?? 1} min={0} max={1} step={0.01} onChange={(v) => update("opacity", v)} unit="" />
            <SliderProp label="Volume" value={selectedClip.volume ?? 1} min={0} max={2} step={0.01} onChange={(v) => update("volume", v)} unit="" />
          </>
        )}

        {selectedClip.type === "audio" && (
          <>
            <SectionHeader title="Audio" />
            <SliderProp label="Volume" value={selectedClip.volume ?? 1} min={0} max={2} step={0.01} onChange={(v) => update("volume", v)} unit="" />
          </>
        )}

        {selectedClip.type === "text" && (
          <>
            <SectionHeader title="Testo" />
            <InputProp label="Contenuto" value={selectedClip.name} onChange={(v) => update("name", v)} />
          </>
        )}

        <SectionHeader title="Info" />
        <PropRow label="ID"><span style={{ fontSize: 9, color: AX.muted, fontFamily: "monospace" }}>{selectedClip.id}</span></PropRow>
        <PropRow label="Traccia"><span style={{ fontSize: 10, color: AX.text2 }}>{selectedClip.trackId}</span></PropRow>
      </div>
    </div>
  );
});
