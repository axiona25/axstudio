import React, { useCallback, useEffect, useState, useRef } from "react";
import {
  HiPhoto, HiMusicalNote, HiLanguage, HiSquare2Stack, HiSparkles,
  HiAdjustmentsHorizontal, HiArrowDownTray, HiScissors, HiTrash,
  HiArrowUturnLeft, HiArrowUturnRight, HiCog6Tooth, HiXMark,
  HiMicrophone, HiSpeakerWave, HiBolt, HiPencil,
  HiChatBubbleBottomCenterText, HiFilm, HiEye, HiArrowsRightLeft,
  HiArrowRight, HiMagnifyingGlass, HiSun, HiLightBulb,
  HiDocumentText, HiArrowPath, HiPaintBrush, HiCamera, HiSwatch,
  HiMoon, HiVideoCamera, HiClock, HiArrowsUpDown,
  HiViewfinderCircle, HiRectangleGroup,
  HiPlus, HiBookmarkSquare, HiDocumentDuplicate,
  HiFolderOpen, HiCheck, HiEllipsisVertical,
} from "react-icons/hi2";
import { useTimeline } from "./useTimeline";
import { useMediaLibrary } from "./useMediaLibrary";
import { useEditorProjects } from "./useEditorProjects";
import Timeline from "./Timeline";
import PreviewPlayer from "./PreviewPlayer";
import MediaLibraryPanel from "./MediaLibraryPanel";
import PropertiesPanel from "./PropertiesPanel";
import { MODULE_REGISTRY, MODULE_IDS } from "../config/moduleProviderRegistry.js";

const AX = {
  bg: "#0A0A0F", sidebar: "#11131A", surface: "#1A1F2B", border: "#2A3142",
  hover: "#232A38", text: "#F5F7FF", text2: "#C9D1E3", muted: "#8E97AA",
  blue: "#29B6FF", electric: "#4FD8FF", violet: "#7B4DFF", magenta: "#FF4FA3",
  orange: "#FF8A2A", gold: "#FFB347",
};

const SIDEBAR_W = 280;

const TOP_TABS = [
  { id: "media",       icon: HiPhoto,                  label: "File Media" },
  { id: "audio",       icon: HiMusicalNote,            label: "Audio" },
  { id: "text",        icon: HiLanguage,               label: "Testo" },
  { id: "transitions", icon: HiSquare2Stack,           label: "Transizioni" },
  { id: "effects",     icon: HiSparkles,               label: "Effetti" },
  { id: "filters",     icon: HiAdjustmentsHorizontal,  label: "Filtri" },
  { id: "export",      icon: HiArrowDownTray,          label: "Esporta" },
];

export default function VideoEditor({ projectName, projectMedia, history, mediaFileUrl }) {
  const timeline = useTimeline({ fps: 30, width: 1920, height: 1080 });
  const mediaLib = useMediaLibrary();
  const editorProjects = useEditorProjects();
  const [activeTab, setActiveTab] = useState("media");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const [projectMenuPos, setProjectMenuPos] = useState({ top: 0, right: 0 });
  const projectMenuRef = useRef(null);
  const projectBtnRef = useRef(null);

  const addMediaBatchRef = React.useRef(mediaLib.addMediaBatch);
  addMediaBatchRef.current = mediaLib.addMediaBatch;
  useEffect(() => {
    if (projectMedia && projectMedia.length > 0) {
      addMediaBatchRef.current(projectMedia);
    }
  }, [projectMedia]);

  const getFullEditorState = useCallback(() => ({
    ...timeline.getState(),
    activeTab,
    sidebarOpen,
  }), [timeline, activeTab, sidebarOpen]);

  const handleSaveProject = useCallback(() => {
    const state = getFullEditorState();
    if (!editorProjects.activeProjectId) {
      const proj = editorProjects.createProject("Progetto " + new Date().toLocaleDateString("it-IT"));
      setTimeout(() => editorProjects.saveProject(state), 50);
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 1200);
      return proj;
    }
    editorProjects.saveProject(state);
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 1200);
  }, [editorProjects, getFullEditorState]);

  const handleNewProject = useCallback(() => {
    timeline.resetTimeline();
    editorProjects.closeProject();
    setActiveTab("media");
    setSidebarOpen(false);
    setShowProjectMenu(false);
  }, [timeline, editorProjects]);

  const handleLoadProject = useCallback((projectId) => {
    const proj = editorProjects.loadProject(projectId);
    if (proj) {
      timeline.restoreState(proj);
      setActiveTab(proj.activeTab || "media");
      setSidebarOpen(proj.sidebarOpen || false);
    }
    setShowProjectMenu(false);
  }, [editorProjects, timeline]);

  const handleDeleteProject = useCallback((projectId) => {
    editorProjects.deleteProject(projectId);
    if (editorProjects.activeProjectId === projectId) {
      timeline.resetTimeline();
    }
  }, [editorProjects, timeline]);

  const handleDuplicateProject = useCallback((projectId) => {
    editorProjects.duplicateProject(projectId);
  }, [editorProjects]);

  useEffect(() => {
    if (!showProjectMenu) return;
    if (projectBtnRef.current) {
      const rect = projectBtnRef.current.getBoundingClientRect();
      setProjectMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    const handleClickOutside = (e) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target) &&
          projectBtnRef.current && !projectBtnRef.current.contains(e.target)) {
        setShowProjectMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showProjectMenu]);

  const handleDropMedia = useCallback((mediaData, trackId) => {
    const trackType = trackId.startsWith("V") ? "video" : trackId.startsWith("A") ? "audio" : "text";
    const mediaType = mediaData.type || "video";
    if (
      (trackType === "video" && (mediaType === "video" || mediaType === "image")) ||
      (trackType === "audio" && mediaType === "audio") ||
      (trackType === "text")
    ) {
      timeline.addClip(mediaData, trackId);
    }
  }, [timeline]);

  const handleResizeClip = useCallback((clipId, updates) => {
    timeline.updateClip(clipId, updates);
  }, [timeline]);

  const handleAddTextClip = useCallback((text) => {
    const clip = {
      id: `text-${Date.now()}`,
      name: text || "Testo",
      type: "text",
      src: "",
      thumbnail: "",
      duration: 5,
    };
    timeline.addClip(clip, "T1");
  }, [timeline]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.code === "KeyA") {
        e.preventDefault();
        const allIds = [];
        timeline.tracks.forEach(t => t.clips.forEach(c => allIds.push(c.id)));
        if (allIds.length > 0) timeline.selectClip(null);
        allIds.forEach(id => timeline.toggleSelectClip(id, true));
        return;
      }
      if (mod && e.code === "KeyS") { e.preventDefault(); handleSaveProject(); return; }
      if (mod && e.code === "KeyZ" && e.shiftKey) { e.preventDefault(); timeline.redo(); return; }
      if (mod && e.code === "KeyZ") { e.preventDefault(); timeline.undo(); return; }
      if (mod && e.code === "KeyC") { e.preventDefault(); timeline.copyClip(); return; }
      if (mod && e.code === "KeyX") { e.preventDefault(); timeline.cutClip(); return; }
      if (mod && e.code === "KeyV") { e.preventDefault(); timeline.pasteClip(); return; }

      switch (e.code) {
        case "Space":
          e.preventDefault();
          timeline.isPlaying ? timeline.pause() : timeline.play();
          break;
        case "KeyS":
          if (timeline.selectedClipId)
            timeline.splitClip(timeline.selectedClipId, timeline.playheadTime);
          break;
        case "Delete": case "Backspace":
          if (timeline.selectedClipIds.length > 1) timeline.removeSelectedClips();
          else if (timeline.selectedClipId) timeline.removeClip(timeline.selectedClipId);
          break;
        case "Enter":
          e.preventDefault();
          if (timeline.isPlaying) timeline.pause();
          timeline.seekTo(0);
          break;
        case "ArrowLeft": e.preventDefault(); timeline.stepFrame(-1); break;
        case "ArrowRight": e.preventDefault(); timeline.stepFrame(1); break;
        case "Equal": case "NumpadAdd": timeline.setZoom(Math.min(10, timeline.zoom * 1.25)); break;
        case "Minus": case "NumpadSubtract": timeline.setZoom(Math.max(0.1, timeline.zoom * 0.8)); break;
        case "KeyJ": timeline.seekTo(Math.max(0, timeline.playheadTime - 2)); break;
        case "KeyK": timeline.isPlaying ? timeline.pause() : timeline.play(); break;
        case "KeyL": timeline.seekTo(timeline.playheadTime + 2); break;
        default: break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [timeline, handleSaveProject]);

  const selectedClip = timeline.getSelectedClip();

  const renderLeftPanel = () => {
    switch (activeTab) {
      case "media":
        return (
          <MediaLibraryPanel
            history={history}
            mediaFileUrl={mediaFileUrl}
            timeline={timeline}
          />
        );
      case "audio":
        return <AudioPanel onAddMedia={mediaLib.addMedia} />;
      case "text":
        return <TextPanel onAddText={handleAddTextClip} />;
      case "transitions":
        return <TransitionsPanel />;
      case "effects":
        return <EffectsPanel />;
      case "filters":
        return <FiltersPanel />;
      case "export":
        return (
          <ExportPanel
            resolution={timeline.projectResolution}
            fps={timeline.projectFps}
            duration={timeline.totalDuration}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: AX.bg, overflow: "hidden", position: "relative",
    }}>
      {/* ── Header ── */}
      <header style={{
        padding: "12px 28px", display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 16,
        borderBottom: `1px solid ${AX.border}`, background: AX.bg, flexShrink: 0,
      }}>
        <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 14 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: AX.text, letterSpacing: "-0.02em" }}>Video Editor</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: AX.muted }}>{MODULE_REGISTRY[MODULE_IDS.VIDEO_EDITOR].ui.headerSubtitle}</p>
          </div>
          {editorProjects.activeProject && (
            <div style={{
              marginLeft: 8, padding: "3px 10px", borderRadius: 6,
              background: "rgba(123,77,255,0.12)", border: `1px solid rgba(123,77,255,0.25)`,
              fontSize: 11, fontWeight: 600, color: AX.violet, maxWidth: 200,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{editorProjects.activeProject.name}</div>
          )}
        </div>
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: AX.muted, marginRight: 4 }}>
            {timeline.projectResolution.width}×{timeline.projectResolution.height} · {timeline.projectFps}fps
          </span>

          {/* Nuovo progetto */}
          <HeaderBtn icon={<HiPlus size={14} />} label="Nuovo" onClick={handleNewProject} />

          {/* Salva progetto */}
          <HeaderBtn
            icon={saveFlash ? <HiCheck size={14} /> : <HiBookmarkSquare size={14} />}
            label={saveFlash ? "Salvato!" : "Salva"}
            accent={saveFlash}
            onClick={handleSaveProject}
          />

          {/* I miei progetti */}
          <div style={{ position: "relative" }}>
            <HeaderBtn ref={projectBtnRef} icon={<HiFolderOpen size={14} />} label="Progetti" onClick={() => setShowProjectMenu(v => !v)} active={showProjectMenu} />
          </div>

          <div style={{ width: 1, height: 22, background: AX.border, margin: "0 2px" }} />

          <button type="button" onClick={() => setSidebarOpen(!sidebarOpen)} style={{
            padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600,
            border: `1px solid ${sidebarOpen ? AX.violet : AX.border}`,
            background: sidebarOpen ? "rgba(123,77,255,0.14)" : "transparent",
            color: sidebarOpen ? AX.electric : AX.text2, cursor: "pointer",
            transition: "all 0.2s",
          }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              {sidebarOpen ? <><HiXMark size={14} /> Chiudi</> : <><HiCog6Tooth size={14} /> Proprietà</>}
            </span>
          </button>
        </div>
      </header>

      {/* ── TOP TAB BAR ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: 2, padding: "6px 16px",
        background: AX.sidebar, borderBottom: `1px solid ${AX.border}`,
        flexShrink: 0,
      }}>
        {TOP_TABS.map(tab => {
          const active = activeTab === tab.id;
          const IconComp = tab.icon;
          return (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              padding: "6px 14px", borderRadius: 8, border: "none",
              background: active ? "rgba(123,77,255,0.14)" : "transparent",
              color: active ? AX.electric : AX.muted, cursor: "pointer",
              transition: "all 0.15s", minWidth: 64,
            }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = AX.hover; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
            >
              <IconComp size={20} />
              <span style={{
                fontSize: 9, fontWeight: active ? 700 : 500,
                letterSpacing: "0.02em", whiteSpace: "nowrap",
              }}>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── UPPER ZONE — Left panel + Preview Player ── */}
      <div style={{
        display: "flex", gap: 0, flexShrink: 0,
        height: "42%", minHeight: 240,
        borderBottom: `1px solid ${AX.border}`,
      }}>
        {/* LEFT BOX — Dynamic panel based on active tab */}
        <div style={{
          flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
          borderRight: `1px solid ${AX.border}`,
          background: AX.sidebar, overflow: "hidden",
        }}>
          {renderLeftPanel()}
        </div>

        {/* RIGHT BOX — Preview Player */}
        <div style={{
          flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
          background: "#000",
        }}>
          <PreviewPlayer
            playheadTime={timeline.playheadTime}
            totalDuration={timeline.totalDuration}
            isPlaying={timeline.isPlaying}
            playbackSpeed={timeline.playbackSpeed}
            onPlay={timeline.play}
            onPause={timeline.pause}
            onStop={timeline.stop}
            onSeek={timeline.seekTo}
            onStepFrame={timeline.stepFrame}
            onSpeedChange={timeline.setPlaybackSpeed}
            tracks={timeline.tracks}
            resolution={timeline.projectResolution}
          />
        </div>
      </div>

      {/* ── EDIT TOOLBAR ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "5px 12px",
        background: AX.sidebar, borderBottom: `1px solid ${AX.border}`,
        flexShrink: 0,
      }}>
        <EditToolBtn icon={<HiScissors size={14} />} title="Dividi (S)" onClick={() => {
          if (timeline.selectedClipId) timeline.splitClip(timeline.selectedClipId, timeline.playheadTime);
        }} />
        <EditToolBtn icon={<HiTrash size={14} />} title="Elimina (Del)" onClick={() => {
          if (timeline.selectedClipIds.length > 1) timeline.removeSelectedClips();
          else if (timeline.selectedClipId) timeline.removeClip(timeline.selectedClipId);
        }} />
        <div style={{ width: 1, height: 18, background: AX.border, margin: "0 4px" }} />
        <EditToolBtn icon={<HiArrowUturnLeft size={14} />} title="Undo (⌘Z)" onClick={() => timeline.undo()} disabled={!timeline.canUndo} />
        <EditToolBtn icon={<HiArrowUturnRight size={14} />} title="Redo (⌘⇧Z)" onClick={() => timeline.redo()} disabled={!timeline.canRedo} />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: AX.muted }}>
          Durata: {timeline.totalDuration.toFixed(1)}s
        </span>
      </div>

      {/* ── LOWER ZONE — Timeline ── */}
      <div style={{ flex: 1, minHeight: 120, display: "flex", flexDirection: "column" }}>
        <Timeline
          tracks={timeline.tracks}
          playheadTime={timeline.playheadTime}
          isPlaying={timeline.isPlaying}
          zoom={timeline.zoom}
          scrollX={timeline.scrollX}
          selectedClipIds={timeline.selectedClipIds}
          totalDuration={timeline.totalDuration}
          onSeek={timeline.seekTo}
          onZoomChange={timeline.setZoom}
          onScrollChange={timeline.setScrollX}
          onToggleSelectClip={timeline.toggleSelectClip}
          onMoveClip={timeline.moveClip}
          onBeginMultiDrag={timeline.beginMultiDrag}
          onUpdateMultiDrag={timeline.updateMultiDrag}
          onEndMultiDrag={timeline.endMultiDrag}
          onResizeClip={handleResizeClip}
          onSplitClip={timeline.splitClip}
          onRemoveClip={timeline.removeClip}
          onDropMedia={handleDropMedia}
          onToggleMute={timeline.toggleTrackMute}
          onToggleLock={timeline.toggleTrackLock}
        />
      </div>

      {/* ── COLLAPSIBLE SIDEBAR — overlays right ── */}
      {sidebarOpen && (
        <div style={{
          position: "absolute", top: 0, right: 0, bottom: 0,
          width: SIDEBAR_W, zIndex: 50,
          background: "rgba(17,19,26,0.97)",
          borderLeft: `1px solid ${AX.border}`,
          backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column",
          animation: "slideInRight 0.2s ease",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 16px", borderBottom: `1px solid ${AX.border}`,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: AX.text }}>Proprietà</span>
            <button type="button" onClick={() => setSidebarOpen(false)} style={{
              width: 24, height: 24, borderRadius: 6, border: "none",
              background: "transparent", color: AX.muted, cursor: "pointer",
              fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center",
            }}
              onMouseEnter={e => { e.currentTarget.style.background = AX.hover; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >✕</button>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            <PropertiesPanel
              selectedClip={selectedClip}
              onUpdateClip={timeline.updateClip}
              projectFps={timeline.projectFps}
              projectResolution={timeline.projectResolution}
              onResolutionChange={timeline.setProjectResolution}
              onFpsChange={timeline.setProjectFps}
            />
          </div>
        </div>
      )}

      {/* ── Progetti overlay ── */}
      {showProjectMenu && editorProjects.projects.length <= 4 && (
        <div ref={projectMenuRef} style={{
          position: "fixed", top: projectMenuPos.top, right: projectMenuPos.right, zIndex: 9999,
          width: 340, maxHeight: "min(480px, calc(100vh - 80px))", overflow: "auto",
          background: "rgba(17,19,26,0.98)", border: `1px solid ${AX.border}`,
          borderRadius: 12, boxShadow: "0 16px 48px rgba(0,0,0,0.7)",
          backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
        }}>
          <ProjectListContent
            projects={editorProjects.projects}
            activeProjectId={editorProjects.activeProjectId}
            onLoad={handleLoadProject}
            onDuplicate={handleDuplicateProject}
            onDelete={handleDeleteProject}
          />
        </div>
      )}

      {/* ── Progetti modale (>4 progetti) ── */}
      {showProjectMenu && editorProjects.projects.length > 4 && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          animation: "fadeIn 0.15s ease",
        }} onClick={(e) => { if (e.target === e.currentTarget) setShowProjectMenu(false); }}>
          <div ref={projectMenuRef} style={{
            width: "min(520px, 90vw)", maxHeight: "min(600px, 80vh)",
            background: "rgba(17,19,26,0.98)", border: `1px solid ${AX.border}`,
            borderRadius: 16, boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
            backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
            display: "flex", flexDirection: "column",
            animation: "scaleIn 0.2s ease",
          }}>
            <div style={{
              padding: "16px 20px 12px", borderBottom: `1px solid ${AX.border}`,
              display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
            }}>
              <div>
                <span style={{ fontSize: 15, fontWeight: 700, color: AX.text }}>I miei progetti</span>
                <span style={{ fontSize: 11, color: AX.muted, marginLeft: 10 }}>
                  {editorProjects.projects.length} progett{editorProjects.projects.length === 1 ? "o" : "i"}
                </span>
              </div>
              <button type="button" onClick={() => setShowProjectMenu(false)} style={{
                width: 28, height: 28, borderRadius: 7, border: `1px solid ${AX.border}`,
                background: "transparent", color: AX.muted, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
                onMouseEnter={e => { e.currentTarget.style.background = AX.hover; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              ><HiXMark size={16} /></button>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "4px 8px 8px" }}>
              {editorProjects.projects.map(p => (
                <ProjectListItem
                  key={p.id}
                  project={p}
                  isActive={p.id === editorProjects.activeProjectId}
                  onLoad={() => handleLoadProject(p.id)}
                  onDuplicate={() => handleDuplicateProject(p.id)}
                  onDelete={() => handleDeleteProject(p.id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes scaleIn {
          from { transform: scale(0.95); opacity: 0; }
          to   { transform: scale(1);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════
   TAB PANEL CONTENTS
   ═══════════════════════════════════════════ */

function PanelShell({ children }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "rgba(17,19,26,0.6)", overflow: "hidden",
    }}>{children}</div>
  );
}

function PanelHeader({ title, right }) {
  return (
    <div style={{
      padding: "12px 14px 8px",
      borderBottom: `1px solid ${AX.border}`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
    }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: AX.text, letterSpacing: "0.04em" }}>{title}</span>
      {right || null}
    </div>
  );
}

function PanelEmpty({ icon, title, desc }) {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: 8, padding: 24,
    }}>
      <span style={{ fontSize: 32, opacity: 0.35, color: AX.muted, display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: AX.text2 }}>{title}</span>
      <span style={{ fontSize: 11, color: AX.muted, textAlign: "center", lineHeight: 1.5 }}>{desc}</span>
    </div>
  );
}

function PanelListItem({ icon, label, desc, onClick, tag }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", width: "100%",
      borderRadius: 8, border: "1px solid transparent", background: "transparent",
      cursor: "pointer", textAlign: "left", transition: "all 0.15s",
      fontFamily: "'DM Sans', sans-serif",
    }}
      onMouseEnter={e => { e.currentTarget.style.background = AX.hover; e.currentTarget.style.borderColor = AX.border; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}
    >
      <span style={{ fontSize: 18, width: 28, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: AX.electric, opacity: 0.7 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: AX.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
        {desc && <div style={{ fontSize: 9, color: AX.muted, marginTop: 1 }}>{desc}</div>}
      </div>
      {tag && (
        <span style={{
          fontSize: 8, padding: "2px 6px", borderRadius: 4, fontWeight: 700,
          background: "rgba(123,77,255,0.15)", color: AX.violet, textTransform: "uppercase",
          flexShrink: 0,
        }}>{tag}</span>
      )}
    </button>
  );
}

function PanelGridCard({ icon, label, desc, onClick, tag, accent }) {
  const accentColor = accent || AX.electric;
  return (
    <button type="button" onClick={onClick} style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 5, padding: "12px 6px 10px",
      borderRadius: 10, border: `1px solid transparent`,
      background: AX.surface, cursor: "pointer", textAlign: "center",
      transition: "all 0.15s", fontFamily: "'DM Sans', sans-serif",
      position: "relative", overflow: "hidden", minHeight: 80,
    }}
      onMouseEnter={e => { e.currentTarget.style.background = AX.hover; e.currentTarget.style.borderColor = accentColor + "50"; }}
      onMouseLeave={e => { e.currentTarget.style.background = AX.surface; e.currentTarget.style.borderColor = "transparent"; }}
    >
      <div style={{
        width: 34, height: 34, borderRadius: 8,
        background: accentColor + "18",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: accentColor, flexShrink: 0,
      }}>{icon}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: AX.text, lineHeight: 1.2,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%",
      }}>{label}</div>
      {desc && <div style={{ fontSize: 8, color: AX.muted, lineHeight: 1.2, maxWidth: "100%",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{desc}</div>}
      {tag && (
        <span style={{
          position: "absolute", top: 4, right: 4,
          fontSize: 6, padding: "1px 4px", borderRadius: 3, fontWeight: 700,
          background: "rgba(123,77,255,0.2)", color: AX.violet, textTransform: "uppercase",
        }}>{tag}</span>
      )}
    </button>
  );
}

/* ── Audio Panel ── */
function AudioPanel({ onAddMedia }) {
  const fileRef = React.useRef(null);
  return (
    <PanelShell>
      <PanelHeader title="Audio" right={
        <button type="button" onClick={() => fileRef.current?.click()} style={{
          padding: "4px 10px", borderRadius: 6, border: `1px solid ${AX.border}`,
          background: "transparent", color: AX.electric, fontSize: 11, fontWeight: 600, cursor: "pointer",
        }}>+ Importa</button>
      } />
      <input ref={fileRef} type="file" multiple accept="audio/*" style={{ display: "none" }}
        onChange={(e) => {
          Array.from(e.target.files || []).forEach(f => {
            const url = URL.createObjectURL(f);
            onAddMedia({ name: f.name, objectURL: url, src: url, size: f.size }, { duration: 5, type: "audio" });
          });
          e.target.value = "";
        }}
      />
      <div style={{ flex: 1, overflow: "auto", padding: "4px 6px" }}>
        <div style={{ padding: "8px 8px 4px" }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: AX.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>Musica & Effetti</span>
        </div>
        <PanelListItem icon={<HiMusicalNote size={18} />} label="Musica AI" desc="Genera musica con AI" tag="Presto" />
        <PanelListItem icon={<HiMicrophone size={18} />} label="Voiceover AI" desc="Text-to-speech narrazione" tag="Presto" />
        <PanelListItem icon={<HiSpeakerWave size={18} />} label="Effetti sonori" desc="Whoosh, impatto, ambiente" tag="Presto" />
        <div style={{ height: 1, background: AX.border, margin: "8px 12px" }} />
        <div style={{ padding: "8px 8px 4px" }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: AX.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>I miei file</span>
        </div>
        <PanelEmpty icon={<HiMusicalNote size={36} />} title="Nessun audio" desc="Importa file audio MP3, WAV, M4A dal tuo computer" />
      </div>
    </PanelShell>
  );
}

/* ── Text Panel ── */
function TextPanel({ onAddText }) {
  const [textValue, setTextValue] = useState("");
  const TEXT_PRESETS = [
    { icon: <HiLanguage size={20} />, label: "Titolo", desc: "Grande, centrato", defaultText: "Titolo" },
    { icon: <HiChatBubbleBottomCenterText size={20} />, label: "Sottotitolo", desc: "Piccolo, in basso", defaultText: "Sottotitolo" },
    { icon: <HiRectangleGroup size={20} />, label: "Lower Third", desc: "Barra nome", defaultText: "Nome Cognome" },
    { icon: <HiPencil size={20} />, label: "Testo libero", desc: "Ovunque", defaultText: "Testo" },
    { icon: <HiFilm size={20} />, label: "Cinematografico", desc: "Typewriter", defaultText: "Il mio film" },
  ];
  return (
    <PanelShell>
      <PanelHeader title="Testo & Titoli" />
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${AX.border}` }}>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={textValue}
            onChange={e => setTextValue(e.target.value)}
            placeholder="Scrivi il testo..."
            style={{
              flex: 1, padding: "8px 10px", borderRadius: 8,
              background: AX.bg, border: `1px solid ${AX.border}`,
              color: AX.text, fontSize: 12, outline: "none",
              fontFamily: "'DM Sans', sans-serif",
            }}
            onKeyDown={e => { if (e.key === "Enter" && textValue.trim()) { onAddText(textValue.trim()); setTextValue(""); } }}
          />
          <button type="button" onClick={() => { if (textValue.trim()) { onAddText(textValue.trim()); setTextValue(""); } }} style={{
            padding: "8px 14px", borderRadius: 8, border: "none",
            background: textValue.trim() ? "linear-gradient(135deg, #7B4DFF, #29B6FF)" : AX.surface,
            color: textValue.trim() ? "#fff" : AX.muted, fontSize: 11, fontWeight: 700, cursor: textValue.trim() ? "pointer" : "default",
          }}>Aggiungi</button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "8px 10px" }}>
        <div style={{ padding: "4px 2px 8px" }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: AX.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>Modelli di testo</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {TEXT_PRESETS.map(p => (
            <PanelGridCard key={p.label} icon={p.icon} label={p.label} desc={p.desc}
              accent={AX.magenta} onClick={() => onAddText(p.defaultText)} />
          ))}
        </div>
      </div>
    </PanelShell>
  );
}

/* ── Transitions Panel ── */
function TransitionsPanel() {
  const TRANSITIONS = [
    { icon: <HiEye size={20} />, label: "Dissolvenza", desc: "Fade In/Out" },
    { icon: <HiArrowRight size={20} />, label: "Wipe", desc: "Direzione" },
    { icon: <HiArrowsRightLeft size={20} />, label: "Slide", desc: "Push" },
    { icon: <HiMagnifyingGlass size={20} />, label: "Zoom", desc: "In / Out" },
    { icon: <HiViewfinderCircle size={20} />, label: "Blur", desc: "Sfocatura" },
    { icon: <HiBolt size={20} />, label: "Glitch", desc: "Digitale" },
    { icon: <HiLightBulb size={20} />, label: "Flash", desc: "Bianco/Nero" },
    { icon: <HiSparkles size={20} />, label: "Shape", desc: "Forme" },
    { icon: <HiDocumentText size={20} />, label: "Page Turn", desc: "Pagina" },
    { icon: <HiArrowPath size={20} />, label: "Morph", desc: "Simili" },
  ];
  return (
    <PanelShell>
      <PanelHeader title="Transizioni" />
      <div style={{ flex: 1, overflow: "auto", padding: "8px 10px" }}>
        <div style={{ padding: "4px 2px 8px" }}>
          <span style={{ fontSize: 10, color: AX.muted, lineHeight: 1.5 }}>
            Trascina una transizione tra due clip sulla timeline
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {TRANSITIONS.map(t => (
            <PanelGridCard key={t.label} icon={t.icon} label={t.label} desc={t.desc}
              tag="Fase 2" accent={AX.gold} onClick={() => {}} />
          ))}
        </div>
      </div>
    </PanelShell>
  );
}

/* ── Effects Panel ── */
function EffectsPanel() {
  const EFFECTS = [
    { icon: <HiPaintBrush size={20} />, label: "Colore", desc: "Luminosità, contrasto" },
    { icon: <HiSun size={20} />, label: "Temperatura", desc: "Caldo / Freddo" },
    { icon: <HiCamera size={20} />, label: "LUT Cinema", desc: "Look preset" },
    { icon: <HiViewfinderCircle size={20} />, label: "Blur", desc: "Gaussiano, motion" },
    { icon: <HiSparkles size={20} />, label: "Sharpen", desc: "Nitidezza" },
    { icon: <HiBolt size={20} />, label: "Glitch", desc: "Distorsione" },
    { icon: <HiClock size={20} />, label: "Speed Ramp", desc: "Slow/Fast" },
    { icon: <HiArrowPath size={20} />, label: "Reverse", desc: "Inverti" },
    { icon: <HiArrowsUpDown size={20} />, label: "Mirror/Flip", desc: "Specchio" },
    { icon: <HiSwatch size={20} />, label: "Aberrazione", desc: "RGB split" },
    { icon: <HiFilm size={20} />, label: "Film Grain", desc: "Pellicola" },
    { icon: <HiMoon size={20} />, label: "Vignette", desc: "Bordi scuri" },
  ];
  return (
    <PanelShell>
      <PanelHeader title="Effetti Video" />
      <div style={{ flex: 1, overflow: "auto", padding: "8px 10px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {EFFECTS.map(ef => (
            <PanelGridCard key={ef.label} icon={ef.icon} label={ef.label} desc={ef.desc}
              tag="Fase 4" accent={AX.blue} onClick={() => {}} />
          ))}
        </div>
      </div>
    </PanelShell>
  );
}

/* ── Filters Panel ── */
function FiltersPanel() {
  const FILTERS = [
    { icon: <HiVideoCamera size={20} />, label: "Cinematic", desc: "Letterbox" },
    { icon: <HiFilm size={20} />, label: "Film Vintage", desc: "Grain caldo" },
    { icon: <HiBolt size={20} />, label: "Neon", desc: "Cyberpunk" },
    { icon: <HiSun size={20} />, label: "Sepia", desc: "Toni classici" },
    { icon: <HiMoon size={20} />, label: "B&N", desc: "Monocromatico" },
    { icon: <HiSparkles size={20} />, label: "Comic", desc: "Cartoon" },
    { icon: <HiPencil size={20} />, label: "Sketch", desc: "Disegno" },
  ];
  return (
    <PanelShell>
      <PanelHeader title="Filtri Stile" />
      <div style={{ flex: 1, overflow: "auto", padding: "8px 10px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {FILTERS.map(f => (
            <PanelGridCard key={f.label} icon={f.icon} label={f.label} desc={f.desc}
              tag="Fase 4" accent={AX.violet} onClick={() => {}} />
          ))}
        </div>
      </div>
    </PanelShell>
  );
}

/* ── Export Panel ── */
function ExportPanel({ resolution, fps, duration }) {
  return (
    <PanelShell>
      <PanelHeader title="Esporta Video" />
      <div style={{ flex: 1, overflow: "auto", padding: "12px 14px" }}>
        <SectionLabel text="Formato" />
        <SelectProp label="Formato" value="mp4-h264" options={[
          { v: "mp4-h264", l: "MP4 (H.264)" }, { v: "mp4-h265", l: "MP4 (H.265/HEVC)" },
          { v: "webm", l: "WebM (VP9)" }, { v: "mov", l: "MOV (ProRes)" }, { v: "gif", l: "GIF" },
        ]} />
        <SelectProp label="Risoluzione" value={`${resolution?.width}x${resolution?.height}`} options={[
          { v: "1280x720", l: "720p" }, { v: "1920x1080", l: "1080p" },
          { v: "2560x1440", l: "2K" }, { v: "3840x2160", l: "4K" },
        ]} />
        <SelectProp label="FPS" value={String(fps)} options={[
          { v: "24", l: "24 fps" }, { v: "25", l: "25 fps" },
          { v: "30", l: "30 fps" }, { v: "60", l: "60 fps" },
        ]} />
        <SelectProp label="Qualità" value="alta" options={[
          { v: "bassa", l: "Bassa (draft)" }, { v: "media", l: "Media" },
          { v: "alta", l: "Alta" }, { v: "massima", l: "Massima (CRF 18)" },
        ]} />

        <div style={{ height: 1, background: AX.border, margin: "14px 0" }} />

        <SectionLabel text="Riepilogo" />
        <div style={{ fontSize: 11, color: AX.text2, lineHeight: 1.8 }}>
          <div>Risoluzione: <strong style={{ color: AX.text }}>{resolution?.width}×{resolution?.height}</strong></div>
          <div>Frame rate: <strong style={{ color: AX.text }}>{fps} fps</strong></div>
          <div>Durata: <strong style={{ color: AX.text }}>{duration?.toFixed(1)}s</strong></div>
        </div>

        <button type="button" disabled={!duration || duration <= 0} style={{
          width: "100%", marginTop: 18, padding: "12px 20px", borderRadius: 10,
          border: "none", fontWeight: 700, fontSize: 13, cursor: duration > 0 ? "pointer" : "not-allowed",
          background: duration > 0 ? "linear-gradient(135deg, #7B4DFF, #29B6FF)" : AX.surface,
          color: duration > 0 ? "#fff" : AX.muted,
          boxShadow: duration > 0 ? "0 6px 20px rgba(123,77,255,0.3)" : "none",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <HiArrowDownTray size={16} /> Esporta Video
        </button>
        <p style={{ fontSize: 9, color: AX.muted, textAlign: "center", marginTop: 8 }}>
          L'export utilizza ffmpeg nel processo Electron
        </p>
      </div>
    </PanelShell>
  );
}

/* ═══════════════════════════════════════════
   SHARED SMALL COMPONENTS
   ═══════════════════════════════════════════ */

function SectionLabel({ text }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: AX.muted, letterSpacing: "0.1em",
      textTransform: "uppercase", marginBottom: 10, marginTop: 2, paddingBottom: 6,
      borderBottom: `1px solid ${AX.border}`,
    }}>{text}</div>
  );
}

function SelectProp({ label, value, options, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <span style={{ fontSize: 11, color: AX.muted, fontWeight: 500 }}>{label}</span>
      <select value={value} onChange={e => onChange?.(e.target.value)} style={{
        background: AX.bg, color: AX.text2, border: `1px solid ${AX.border}`,
        borderRadius: 6, padding: "4px 8px", fontSize: 10, cursor: "pointer",
        outline: "none", fontFamily: "'DM Sans', sans-serif",
      }}>
        {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}

function EditToolBtn({ icon, title, onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} title={title} disabled={disabled} style={{
      width: 30, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
      background: "none", border: `1px solid ${AX.border}`, borderRadius: 6,
      color: disabled ? "rgba(142,151,170,0.3)" : AX.text2,
      cursor: disabled ? "not-allowed" : "pointer", fontSize: 13, transition: "background 0.15s",
    }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = "rgba(123,77,255,0.15)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
    >{icon}</button>
  );
}

const HeaderBtn = React.forwardRef(function HeaderBtn({ icon, label, onClick, active, accent }, ref) {
  return (
    <button ref={ref} type="button" onClick={onClick} style={{
      padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600,
      border: `1px solid ${active ? AX.violet : accent ? "rgba(76,217,100,0.4)" : AX.border}`,
      background: active ? "rgba(123,77,255,0.14)" : accent ? "rgba(76,217,100,0.12)" : "transparent",
      color: active ? AX.electric : accent ? "#4CD964" : AX.text2,
      cursor: "pointer", transition: "all 0.2s",
      display: "inline-flex", alignItems: "center", gap: 5,
    }}
      onMouseEnter={e => { if (!active && !accent) e.currentTarget.style.background = AX.hover; }}
      onMouseLeave={e => { if (!active && !accent) e.currentTarget.style.background = "transparent"; }}
    >{icon} {label}</button>
  );
});

function ProjectListContent({ projects, activeProjectId, onLoad, onDuplicate, onDelete }) {
  return (
    <>
      <div style={{
        padding: "12px 14px 8px", borderBottom: `1px solid ${AX.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, background: "rgba(17,19,26,0.98)", zIndex: 1, borderRadius: "12px 12px 0 0",
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: AX.text }}>I miei progetti</span>
        <span style={{ fontSize: 10, color: AX.muted }}>{projects.length} progett{projects.length === 1 ? "o" : "i"}</span>
      </div>
      {projects.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center" }}>
          <HiFolderOpen size={28} style={{ color: AX.muted, opacity: 0.4, marginBottom: 8 }} />
          <div style={{ fontSize: 12, color: AX.muted }}>Nessun progetto salvato</div>
          <div style={{ fontSize: 10, color: AX.muted, marginTop: 4 }}>Usa "Salva" o ⌘S per creare un progetto</div>
        </div>
      ) : (
        <div style={{ padding: "4px 6px" }}>
          {projects.map(p => (
            <ProjectListItem
              key={p.id}
              project={p}
              isActive={p.id === activeProjectId}
              onLoad={() => onLoad(p.id)}
              onDuplicate={() => onDuplicate(p.id)}
              onDelete={() => onDelete(p.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ProjectListItem({ project, isActive, onLoad, onDuplicate, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menuOpen]);

  const clipCount = project.tracks
    ? project.tracks.reduce((sum, t) => sum + (t.clips ? t.clips.length : 0), 0)
    : 0;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
      borderRadius: 8, cursor: "pointer", transition: "all 0.15s",
      background: isActive ? "rgba(123,77,255,0.1)" : "transparent",
      border: `1px solid ${isActive ? "rgba(123,77,255,0.25)" : "transparent"}`,
    }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = AX.hover; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = isActive ? "rgba(123,77,255,0.1)" : "transparent"; }}
      onClick={onLoad}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: isActive
          ? "linear-gradient(135deg, rgba(123,77,255,0.3), rgba(41,182,255,0.3))"
          : AX.surface,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <HiFilm size={16} style={{ color: isActive ? AX.electric : AX.muted }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 600, color: AX.text,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{project.name}</div>
        <div style={{ fontSize: 9, color: AX.muted, marginTop: 2 }}>
          {clipCount} clip · {new Date(project.updatedAt).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
      {isActive && (
        <span style={{
          fontSize: 7, fontWeight: 700, padding: "2px 5px", borderRadius: 4,
          background: "rgba(123,77,255,0.2)", color: AX.violet, textTransform: "uppercase",
        }}>Attivo</span>
      )}
      <div style={{ position: "relative" }}>
        <button type="button" onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }} style={{
          width: 22, height: 22, borderRadius: 5, border: "none",
          background: "transparent", color: AX.muted, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
        }}
          onMouseEnter={e => { e.currentTarget.style.background = AX.surface; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        ><HiEllipsisVertical size={14} /></button>
        {menuOpen && (
          <div ref={menuRef} style={{
            position: "absolute", top: "100%", right: 0, zIndex: 300,
            background: AX.sidebar, border: `1px solid ${AX.border}`,
            borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            padding: 4, minWidth: 130,
          }}>
            <CtxBtn icon={<HiDocumentDuplicate size={13} />} label="Duplica" onClick={(e) => { e.stopPropagation(); onDuplicate(); setMenuOpen(false); }} />
            <CtxBtn icon={<HiTrash size={13} />} label="Elimina" danger onClick={(e) => { e.stopPropagation(); onDelete(); setMenuOpen(false); }} />
          </div>
        )}
      </div>
    </div>
  );
}

function CtxBtn({ icon, label, onClick, danger }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 7, width: "100%",
      padding: "6px 10px", borderRadius: 6, border: "none",
      background: "transparent", color: danger ? "#FF4F4F" : AX.text2,
      fontSize: 11, fontWeight: 500, cursor: "pointer", textAlign: "left",
    }}
      onMouseEnter={e => { e.currentTarget.style.background = danger ? "rgba(255,79,79,0.1)" : AX.hover; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
    >{icon} {label}</button>
  );
}

