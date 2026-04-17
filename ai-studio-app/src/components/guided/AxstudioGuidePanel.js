/**
 * Pannello «AXSTUDIO ti guida» — action-driven, payload azioni serializzabile.
 */

import React from "react";
import { HiSparkles, HiChevronDown, HiChevronUp } from "react-icons/hi2";
import { buildAxstudioGuideContent } from "../../services/axstudioCopilotHeuristics.js";
import { WIZARD_STEP_DEFS } from "../../guided/axstudioWizardModel.js";

const DEFAULT_AX = {
  border: "#23232e",
  surface: "#13131a",
  card: "#1a1a24",
  text: "#f4f4f8",
  text2: "#a1a1b5",
  muted: "#6b6b80",
  electric: "#29b6ff",
  violet: "#7b4dff",
  gradPrimary: "linear-gradient(135deg, #29b6ff 0%, #7b4dff 100%)",
  danger: "#f87171",
};

function toneAccent(ax, statusTone) {
  switch (statusTone) {
    case "success":
      return "#4ade80";
    case "warning":
      return "#fbbf24";
    case "danger":
      return ax.danger;
    default:
      return ax.electric;
  }
}

function sectionTitle(ax, color, text) {
  return (
    <div style={{ fontSize: 10, fontWeight: 800, color, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
      {text}
    </div>
  );
}

function advancedModeAside(ax) {
  return (
    <aside
      style={{
        flex: "1 1 280px",
        width: 280,
        maxWidth: "100%",
        position: "sticky",
        top: 12,
        alignSelf: "flex-start",
        padding: 14,
        borderRadius: 14,
        border: `1px dashed ${ax.border}`,
        background: "rgba(19,19,26,0.5)",
        fontSize: 12,
        color: ax.muted,
        lineHeight: 1.5,
      }}
    >
      <strong style={{ color: ax.text2 }}>Modalità avanzata</strong>
      <p style={{ margin: "8px 0 0" }}>
        Riattiva «Modalità guidata» nella barra step per scelte applicabili, preset e assistente AXSTUDIO.
      </p>
    </aside>
  );
}

/**
 * Corpo guida (senza wrapper layout) — usato dalla modale copilota.
 * @param {{
 *   ax?: typeof DEFAULT_AX,
 *   stepId: string,
 *   snapshot: Record<string, unknown>,
 *   model: import("../../services/axstudioCopilotHeuristics.js").AxstudioCopilotGuideModel,
 *   guidedMode: boolean,
 *   onGuideAction: (action: Record<string, unknown>) => void,
 *   advancedExpanded: boolean,
 *   onToggleAdvanced: () => void,
 * }} props
 */
export function AxstudioGuideBody({
  ax: axProp,
  stepId,
  snapshot,
  model,
  guidedMode,
  onGuideAction,
  advancedExpanded,
  onToggleAdvanced,
}) {
  const ax = axProp || DEFAULT_AX;
  const accent = toneAccent(ax, model.statusTone);

  if (!guidedMode) {
    return (
      <div
        style={{
          padding: 14,
          borderRadius: 12,
          border: `1px dashed ${ax.border}`,
          background: "rgba(19,19,26,0.4)",
          fontSize: 12,
          color: ax.muted,
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: ax.text2 }}>Modalità avanzata</strong>
        <p style={{ margin: "8px 0 0" }}>
          Riattiva «Modalità guidata» nella barra step per scelte applicabili, preset e assistente AXSTUDIO.
        </p>
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          padding: "12px 14px",
          borderBottom: `1px solid ${ax.border}`,
          background: `linear-gradient(90deg, ${accent}22, transparent)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <HiSparkles size={20} style={{ color: accent }} aria-hidden />
          <div style={{ fontSize: 13, fontWeight: 800, color: ax.text, letterSpacing: "-0.02em" }}>{model.title}</div>
        </div>
      </div>

      <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
        <section>
          {sectionTitle(ax, ax.violet, "Cosa fare adesso")}
          <p style={{ margin: 0, fontSize: 13, color: ax.text, lineHeight: 1.5 }}>{model.primaryMessage}</p>
        </section>

        {model.suggestedChoices.length > 0 ? (
          <section>
            {sectionTitle(ax, ax.electric, "Scelte consigliate")}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {model.suggestedChoices.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  disabled={!!ch.disabled}
                  onClick={() => onGuideAction(ch.action)}
                  title={ch.description}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: `1px solid ${ax.border}`,
                    background: ch.disabled ? "rgba(19,19,26,0.5)" : ax.surface,
                    cursor: ch.disabled ? "not-allowed" : "pointer",
                    opacity: ch.disabled ? 0.5 : 1,
                    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!ch.disabled) {
                      e.currentTarget.style.borderColor = `${ax.electric}66`;
                      e.currentTarget.style.boxShadow = `0 0 20px -8px ${ax.electric}`;
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = ax.border;
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 800, color: ax.text, marginBottom: 4, letterSpacing: "-0.02em" }}>
                    {ch.label}
                  </div>
                  <div style={{ fontSize: 11, color: ax.text2, lineHeight: 1.45 }}>{ch.description}</div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: ax.muted, marginTop: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {ch.kind}
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {model.quickActions.length > 0 ? (
          <section>
            {sectionTitle(ax, ax.muted, "Azioni rapide")}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {model.quickActions.map((a) => {
                const v = a.variant || "secondary";
                const primary = v === "primary";
                const danger = v === "danger";
                const ghost = v === "ghost";
                return (
                  <button
                    key={a.id}
                    type="button"
                    disabled={!!a.disabled}
                    onClick={() => onGuideAction(a.action)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: primary || danger ? "none" : `1px solid ${ax.border}`,
                      background: primary ? ax.gradPrimary : danger ? "rgba(248,113,113,0.25)" : ghost ? "transparent" : ax.surface,
                      color: primary ? "#fff" : danger ? ax.danger : ax.text2,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: a.disabled ? "not-allowed" : "pointer",
                      opacity: a.disabled ? 0.45 : 1,
                    }}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {model.whyItMatters ? (
          <section>
            {sectionTitle(ax, ax.muted, "Perché conta")}
            <p style={{ margin: 0, fontSize: 12, color: ax.muted, lineHeight: 1.55 }}>{model.whyItMatters}</p>
          </section>
        ) : null}

        {model.warnings.length > 0 ? (
          <section>
            {sectionTitle(ax, "#fbbf24", "Attenzioni")}
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#fbbf24", lineHeight: 1.5 }}>
              {model.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <button
          type="button"
          onClick={onToggleAdvanced}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            width: "100%",
            padding: "8px 10px",
            borderRadius: 10,
            border: `1px solid ${ax.border}`,
            background: "transparent",
            color: ax.muted,
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {advancedExpanded ? <HiChevronUp size={16} /> : <HiChevronDown size={16} />}
          Dettagli avanzati
        </button>

        {advancedExpanded ? (
          <pre
            style={{
              margin: 0,
              padding: 10,
              borderRadius: 10,
              border: `1px solid ${ax.border}`,
              background: "#0a0a0f",
              color: ax.muted,
              fontSize: 10,
              lineHeight: 1.45,
              overflow: "auto",
              maxHeight: 220,
            }}
          >
            {JSON.stringify(
              {
                ...model.advancedDetails,
                stepId,
                anchor: WIZARD_STEP_DEFS.find((d) => d.id === stepId)?.anchor,
                snapshot,
              },
              null,
              2,
            )}
          </pre>
        ) : null}
      </div>
    </>
  );
}

/**
 * @param {{
 *   ax?: typeof DEFAULT_AX,
 *   stepId: string,
 *   snapshot: Record<string, unknown>,
 *   guidedMode: boolean,
 *   onGuideAction: (action: Record<string, unknown>) => void,
 *   advancedExpanded: boolean,
 *   onToggleAdvanced: () => void,
 * }} props
 */
export function AxstudioGuidePanel({
  ax: axProp,
  stepId,
  snapshot,
  guidedMode,
  onGuideAction,
  advancedExpanded,
  onToggleAdvanced,
}) {
  const ax = axProp || DEFAULT_AX;
  const model = buildAxstudioGuideContent(stepId, snapshot);
  const accent = toneAccent(ax, model.statusTone);

  if (!guidedMode) {
    return advancedModeAside(ax);
  }

  return (
    <aside
      style={{
        flex: "1 1 300px",
        width: 300,
        maxWidth: "100%",
        position: "sticky",
        top: 12,
        alignSelf: "flex-start",
        borderRadius: 16,
        border: `1px solid ${ax.border}`,
        borderTop: `2px solid ${accent}`,
        background: `linear-gradient(160deg, ${ax.surface} 0%, ${ax.card} 55%, #0f0f16 100%)`,
        boxShadow: "0 24px 56px rgba(0,0,0,0.45)",
        overflow: "hidden",
      }}
    >
      <AxstudioGuideBody
        ax={ax}
        stepId={stepId}
        snapshot={snapshot}
        model={model}
        guidedMode={guidedMode}
        onGuideAction={onGuideAction}
        advancedExpanded={advancedExpanded}
        onToggleAdvanced={onToggleAdvanced}
      />
    </aside>
  );
}

/** @deprecated usare onGuideAction con payload { type: 'scroll_to_anchor', anchorId } */
export function resolveLegacyActionToAnchor(actionType) {
  switch (actionType) {
    case "focus_prompt":
      return "ax-wizard-concept";
    case "scroll_narrative":
      return "ax-wizard-narrative";
    case "scroll_characters":
      return "ax-wizard-characters";
    case "scroll_audio":
      return "ax-scenografie-anchor-narrators";
    case "scroll_scenes":
    case "scroll_scenes_list":
      return "ax-scenografie-anchor-scenes";
    case "scroll_clips":
      return "ax-scenografie-anchor-clips";
    case "scroll_timeline":
      return "ax-scenografie-anchor-timeline";
    case "scroll_montage":
      return "ax-scenografie-anchor-montage";
    case "scroll_final_actions":
      return "ax-scenografie-anchor-final-actions";
    default:
      return null;
  }
}
