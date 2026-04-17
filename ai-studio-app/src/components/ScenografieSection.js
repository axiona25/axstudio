/**
 * Scenografie — hub Progetti → Capitoli → editor Capitolo.
 */

import React, { useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import ScenografieProjectHub from "./ScenografieProjectHub.js";
import ScenografieChapterHub from "./ScenografieChapterHub.js";
import { ScenografieProjectEditor } from "./ScenografieProjectEditor.js";
import {
  loadScenografiaProjectById,
  ensureWorkspace,
  summarizeScenografiaWorkspaceForIndex,
  upsertScenografiaProjectInIndex,
} from "../services/scenografieProjectPersistence.js";

export default function ScenografieSection({
  scenografieNavRef,
  /** @type {{ workspaceId: string, chapterId?: string, deepLink?: { focus?: string, sceneId?: string, clipId?: string } } | null} */
  scenografieBootstrap = null,
  onConsumedScenografieBootstrap,
  onEditorOpenChange,
  onHeaderTitleChange,
  onHeaderActionsChange,
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
  const [editorRecoveryDeepLink, setEditorRecoveryDeepLink] = useState(null);
  const routeRef = useRef(route);
  routeRef.current = route;

  /** Volo scene pipeline ancora in corso dopo navigazione via dall'editor (stesso workspace + capitolo). */
  const [scenePipelineFlight, setScenePipelineFlight] = useState(null);
  /** Ref condiviso: sopravvive allo smontaggio dell'editor così il loop async e «Interrompi» restano allineati. */
  const sharedPipelineAbortRef = useRef(false);

  /** Prima del paint: la topbar deve mostrare il «←» appena si esce dall'hub (non dopo un frame in ritardo). */
  useLayoutEffect(() => {
    onEditorOpenChange?.(route.type !== "hub");
  }, [route.type, onEditorOpenChange]);

  /** Prima del paint: il «←» app deve sempre chiamare tryBackToHub reale (routeRef aggiornato al click). */
  useLayoutEffect(() => {
    if (!scenografieNavRef?.current) return;
    scenografieNavRef.current.tryBackToHub = () => {
      const r = routeRef.current;
      if (r.type === "chapter") {
        setRoute({ type: "workspace", workspaceId: r.workspaceId, projectNumber: r.projectNumber ?? 1 });
        return true;
      }
      if (r.type === "workspace") {
        setRoute({ type: "hub" });
        return true;
      }
      return false;
    };
  }, [scenografieNavRef]);

  useEffect(() => {
    if (route.type !== "chapter") onHeaderActionsChange?.(null);
  }, [route.type, onHeaderActionsChange]);

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
    if (route.type !== "workspace" && route.type !== "chapter") return undefined;
    const id = route.workspaceId;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const raw = await loadScenografiaProjectById(id);
          if (cancelled) return;
          await upsertScenografiaProjectInIndex(id, raw);
        } catch {
          /* ignore */
        }
      })();
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [route.type, route.workspaceId]);

  useEffect(() => {
    if (!scenografieBootstrap?.workspaceId) return;
    const workspaceId = String(scenografieBootstrap.workspaceId).trim();
    if (!workspaceId) return;
    const bootChapterId = scenografieBootstrap.chapterId ? String(scenografieBootstrap.chapterId).trim() : "";
    const deepLink =
      scenografieBootstrap.deepLink && typeof scenografieBootstrap.deepLink === "object"
        ? scenografieBootstrap.deepLink
        : null;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await loadScenografiaProjectById(workspaceId);
        if (cancelled) return;
        const ws = ensureWorkspace(raw);
        const chapters = [...(ws?.chapters || [])].sort(
          (a, b) => (a.sortOrder - b.sortOrder) || String(a.id).localeCompare(String(b.id)),
        );
        let ch = bootChapterId ? chapters.find((c) => c.id === bootChapterId) : null;
        if (!ch && chapters[0]) ch = chapters[0];
        if (ch) {
          const ord = Math.max(1, chapters.indexOf(ch) + 1);
          setRoute({ type: "chapter", workspaceId, chapterId: ch.id, chapterOrdinal: ord, projectNumber: 1 });
        } else {
          setRoute({ type: "workspace", workspaceId, projectNumber: 1 });
        }
        setEditorRecoveryDeepLink(deepLink);
      } catch {
        if (!cancelled) {
          setRoute({ type: "workspace", workspaceId, projectNumber: 1 });
          setEditorRecoveryDeepLink(deepLink);
        }
      } finally {
        if (!cancelled) onConsumedScenografieBootstrap?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scenografieBootstrap, onConsumedScenografieBootstrap]);

  useEffect(() => {
    if (!scenografieNavRef) return undefined;
    return () => {
      if (scenografieNavRef?.current) {
        scenografieNavRef.current.tryBackToHub = () => false;
      }
    };
  }, [scenografieNavRef]);

  const openWorkspace = useCallback((workspaceId, projectNumber) => {
    setRoute({ type: "workspace", workspaceId, projectNumber: projectNumber || 1 });
  }, []);

  const openChapter = useCallback((chapterId, chapterOrdinal, deepLink) => {
    const r = routeRef.current;
    if (r.type !== "workspace") return;
    if (deepLink && typeof deepLink === "object" && Object.keys(deepLink).length > 0) {
      setEditorRecoveryDeepLink(deepLink);
    } else {
      setEditorRecoveryDeepLink(null);
    }
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
      sharedPipelineAbortRef={sharedPipelineAbortRef}
      scenePipelineFlight={scenePipelineFlight}
      setScenePipelineFlight={setScenePipelineFlight}
      initialRecoveryDeepLink={editorRecoveryDeepLink}
      onConsumedRecoveryDeepLink={() => setEditorRecoveryDeepLink(null)}
      onScenografieHeaderActionsChange={onHeaderActionsChange}
    />
  );
}
