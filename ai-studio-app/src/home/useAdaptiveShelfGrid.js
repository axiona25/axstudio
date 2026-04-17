import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { computeShelfGridMetrics } from "./shelfGridMetrics.js";

/**
 * Misura lo scrollport della shelf e calcola altezza/larghezza cella in modo deterministico.
 * @param {{ columns: number, visibleRows: number, gap: number }} layout
 */
export function useAdaptiveShelfGrid(layout) {
  const hostRef = useRef(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });

  const measure = useCallback(() => {
    const el = hostRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    setDims((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
  }, []);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const metrics = useMemo(() => {
    if (dims.width <= 1 || dims.height <= 1) return null;
    return computeShelfGridMetrics(dims.width, dims.height, layout);
  }, [dims.width, dims.height, layout]);

  return { hostRef, metrics, remeasure: measure, viewportClientSize: dims };
}
