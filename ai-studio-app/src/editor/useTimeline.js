import { useState, useCallback, useRef, useEffect } from "react";

let _clipIdCounter = 1;
export function genClipId() { return `clip-${Date.now()}-${_clipIdCounter++}`; }

const TRACK_TYPES = { VIDEO: "video", AUDIO: "audio", TEXT: "text" };

function createDefaultTracks() {
  return [
    { id: "V1", type: TRACK_TYPES.VIDEO, label: "Video 1", clips: [], muted: false, locked: false },
    { id: "V2", type: TRACK_TYPES.VIDEO, label: "Video 2 (overlay)", clips: [], muted: false, locked: false },
    { id: "A1", type: TRACK_TYPES.AUDIO, label: "Audio 1", clips: [], muted: false, locked: false, volume: 1 },
    { id: "A2", type: TRACK_TYPES.AUDIO, label: "Audio 2", clips: [], muted: false, locked: false, volume: 1 },
    { id: "T1", type: TRACK_TYPES.TEXT, label: "Testi", clips: [], muted: false, locked: false },
  ];
}

function createClip(media, trackId, startTime, duration) {
  return {
    id: genClipId(),
    trackId,
    mediaId: media?.id || null,
    name: media?.name || "Clip",
    src: media?.src || media?.url || "",
    thumbnail: media?.thumbnail || media?.src || "",
    type: media?.type || "video",
    startTime,
    duration: duration || media?.duration || 5,
    trimStart: 0,
    trimEnd: 0,
    originalDuration: media?.duration || duration || 5,
    volume: 1,
    opacity: 1,
    selected: false,
    effects: [],
    transitions: { in: null, out: null },
  };
}

const SNAP_THRESHOLD_PX = 8;

export function useTimeline({ fps = 30, width = 1920, height = 1080 } = {}) {
  const [tracks, setTracks] = useState(createDefaultTracks);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoom, setZoom] = useState(0.8);
  const [scrollX, setScrollX] = useState(0);
  const [selectedClipIds, setSelectedClipIds] = useState([]);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [projectFps, setProjectFps] = useState(fps);
  const [projectResolution, setProjectResolution] = useState({ width, height });

  const playTimerRef = useRef(null);
  const lastFrameRef = useRef(null);

  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const [, setHistoryTick] = useState(0);
  const clipboardRef = useRef(null);

  const selectClip = useCallback((clipId) => {
    setSelectedClipIds(clipId ? [clipId] : []);
  }, []);

  const toggleSelectClip = useCallback((clipId, multiKey) => {
    if (!multiKey) {
      setSelectedClipIds(clipId ? [clipId] : []);
      return;
    }
    setSelectedClipIds(prev => {
      if (prev.includes(clipId)) return prev.filter(id => id !== clipId);
      return [...prev, clipId];
    });
  }, []);

  const pushUndo = useCallback((snapshot) => {
    undoStackRef.current = [...undoStackRef.current.slice(-49), snapshot];
    redoStackRef.current = [];
    setHistoryTick(v => v + 1);
  }, []);

  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const snapshot = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    setTracks(prev => {
      redoStackRef.current = [...redoStackRef.current, JSON.parse(JSON.stringify(prev))];
      return JSON.parse(JSON.stringify(snapshot));
    });
    setHistoryTick(v => v + 1);
  }, []);

  const redo = useCallback(() => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const snapshot = stack[stack.length - 1];
    redoStackRef.current = stack.slice(0, -1);
    setTracks(prev => {
      undoStackRef.current = [...undoStackRef.current, JSON.parse(JSON.stringify(prev))];
      return JSON.parse(JSON.stringify(snapshot));
    });
    setHistoryTick(v => v + 1);
  }, []);

  const canUndo = undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;

  const withUndo = useCallback((fn) => {
    setTracks(prev => {
      pushUndo(JSON.parse(JSON.stringify(prev)));
      return fn(prev);
    });
  }, [pushUndo]);

  const copyClip = useCallback(() => {
    if (selectedClipIds.length === 0) return;
    const items = [];
    for (const t of tracks) {
      for (const c of t.clips) {
        if (selectedClipIds.includes(c.id)) {
          items.push({ clip: JSON.parse(JSON.stringify(c)), trackId: t.id });
        }
      }
    }
    if (items.length > 0) clipboardRef.current = { items, cut: false };
  }, [selectedClipIds, tracks]);

  const cutClip = useCallback(() => {
    if (selectedClipIds.length === 0) return;
    const items = [];
    for (const t of tracks) {
      for (const c of t.clips) {
        if (selectedClipIds.includes(c.id)) {
          items.push({ clip: JSON.parse(JSON.stringify(c)), trackId: t.id });
        }
      }
    }
    if (items.length === 0) return;
    clipboardRef.current = { items, cut: true };
    const idsToRemove = new Set(selectedClipIds);
    withUndo(prev => prev.map(tr => {
      const hadAny = tr.clips.some(cl => idsToRemove.has(cl.id));
      if (!hadAny) return tr;
      const remaining = tr.clips.filter(cl => !idsToRemove.has(cl.id));
      const sorted = [...remaining].sort((a, b) => a.startTime - b.startTime);
      let cursor = 0;
      return { ...tr, clips: sorted.map(cl => { const u = { ...cl, startTime: cursor }; cursor += u.duration; return u; }) };
    }));
    setSelectedClipIds([]);
  }, [selectedClipIds, tracks, withUndo]);

  const pasteClip = useCallback(() => {
    if (!clipboardRef.current || !clipboardRef.current.items) return;
    const { items } = clipboardRef.current;
    const newIds = [];
    withUndo(prev => {
      let result = prev;
      for (const { clip, trackId } of items) {
        const newClip = { ...clip, id: genClipId(), trackId };
        newIds.push(newClip.id);
        result = result.map(t => {
          if (t.id !== trackId) return t;
          const endTime = t.clips.reduce((m, c) => Math.max(m, c.startTime + c.duration), 0);
          newClip.startTime = endTime;
          return { ...t, clips: [...t.clips, newClip] };
        });
      }
      return result;
    });
    setSelectedClipIds(newIds);
  }, [withUndo]);

  const totalDuration = tracks.reduce((max, track) => {
    const trackEnd = track.clips.reduce((m, c) => Math.max(m, c.startTime + c.duration), 0);
    return Math.max(max, trackEnd);
  }, 0);

  const addClip = useCallback((media, trackId) => {
    const clip = createClip(media, trackId, 0, media?.duration);
    withUndo(prev => {
      const track = prev.find(t => t.id === trackId);
      const endTime = track ? track.clips.reduce((m, c) => Math.max(m, c.startTime + c.duration), 0) : 0;
      clip.startTime = endTime;
      return prev.map(t => t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t);
    });
    setSelectedClipIds([clip.id]);
  }, [withUndo]);

  const reflowTrack = useCallback((trackClips) => {
    const sorted = [...trackClips].sort((a, b) => a.startTime - b.startTime);
    let cursor = 0;
    return sorted.map(c => {
      const updated = { ...c, startTime: cursor };
      cursor += updated.duration;
      return updated;
    });
  }, []);

  const removeClip = useCallback((clipId) => {
    withUndo(prev => prev.map(t => {
      const hadClip = t.clips.some(c => c.id === clipId);
      const remaining = t.clips.filter(c => c.id !== clipId);
      if (!hadClip) return t;
      return { ...t, clips: reflowTrack(remaining) };
    }));
    setSelectedClipIds(prev => prev.includes(clipId) ? prev.filter(id => id !== clipId) : prev);
  }, [reflowTrack, withUndo]);

  const updateClip = useCallback((clipId, updates) => {
    withUndo(prev => prev.map(t => {
      const hasClip = t.clips.some(c => c.id === clipId);
      if (!hasClip) return t;
      const updated = t.clips.map(c => {
        if (c.id !== clipId) return c;
        const merged = { ...c, ...updates };
        const isUnlimited = merged.type === "image" || merged.type === "text";
        if (!isUnlimited && merged.duration != null) {
          const maxDur = (merged.originalDuration || c.originalDuration || c.duration) - (merged.trimStart || 0);
          merged.duration = Math.min(merged.duration, maxDur);
        }
        merged.duration = Math.max(0.2, merged.duration);
        return merged;
      });
      return { ...t, clips: reflowTrack(updated) };
    }));
  }, [reflowTrack, withUndo]);

  const moveClip = useCallback((clipId, newTrackId, newStartTime) => {
    let movedClip = null;
    withUndo(prev => {
      let clip = null;
      for (const t of prev) {
        clip = t.clips.find(c => c.id === clipId);
        if (clip) break;
      }
      if (!clip) return prev;
      movedClip = { ...clip, trackId: newTrackId, startTime: Math.max(0, newStartTime) };
      return prev.map(t => {
        let clips = t.clips.filter(c => c.id !== clipId);
        if (t.id === newTrackId) clips = [...clips, movedClip];
        return { ...t, clips };
      });
    });
    return movedClip;
  }, [withUndo]);

  const removeSelectedClips = useCallback(() => {
    if (selectedClipIds.length === 0) return;
    const ids = new Set(selectedClipIds);
    withUndo(prev => prev.map(t => {
      const hadAny = t.clips.some(c => ids.has(c.id));
      if (!hadAny) return t;
      return { ...t, clips: reflowTrack(t.clips.filter(c => !ids.has(c.id))) };
    }));
    setSelectedClipIds([]);
  }, [selectedClipIds, reflowTrack, withUndo]);

  const multiDragSnapshotRef = useRef(null);

  const beginMultiDrag = useCallback(() => {
    if (selectedClipIds.length <= 1) return;
    const snapshot = [];
    for (const t of tracks) {
      for (const c of t.clips) {
        if (selectedClipIds.includes(c.id)) {
          snapshot.push({ id: c.id, origStart: c.startTime, origTrackId: t.id, origTrackIdx: tracks.findIndex(tr => tr.id === t.id) });
        }
      }
    }
    multiDragSnapshotRef.current = { snapshot, undoPushed: false };
  }, [selectedClipIds, tracks]);

  const updateMultiDrag = useCallback((deltaTime, deltaTrackShift) => {
    const snap = multiDragSnapshotRef.current;
    if (!snap || snap.snapshot.length === 0) return;
    if (!snap.undoPushed) {
      pushUndo(JSON.parse(JSON.stringify(tracks)));
      snap.undoPushed = true;
    }
    setTracks(prev => {
      const idsToMove = new Set(snap.snapshot.map(s => s.id));
      let result = prev.map(t => ({ ...t, clips: t.clips.filter(c => !idsToMove.has(c.id)) }));
      for (const s of snap.snapshot) {
        const newStart = Math.max(0, Math.round((s.origStart + deltaTime) * 100) / 100);
        let newIdx = Math.max(0, Math.min(result.length - 1, s.origTrackIdx + deltaTrackShift));
        if (result[newIdx].type !== prev[s.origTrackIdx].type) newIdx = s.origTrackIdx;
        const origClip = prev.flatMap(t => t.clips).find(c => c.id === s.id);
        if (!origClip) continue;
        const placed = { ...origClip, startTime: newStart, trackId: result[newIdx].id };
        result = result.map((t, i) => i === newIdx ? { ...t, clips: [...t.clips, placed] } : t);
      }
      return result;
    });
  }, [tracks, pushUndo]);

  const endMultiDrag = useCallback(() => {
    multiDragSnapshotRef.current = null;
  }, []);

  const splitClip = useCallback((clipId, splitTime) => {
    withUndo(prev => prev.map(t => {
      const idx = t.clips.findIndex(c => c.id === clipId);
      if (idx === -1) return t;
      const clip = t.clips[idx];
      const relativeTime = splitTime - clip.startTime;
      if (relativeTime <= 0.1 || relativeTime >= clip.duration - 0.1) return t;

      const clip1 = { ...clip, duration: relativeTime, id: clip.id };
      const clip2 = {
        ...clip,
        id: genClipId(),
        startTime: splitTime,
        duration: clip.duration - relativeTime,
        trimStart: clip.trimStart + relativeTime,
      };

      const newClips = [...t.clips];
      newClips.splice(idx, 1, clip1, clip2);
      return { ...t, clips: newClips };
    }));
  }, [withUndo]);

  const getSnapPoints = useCallback((excludeClipId) => {
    const points = [0];
    tracks.forEach(t => {
      t.clips.forEach(c => {
        if (c.id === excludeClipId) return;
        points.push(c.startTime, c.startTime + c.duration);
      });
    });
    return [...new Set(points)].sort((a, b) => a - b);
  }, [tracks]);

  const snapTime = useCallback((time, excludeClipId, pxPerSec) => {
    const points = getSnapPoints(excludeClipId);
    const thresholdSec = SNAP_THRESHOLD_PX / (pxPerSec || 100);
    let closest = time;
    let minDist = thresholdSec;
    for (const p of points) {
      const d = Math.abs(time - p);
      if (d < minDist) { minDist = d; closest = p; }
    }
    return closest;
  }, [getSnapPoints]);

  const play = useCallback(() => {
    if (isPlaying) return;
    setIsPlaying(true);
    lastFrameRef.current = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = (now - lastFrameRef.current) / 1000;
      lastFrameRef.current = now;
      setPlayheadTime(prev => {
        const next = prev + dt * playbackSpeed;
        if (next >= totalDuration && totalDuration > 0) {
          setIsPlaying(false);
          return totalDuration;
        }
        return next;
      });
      playTimerRef.current = requestAnimationFrame(tick);
    };
    playTimerRef.current = requestAnimationFrame(tick);
  }, [isPlaying, playbackSpeed, totalDuration]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    if (playTimerRef.current) cancelAnimationFrame(playTimerRef.current);
  }, []);

  const stop = useCallback(() => {
    pause();
    setPlayheadTime(0);
  }, [pause]);

  const seekTo = useCallback((t) => {
    setPlayheadTime(Math.max(0, t));
  }, []);

  const stepFrame = useCallback((dir) => {
    setPlayheadTime(prev => Math.max(0, prev + (dir / projectFps)));
  }, [projectFps]);

  useEffect(() => {
    return () => {
      if (playTimerRef.current) cancelAnimationFrame(playTimerRef.current);
    };
  }, []);

  const selectedClipId = selectedClipIds.length === 1 ? selectedClipIds[0] : null;

  const getSelectedClip = useCallback(() => {
    if (selectedClipIds.length !== 1) return null;
    for (const t of tracks) {
      const clip = t.clips.find(c => c.id === selectedClipIds[0]);
      if (clip) return clip;
    }
    return null;
  }, [tracks, selectedClipIds]);

  const getClipsAtTime = useCallback((time) => {
    const result = [];
    tracks.forEach(t => {
      t.clips.forEach(c => {
        if (time >= c.startTime && time < c.startTime + c.duration) {
          result.push({ ...c, track: t });
        }
      });
    });
    return result;
  }, [tracks]);

  const toggleTrackMute = useCallback((trackId) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, muted: !t.muted } : t));
  }, []);

  const toggleTrackLock = useCallback((trackId) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, locked: !t.locked } : t));
  }, []);

  const getState = useCallback(() => ({
    tracks, playheadTime, zoom, scrollX,
    projectFps, projectResolution,
    playbackSpeed, selectedClipIds,
  }), [tracks, playheadTime, zoom, scrollX, projectFps, projectResolution, playbackSpeed, selectedClipIds]);

  const restoreState = useCallback((state) => {
    if (state.tracks) setTracks(JSON.parse(JSON.stringify(state.tracks)));
    else setTracks(createDefaultTracks());
    setPlayheadTime(state.playheadTime || 0);
    setZoom(state.zoom ?? 0.8);
    setScrollX(state.scrollX || 0);
    setProjectFps(state.projectFps || 30);
    setProjectResolution(state.projectResolution || { width: 1920, height: 1080 });
    setPlaybackSpeed(state.playbackSpeed || 1);
    setSelectedClipIds(state.selectedClipIds || (state.selectedClipId ? [state.selectedClipId] : []));
    setIsPlaying(false);
    if (playTimerRef.current) cancelAnimationFrame(playTimerRef.current);
    undoStackRef.current = [];
    redoStackRef.current = [];
    clipboardRef.current = null;
    setHistoryTick(v => v + 1);
  }, []);

  const resetTimeline = useCallback(() => {
    setTracks(createDefaultTracks());
    setPlayheadTime(0);
    setZoom(0.8);
    setScrollX(0);
    setSelectedClipIds([]);
    setIsPlaying(false);
    setPlaybackSpeed(1);
    if (playTimerRef.current) cancelAnimationFrame(playTimerRef.current);
    undoStackRef.current = [];
    redoStackRef.current = [];
    clipboardRef.current = null;
    setHistoryTick(v => v + 1);
  }, []);

  return {
    tracks, setTracks,
    playheadTime, setPlayheadTime: seekTo,
    isPlaying,
    zoom, setZoom,
    scrollX, setScrollX,
    selectedClipId, selectedClipIds,
    selectClip, toggleSelectClip,
    playbackSpeed, setPlaybackSpeed,
    projectFps, setProjectFps,
    projectResolution, setProjectResolution,
    totalDuration,
    addClip, removeClip, removeSelectedClips, updateClip, moveClip, splitClip,
    beginMultiDrag, updateMultiDrag, endMultiDrag,
    snapTime, getSnapPoints,
    play, pause, stop, seekTo, stepFrame,
    getSelectedClip, getClipsAtTime,
    toggleTrackMute, toggleTrackLock,
    undo, redo, canUndo, canRedo,
    copyClip, cutClip, pasteClip,
    getState, restoreState, resetTimeline,
    TRACK_TYPES,
  };
}
