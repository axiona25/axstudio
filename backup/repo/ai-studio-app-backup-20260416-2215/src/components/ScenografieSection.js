/**
 * Scenografie — hub Progetti → Capitoli → editor Capitolo.
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import ScenografieProjectHub from "./ScenografieProjectHub.js";
import ScenografieChapterHub from "./ScenografieChapterHub.js";
import { ScenografieProjectEditor } from "./ScenografieProjectEditor.js";
import {
  loadScenografiaProjectById,
  ensureWorkspace,
  summarizeScenografiaWorkspaceForIndex,
} from "../services/scenografieProjectPersistence.js";

export default function ScenografieSection({
  scenografieNavRef,
  onEditorOpenChange,
  onHeaderTitleChange,
  onSave,
  onGoToVideoProduction,
  generatedImages,
  setGeneratedImages,
  imageStatus,
  setImageStatus,
  imageProgress,
  setImageProgress,
  imageStylePresets = [],
}) {
  /** @type {{ type: 'hub' } | { type: 'workspace', workspaceId: string, projectNumber: number } | { type: 'chapter', workspaceId: string, chapterId: string, chapterOrdinal: number, projectNumber: number }} */
  const [route, setRoute] = useState({ type: "hub" });
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    onEditorOpenChange?.(route.type !== "hub");
    return () => onEditorOpenChange?.(false);
  }, [route.type, onEditorOpenChange]);

  useEffect(() => {
    if (!onHeaderTitleChange) return undefined;
    if (route.type === "hub") {
      onHeaderTitleChange(null);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const raw = await loadScenografiaProjectById(route.workspaceId);
        if (cancelled) return;
        const ws = ensureWorkspace(raw);
        const title = ws ? summarizeScenografiaWorkspaceForIndex(ws).displayTitle : "Senza titolo";
        onHeaderTitleChange(title);
      } catch {
        if (!cancelled) onHeaderTitleChange("Progetto");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route.type, route.workspaceId, onHeaderTitleChange]);

  useEffect(() => {
    if (!scenografieNavRef) return undefined;
    scenografieNavRef.current.tryBackToHub = () => {
      const r = routeRef.current;
      if (r.type === "chapter") {
        setRoute({ type: "workspace", workspaceId: r.workspaceId, projectNumber: r.projectNumber });
        return true;
      }
      if (r.type === "workspace") {
        setRoute({ type: "hub" });
        return true;
      }
      return false;
    };
    return () => {
      if (scenografieNavRef?.current) {
        scenografieNavRef.current.tryBackToHub = () => false;
      }
    };
  }, [scenografieNavRef]);

  const openWorkspace = useCallback((workspaceId, projectNumber) => {
    setRoute({ type: "workspace", workspaceId, projectNumber: projectNumber || 1 });
  }, []);

  const openChapter = useCallback((chapterId, chapterOrdinal) => {
    const r = routeRef.current;
    if (r.type !== "workspace") return;
    setRoute({
      type: "chapter",
      workspaceId: r.workspaceId,
      chapterId,
      chapterOrdinal: chapterOrdinal || 1,
      projectNumber: r.projectNumber,
    });
  }, []);

  const backToHub = useCallback(() => {
    setRoute({ type: "hub" });
  }, []);

  const backToChapters = useCallback(() => {
    const r = routeRef.current;
    if (r.type === "chapter") {
      setRoute({ type: "workspace", workspaceId: r.workspaceId, projectNumber: r.projectNumber });
    }
  }, []);

  if (route.type === "hub") {
    return <ScenografieProjectHub onOpenWorkspace={openWorkspace} imageStylePresets={imageStylePresets} />;
  }

  if (route.type === "workspace") {
    return (
      <ScenografieChapterHub workspaceId={route.workspaceId} onOpenChapter={openChapter} />
    );
  }

  return (
    <ScenografieProjectEditor
      key={`${route.workspaceId}-${route.chapterId}`}
      projectId={route.workspaceId}
      projectNumber={route.projectNumber}
      chapterId={route.chapterId}
      chapterOrdinal={route.chapterOrdinal}
      onBack={backToChapters}
      onGoToVideoProduction={onGoToVideoProduction}
      onSave={onSave}
      generatedImages={generatedImages}
      setGeneratedImages={setGeneratedImages}
      imageStatus={imageStatus}
      setImageStatus={setImageStatus}
      imageProgress={imageProgress}
      setImageProgress={setImageProgress}
      imageStylePresets={imageStylePresets}
    />
  );
}
