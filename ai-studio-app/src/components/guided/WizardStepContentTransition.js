/**
 * Contenitore animato per il corpo del wizard: al cambio step riavvia una keyframe CSS
 * senza remount dei figli (stato React / DOM interno preservato dove possibile).
 */

import React, { useLayoutEffect, useRef } from "react";

/**
 * @param {{ stepId: string, children: React.ReactNode }} props
 */
export function WizardStepContentTransition({ stepId, children }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove("ax-wizard-step-page-animating");
    void el.getBoundingClientRect();
    el.classList.add("ax-wizard-step-page-animating");
  }, [stepId]);

  return (
    <div ref={ref} className="ax-wizard-step-page-transition-root" style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}>
      {children}
    </div>
  );
}
