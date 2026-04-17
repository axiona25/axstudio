/**
 * Sezione Narratori di progetto — card dedicate, distinte dai personaggi scena.
 */

import React, { useCallback, useMemo, useState } from "react";
import { HiMicrophone, HiPlus, HiTrash, HiStar, HiChevronDown, HiChevronUp } from "react-icons/hi2";
import {
  newProjectNarratorId,
  normalizeProjectNarrator,
  normalizeProjectNarratorsList,
  ensureProjectNarratorDefaultFlags,
  mergeNarratorVoiceAssignment,
} from "../services/scenografieProjectNarrators.js";
import { normalizeCharacterVoiceMaster } from "../services/scenografieVideoWorkflow.js";
import { ScenografieCharacterVoicePicker } from "./ScenografieCharacterVoicePicker.js";

const CLIP_EMBEDDED = "__clip_embedded_voice__";
const PROJECT_DEFAULT = "__project_default__";

export { CLIP_EMBEDDED, PROJECT_DEFAULT };

export function narratedClipNarratorControlValue(clip) {
  const id = clip?.narratorId != null ? String(clip.narratorId).trim() : "";
  if (id) return id;
  const v = clip?.narratorVoice;
  const vid = v && typeof v === "object" ? String(v.voiceId || "").trim() : "";
  if (vid) return CLIP_EMBEDDED;
  return PROJECT_DEFAULT;
}

/**
 * @param {object} props
 * @param {object} props.ax
 * @param {object[]} props.narrators
 * @param {(next: object[]) => void} props.onChangeNarrators
 * @param {boolean} [props.disabled]
 */
export function ScenografieNarratorSection({ ax, narrators, onChangeNarrators, disabled = false }) {
  const list = useMemo(() => ensureProjectNarratorDefaultFlags(normalizeProjectNarratorsList(narrators)), [narrators]);
  const [voiceOpenId, setVoiceOpenId] = useState(null);

  const setList = useCallback(
    (updater) => {
      const next = typeof updater === "function" ? updater(list) : updater;
      onChangeNarrators(ensureProjectNarratorDefaultFlags(normalizeProjectNarratorsList(next)));
    },
    [list, onChangeNarrators],
  );

  const addNarrator = useCallback(() => {
    const now = new Date().toISOString();
    const n = normalizeProjectNarrator({
      id: newProjectNarratorId(),
      name: `Narratore ${list.length + 1}`,
      roleType: "narrator",
      placeholderType: "narrator_glyph",
      voiceId: "",
      voiceLabel: "",
      voiceSourceType: "",
      voicePreviewUrl: "",
      voiceAssignedAt: null,
      voiceCatalogSnapshot: null,
      voiceAssignmentHistory: [],
      isDefaultNarrator: list.length === 0,
      createdAt: now,
      updatedAt: now,
    });
    setList([...list, n]);
  }, [list, setList]);

  const removeNarrator = useCallback(
    (id) => {
      const rest = list.filter((x) => x.id !== id);
      setList(rest.length ? ensureProjectNarratorDefaultFlags(rest) : []);
    },
    [list, setList],
  );

  const patchNarrator = useCallback(
    (id, partial) => {
      setList(
        list.map((n) => {
          if (n.id !== id) return n;
          const isVoice =
            partial.voiceId != null ||
            partial.voiceLabel != null ||
            partial.voiceSourceType != null ||
            partial.voicePreviewUrl != null ||
            partial.voiceCatalogSnapshot != null ||
            partial.voiceAssignedAt != null;
          if (isVoice) return mergeNarratorVoiceAssignment(n, partial);
          return normalizeProjectNarrator({ ...n, ...partial, updatedAt: new Date().toISOString() });
        }),
      );
    },
    [list, setList],
  );

  const setDefault = useCallback(
    (id) => {
      setList(
        list.map((n) => ({
          ...n,
          isDefaultNarrator: n.id === id,
          updatedAt: new Date().toISOString(),
        })),
      );
    },
    [list, setList],
  );

  const renameNarrator = useCallback(
    (id, name) => {
      patchNarrator(id, { name: String(name || "").trim() || "Narratore" });
    },
    [patchNarrator],
  );

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <button
          type="button"
          onClick={addNarrator}
          disabled={disabled}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "9px 14px",
            borderRadius: 10,
            border: "none",
            background: ax.gradPrimary,
            color: "#fff",
            fontWeight: 700,
            fontSize: 12,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
            boxShadow: "0 6px 18px rgba(41,182,255,0.22)",
          }}
        >
          <HiPlus size={16} /> Aggiungi narratore
        </button>
        <p style={{ margin: 0, fontSize: 11, color: ax.muted, maxWidth: 420, lineHeight: 1.45 }}>
          I narratori sono entità di progetto distinte dal cast scenico: stessa qualità di scelta voce ElevenLabs, senza
          master volto.
        </p>
      </div>
      {list.length === 0 ? (
        <div
          style={{
            padding: "16px 18px",
            borderRadius: 14,
            border: `1px dashed ${ax.border}`,
            background: ax.surface || ax.bg,
            fontSize: 12,
            color: ax.text2,
            lineHeight: 1.5,
          }}
        >
          Nessun narratore definito. Aggiungine uno per usare voci ElevenLabs strutturate nei clip narrati; finché la
          lista è vuota, i clip possono ancora usare la voce salvata sul singolo clip (compatibilità progetti precedenti).
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 16,
          }}
        >
          {list.map((n) => {
            const open = voiceOpenId === n.id;
            const vm = normalizeCharacterVoiceMaster(
              {
                characterId: n.id,
                voiceId: n.voiceId,
                elevenLabsVoiceId: n.voiceId,
                voiceLabel: n.voiceLabel,
                voiceProvider: "elevenlabs",
                voiceSourceType: n.voiceSourceType,
                voicePreviewUrl: n.voicePreviewUrl,
                voiceAssignedAt: n.voiceAssignedAt,
                voiceCatalogSnapshot: n.voiceCatalogSnapshot,
                voiceAssignmentHistory: n.voiceAssignmentHistory,
                isNarratorDefault: false,
                elevenLabs: {},
              },
              n.id,
            );
            return (
              <div
                key={n.id}
                style={{
                  borderRadius: 16,
                  border: `1px solid ${n.isDefaultNarrator ? "rgba(52,211,153,0.45)" : ax.border}`,
                  background: ax.surface || ax.bg,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  boxShadow: n.isDefaultNarrator ? "0 8px 28px rgba(16,185,129,0.12)" : "none",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: 14,
                    borderBottom: `1px solid ${ax.border}`,
                    alignItems: "flex-start",
                  }}
                >
                  <div
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 14,
                      flexShrink: 0,
                      background: "linear-gradient(145deg, rgba(41,182,255,0.25), rgba(129,140,248,0.35))",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#e0e7ff",
                    }}
                    aria-hidden
                  >
                    <HiMicrophone size={32} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: ax.violet || "#a78bfa", letterSpacing: "0.08em" }}>
                      NARRATORE
                    </div>
                    <input
                      type="text"
                      value={n.name}
                      disabled={disabled}
                      onChange={(e) => renameNarrator(n.id, e.target.value)}
                      style={{
                        width: "100%",
                        marginTop: 6,
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: `1px solid ${ax.border}`,
                        background: ax.bg,
                        color: ax.text,
                        fontSize: 14,
                        fontWeight: 700,
                        boxSizing: "border-box",
                      }}
                    />
                    {n.isDefaultNarrator ? (
                      <div
                        style={{
                          marginTop: 8,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 10,
                          fontWeight: 800,
                          color: "#34d399",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        <HiStar size={14} /> Predefinito per clip narrati
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => setDefault(n.id)}
                        style={{
                          marginTop: 8,
                          padding: "4px 10px",
                          borderRadius: 8,
                          border: `1px solid ${ax.border}`,
                          background: "transparent",
                          color: ax.text2,
                          fontSize: 10,
                          fontWeight: 600,
                          cursor: disabled ? "not-allowed" : "pointer",
                        }}
                      >
                        Imposta come predefinito
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    title="Rimuovi narratore"
                    disabled={disabled}
                    onClick={() => removeNarrator(n.id)}
                    style={{
                      padding: 8,
                      border: "none",
                      borderRadius: 10,
                      background: "rgba(239,68,68,0.08)",
                      color: "#f87171",
                      cursor: disabled ? "not-allowed" : "pointer",
                    }}
                  >
                    <HiTrash size={18} />
                  </button>
                </div>
                <div style={{ padding: "12px 14px", flex: 1 }}>
                  <div style={{ fontSize: 11, color: ax.text2, marginBottom: 6 }}>Voce ElevenLabs</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: ax.text, lineHeight: 1.35 }}>
                    {n.voiceLabel || n.voiceId || "— Non assegnata —"}
                  </div>
                  {n.voiceSourceType ? (
                    <div style={{ fontSize: 10, color: ax.muted, marginTop: 4 }}>Origine: {n.voiceSourceType}</div>
                  ) : null}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setVoiceOpenId(open ? null : n.id)}
                    style={{
                      marginTop: 10,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: `1px solid ${ax.electric || "#22d3ee"}`,
                      background: "rgba(34,211,238,0.08)",
                      color: ax.electric || "#22d3ee",
                      fontWeight: 700,
                      fontSize: 11,
                      cursor: disabled ? "not-allowed" : "pointer",
                      width: "100%",
                      justifyContent: "center",
                    }}
                  >
                    {open ? <HiChevronUp size={16} /> : <HiChevronDown size={16} />}
                    {open ? "Chiudi catalogo voci" : "Scegli / modifica voce"}
                  </button>
                  {open ? (
                    <div style={{ marginTop: 12 }}>
                      <ScenografieCharacterVoicePicker
                        ax={ax}
                        compact
                        vm={vm}
                        disabled={disabled}
                        onAssign={(partial) => {
                          patchNarrator(n.id, {
                            voiceId: partial.voiceId,
                            voiceLabel: partial.voiceLabel,
                            voiceSourceType: partial.voiceSourceType,
                            voicePreviewUrl: partial.voicePreviewUrl,
                            voiceAssignedAt: partial.voiceAssignedAt,
                            voiceCatalogSnapshot: partial.voiceCatalogSnapshot,
                          });
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
