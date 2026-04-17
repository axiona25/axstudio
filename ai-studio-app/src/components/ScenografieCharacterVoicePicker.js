/**
 * Catalogo voci ElevenLabs a card: sync API, filtri, anteprima, assegnazione personaggio.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HiArrowPath, HiMicrophone, HiCheckCircle } from "react-icons/hi2";
import {
  syncElevenVoiceCatalogFromApi,
  loadCachedElevenVoiceCatalog,
  voiceCatalogSourceLabel,
  ELEVEN_VOICE_CATALOG_VERSION,
} from "../services/elevenVoiceCatalog.js";
import { getElevenLabsApiKey, elevenLabsTextToSpeechMp3, resolveElevenLabsVoiceId } from "../services/elevenlabsService.js";

const PREVIEW_TEXT_IT =
  "Ciao, questa è un'anteprima della voce per il tuo personaggio in AXSTUDIO Scenografie.";

function btnBase(ax, disabled) {
  return {
    padding: "6px 10px",
    borderRadius: 8,
    border: `1px solid ${ax.border}`,
    background: ax.surface || ax.bg,
    color: ax.text,
    fontSize: 11,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

/**
 * @param {object} props
 * @param {object} props.ax — tema UI (bg, surface, border, text, text2, muted, gradPrimary, …)
 * @param {boolean} [props.compact]
 * @param {boolean} [props.disabled]
 * @param {object} props.vm — normalizeCharacterVoiceMaster
 * @param {(partial: object) => void} props.onAssign
 */
export function ScenografieCharacterVoicePicker({ ax, compact = false, disabled = false, vm, onAssign }) {
  const [catalog, setCatalog] = useState(() => loadCachedElevenVoiceCatalog());
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [previewBusyKey, setPreviewBusyKey] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, []);

  const filtered = useMemo(() => {
    const voices = catalog?.voices && Array.isArray(catalog.voices) ? catalog.voices : [];
    const q = query.trim().toLowerCase();
    return voices.filter((v) => {
      if (filter === "italian" && !v.isItalian) return false;
      if (filter === "mine" && !v.isFromMyVoices && v.sourceType !== "clone") return false;
      if (!q) return true;
      const blob = `${v.name || ""} ${v.description || ""} ${v.voiceId || ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [catalog?.voices, filter, query]);

  const doSync = useCallback(async () => {
    if (!getElevenLabsApiKey()) {
      setSyncError("API key ElevenLabs mancante (.env).");
      return;
    }
    setSyncing(true);
    setSyncError(null);
    try {
      const next = await syncElevenVoiceCatalogFromApi();
      setCatalog(next);
    } catch (e) {
      setSyncError(e?.message || String(e));
    } finally {
      setSyncing(false);
    }
  }, []);

  const playPreview = useCallback(
    async (entry) => {
      if (disabled) return;
      setPreviewBusyKey(`${entry.voiceId}:${entry.sourceType || ""}`);
      setSyncError(null);
      let objectUrl = null;
      try {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = "";
        }
        let url = entry.previewUrl;
        if (!url || !String(url).startsWith("http")) {
          const forTts = entry.resolvedVoiceId
            ? entry.resolvedVoiceId
            : resolveElevenLabsVoiceId(entry.voiceId).voiceId || entry.voiceId;
          if (!forTts) {
            setSyncError("Nessun voice ID risolvibile per anteprima.");
            return;
          }
          const blob = await elevenLabsTextToSpeechMp3({ text: PREVIEW_TEXT_IT, voiceId: forTts });
          objectUrl = URL.createObjectURL(blob);
          url = objectUrl;
        }
        const a = new Audio(url);
        audioRef.current = a;
        await new Promise((resolve, reject) => {
          a.onended = () => resolve();
          a.onerror = () => reject(new Error("Riproduzione anteprima fallita."));
          a.play().catch(reject);
        });
      } catch (e) {
        setSyncError(e?.message || String(e));
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        setPreviewBusyKey(null);
      }
    },
    [disabled],
  );

  const assign = useCallback(
    (entry) => {
      if (disabled) return;
      const resolved = entry.resolvedVoiceId || resolveElevenLabsVoiceId(entry.voiceId).voiceId || entry.voiceId;
      onAssign({
        voiceId: entry.voiceId,
        elevenLabsVoiceId: resolved,
        voiceLabel: entry.name || "",
        voiceProvider: "elevenlabs",
        voiceSourceType: entry.sourceType || "",
        voicePreviewUrl: entry.previewUrl ? String(entry.previewUrl) : "",
        voiceAssignedAt: new Date().toISOString(),
        voiceCatalogSnapshot: {
          voiceId: entry.voiceId,
          name: entry.name,
          sourceType: entry.sourceType,
          catalogVersion: ELEVEN_VOICE_CATALOG_VERSION,
          lastSyncAt: catalog?.voiceCatalogLastSyncAt || null,
        },
      });
    },
    [disabled, onAssign, catalog?.voiceCatalogLastSyncAt],
  );

  const selectedVoiceId = vm?.voiceId || "";
  const gridCols = compact ? "repeat(auto-fill, minmax(160px, 1fr))" : "repeat(auto-fill, minmax(220px, 1fr))";

  return (
    <div style={{ marginTop: compact ? 6 : 0 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <button type="button" onClick={doSync} disabled={disabled || syncing} style={btnBase(ax, disabled || syncing)}>
          <HiArrowPath size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
          {syncing ? "Sincronizzo…" : "Aggiorna catalogo da ElevenLabs"}
        </button>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          disabled={disabled}
          style={{ ...btnBase(ax, disabled), padding: "7px 10px" }}
        >
          <option value="all">Tutte le voci</option>
          <option value="italian">Italiane / rilevanti IT</option>
          <option value="mine">Le mie voci / clone</option>
        </select>
        <input
          type="search"
          placeholder="Cerca nome o id…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          style={{
            flex: compact ? "1 1 120px" : "1 1 180px",
            minWidth: 120,
            padding: "7px 10px",
            borderRadius: 8,
            border: `1px solid ${ax.border}`,
            background: ax.bg,
            color: ax.text,
            fontSize: 11,
          }}
        />
        <span style={{ fontSize: 10, color: ax.muted }}>
          {catalog?.voiceCatalogLastSyncAt
            ? `Ultimo sync: ${catalog.voiceCatalogLastSyncAt}`
            : "Nessun sync ancora — premi Aggiorna."}
        </span>
      </div>
      {syncError ? (
        <div
          style={{
            fontSize: 11,
            color: "#f87171",
            marginBottom: 8,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid rgba(248,113,113,0.35)",
            background: "rgba(127,29,29,0.12)",
          }}
        >
          {syncError}
        </div>
      ) : null}
      <div style={{ fontSize: 10, color: ax.text2, marginBottom: 8, lineHeight: 1.45 }}>
        Voce attuale:{" "}
        <strong style={{ color: ax.text }}>{vm?.voiceLabel || "—"}</strong> · ID configurato:{" "}
        <code style={{ fontSize: 10 }}>{selectedVoiceId || "—"}</code>
        {vm?.voiceSourceType ? (
          <>
            {" "}
            · origine <code style={{ fontSize: 10 }}>{vm.voiceSourceType}</code>
          </>
        ) : null}
        {Array.isArray(vm?.voiceAssignmentHistory) && vm.voiceAssignmentHistory.length > 0 ? (
          <span style={{ display: "block", marginTop: 4, color: ax.muted }}>
            Storico assegnazioni (clip già generati possono usare voci precedenti):{" "}
            {vm.voiceAssignmentHistory
              .slice(-3)
              .map((h) => `${h.voiceLabel || h.voiceId} @ ${h.at || ""}`)
              .join(" → ")}
          </span>
        ) : null}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridCols,
          gap: compact ? 8 : 10,
          maxHeight: compact ? 280 : 420,
          overflowY: "auto",
          paddingRight: 4,
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ gridColumn: "1 / -1", fontSize: 11, color: ax.muted }}>
            Nessuna voce in elenco. Aggiorna il catalogo o allenta i filtri.
          </div>
        ) : (
          filtered.map((entry) => {
            const isSel = selectedVoiceId && selectedVoiceId === entry.voiceId;
            const srcLabel = voiceCatalogSourceLabel(entry);
            const busy = previewBusyKey === `${entry.voiceId}:${entry.sourceType || ""}`;
            return (
              <div
                key={`${entry.voiceId}-${entry.sourceType || "x"}`}
                style={{
                  borderRadius: 12,
                  border: `1px solid ${isSel ? "rgba(52,211,153,0.55)" : ax.border}`,
                  background: isSel ? "rgba(16,185,129,0.08)" : ax.surface || ax.bg,
                  padding: compact ? 8 : 10,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: ax.text, lineHeight: 1.3 }}>{entry.name}</div>
                <div style={{ fontSize: 10, color: ax.electric || "#22d3ee", fontWeight: 700 }}>{srcLabel}</div>
                <div style={{ fontSize: 9, color: ax.muted, lineHeight: 1.35 }}>
                  {entry.isItalian ? "IT · " : ""}
                  {entry.category || "—"}
                  {entry.previewUrl ? " · preview URL" : " · anteprima via TTS se serve"}
                </div>
                {entry.description ? (
                  <div style={{ fontSize: 9, color: ax.text2, lineHeight: 1.35, maxHeight: compact ? 32 : 44, overflow: "hidden" }}>
                    {entry.description.slice(0, 120)}
                    {entry.description.length > 120 ? "…" : ""}
                  </div>
                ) : null}
                <div style={{ fontSize: 9, color: ax.muted, wordBreak: "break-all" }}>{entry.voiceId}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: "auto" }}>
                  <button
                    type="button"
                    onClick={() => playPreview(entry)}
                    disabled={disabled || busy}
                    style={{
                      ...btnBase(ax, disabled || busy),
                      flex: 1,
                      minWidth: 90,
                    }}
                  >
                    {busy ? "…" : "Anteprima"}
                  </button>
                  <button
                    type="button"
                    onClick={() => assign(entry)}
                    disabled={disabled}
                    style={{
                      ...btnBase(ax, disabled),
                      flex: 1,
                      minWidth: 90,
                      borderColor: isSel ? "rgba(52,211,153,0.5)" : ax.border,
                      background: isSel ? "rgba(52,211,153,0.2)" : ax.gradPrimary,
                      color: isSel ? ax.text : "#fff",
                    }}
                  >
                    {isSel ? (
                      <>
                        <HiCheckCircle size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                        Assegnata
                      </>
                    ) : (
                      "Assegna"
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
      <p style={{ fontSize: 9, color: ax.muted, margin: "10px 0 0", lineHeight: 1.45 }}>
        <HiMicrophone size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
        Le voci senza URL di preview usano una sintesi breve ElevenLabs (costo minimo API). Modificare la voce non
        rompe i personaggi: i clip già generati restano con l&apos;audio precedente finché non li rigeneri.
      </p>
    </div>
  );
}
