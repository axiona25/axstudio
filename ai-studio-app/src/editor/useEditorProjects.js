import { useState, useCallback, useRef, useEffect } from "react";

const STORAGE_KEY = "axstudio-editor-projects";

function loadProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function persistProjects(projects) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)); } catch {}
}

function createEmptyProject(name) {
  return {
    id: `eproj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name || "Progetto senza titolo",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tracks: null,
    playheadTime: 0,
    zoom: 0.8,
    scrollX: 0,
    projectFps: 30,
    projectResolution: { width: 1920, height: 1080 },
  };
}

export function useEditorProjects() {
  const [projects, setProjects] = useState(loadProjects);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const dirtyRef = useRef(false);

  useEffect(() => { persistProjects(projects); }, [projects]);

  const activeProject = projects.find(p => p.id === activeProjectId) || null;

  const createProject = useCallback((name) => {
    const proj = createEmptyProject(name);
    setProjects(prev => [proj, ...prev]);
    setActiveProjectId(proj.id);
    dirtyRef.current = false;
    return proj;
  }, []);

  const saveProject = useCallback((timelineState) => {
    if (!activeProjectId) return null;
    setProjects(prev => prev.map(p => {
      if (p.id !== activeProjectId) return p;
      return {
        ...p,
        updatedAt: new Date().toISOString(),
        tracks: JSON.parse(JSON.stringify(timelineState.tracks)),
        playheadTime: timelineState.playheadTime,
        zoom: timelineState.zoom,
        scrollX: timelineState.scrollX,
        projectFps: timelineState.projectFps,
        projectResolution: timelineState.projectResolution,
      };
    }));
    dirtyRef.current = false;
    return activeProjectId;
  }, [activeProjectId]);

  const loadProject = useCallback((projectId) => {
    const proj = projects.find(p => p.id === projectId);
    if (!proj) return null;
    setActiveProjectId(projectId);
    dirtyRef.current = false;
    return proj;
  }, [projects]);

  const deleteProject = useCallback((projectId) => {
    setProjects(prev => prev.filter(p => p.id !== projectId));
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
      dirtyRef.current = false;
    }
  }, [activeProjectId]);

  const duplicateProject = useCallback((projectId) => {
    const orig = projects.find(p => p.id === projectId);
    if (!orig) return null;
    const dup = {
      ...JSON.parse(JSON.stringify(orig)),
      id: `eproj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${orig.name} (copia)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setProjects(prev => [dup, ...prev]);
    return dup;
  }, [projects]);

  const renameProject = useCallback((projectId, newName) => {
    setProjects(prev => prev.map(p =>
      p.id === projectId ? { ...p, name: newName, updatedAt: new Date().toISOString() } : p
    ));
  }, []);

  const markDirty = useCallback(() => { dirtyRef.current = true; }, []);

  const closeProject = useCallback(() => {
    setActiveProjectId(null);
    dirtyRef.current = false;
  }, []);

  return {
    projects,
    activeProject,
    activeProjectId,
    isDirty: dirtyRef.current,
    createProject,
    saveProject,
    loadProject,
    deleteProject,
    duplicateProject,
    renameProject,
    closeProject,
    markDirty,
  };
}
