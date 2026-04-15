/**
 * Scenografie — hub griglia progetti + editor dettaglio singolo progetto.
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import ScenografieProjectHub from "./ScenografieProjectHub.js";
import { ScenografieProjectEditor } from "./ScenografieProjectEditor.js";

export default function ScenografieSection({
  scenografieNavRef,
  onEditorOpenChange,
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
  const [route, setRoute] = useState({ type: "hub" });
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    onEditorOpenChange?.(route.type === "editor");
    return () => onEditorOpenChange?.(false);
  }, [route.type, onEditorOpenChange]);

  useEffect(() => {
    if (!scenografieNavRef) return undefined;
    scenografieNavRef.current.tryBackToHub = () => {
      if (routeRef.current.type === "editor") {
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

  const openProject = useCallback((id, projectNumber) => {
    setRoute({ type: "editor", id, projectNumber: projectNumber || 1 });
  }, []);

  const backToHub = useCallback(() => {
    setRoute({ type: "hub" });
  }, []);

  if (route.type === "hub") {
    return <ScenografieProjectHub onOpenProject={openProject} />;
  }

  return (
    <ScenografieProjectEditor
      projectId={route.id}
      projectNumber={route.projectNumber}
      onBack={backToHub}
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
