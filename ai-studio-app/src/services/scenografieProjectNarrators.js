/**
 * Narratori di progetto (entità distinta dai personaggi scena).
 * Persistenza tipica: `projectNarrators` nel payload capitolo workspace.
 *
 * Nota: nessun import da `scenografieVideoWorkflow.js` (evita dipendenze circolari).
 */

export const PROJECT_NARRATOR_ROLE = "narrator";

/** Allineato a normalizeNarratorVoice (workflow) senza import ciclico. */
function toNarratorVoice(v) {
  if (!v || typeof v !== "object") return null;
  const voiceId = String(v.voiceId ?? "").trim();
  if (!voiceId) return null;
  return {
    voiceId,
    voiceLabel: typeof v.voiceLabel === "string" ? v.voiceLabel.trim() : "",
    voiceProvider: String(v.voiceProvider || "elevenlabs").trim() || "elevenlabs",
  };
}

export function newProjectNarratorId() {
  return `nar_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function trim(v) {
  return v != null ? String(v).trim() : "";
}

/**
 * @param {object|null} raw
 * @returns {object|null}
 */
export function normalizeProjectNarrator(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = trim(raw.id);
  if (!id) return null;
  const hist = Array.isArray(raw.voiceAssignmentHistory)
    ? raw.voiceAssignmentHistory
        .filter((h) => h && typeof h === "object")
        .map((h) => ({
          voiceId: trim(h.voiceId),
          voiceLabel: trim(h.voiceLabel),
          at: h.at != null ? String(h.at).trim() : "",
          note: trim(h.note) || "reassigned",
        }))
        .filter((h) => h.voiceId || h.at)
        .slice(-12)
    : [];
  const snap =
    raw.voiceCatalogSnapshot && typeof raw.voiceCatalogSnapshot === "object"
      ? { ...raw.voiceCatalogSnapshot }
      : null;
  return {
    id,
    name: trim(raw.name) || "Narratore",
    roleType: raw.roleType === PROJECT_NARRATOR_ROLE ? PROJECT_NARRATOR_ROLE : PROJECT_NARRATOR_ROLE,
    placeholderType: trim(raw.placeholderType) || "narrator_glyph",
    voiceId: trim(raw.voiceId),
    voiceLabel: trim(raw.voiceLabel),
    voiceSourceType: trim(raw.voiceSourceType),
    voicePreviewUrl: trim(raw.voicePreviewUrl),
    voiceAssignedAt:
      raw.voiceAssignedAt != null && String(raw.voiceAssignedAt).trim()
        ? String(raw.voiceAssignedAt).trim()
        : null,
    voiceCatalogSnapshot: snap,
    voiceAssignmentHistory: hist,
    isDefaultNarrator: raw.isDefaultNarrator === true,
    createdAt: raw.createdAt != null ? String(raw.createdAt).trim() : null,
    updatedAt: raw.updatedAt != null ? String(raw.updatedAt).trim() : null,
  };
}

/** @param {unknown} list */
export function normalizeProjectNarratorsList(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeProjectNarrator).filter(Boolean);
}

/** Un solo default: il primo marcato vince; se nessuno, il primo della lista. */
export function ensureProjectNarratorDefaultFlags(list) {
  const arr = normalizeProjectNarratorsList(list);
  if (arr.length === 0) return [];
  const has = arr.some((n) => n.isDefaultNarrator);
  if (!has) {
    return arr.map((n, i) => ({ ...n, isDefaultNarrator: i === 0 }));
  }
  let seen = false;
  return arr.map((n) => {
    if (n.isDefaultNarrator && !seen) {
      seen = true;
      return { ...n, isDefaultNarrator: true };
    }
    return { ...n, isDefaultNarrator: false };
  });
}

export function pickDefaultProjectNarrator(list) {
  const arr = normalizeProjectNarratorsList(list);
  const d = arr.find((n) => n.isDefaultNarrator);
  return d || arr[0] || null;
}

/**
 * Risolve voce TTS per clip narrato.
 * Priorità: narratorId progetto → voce embedded su clip (legacy) → narratore predefinito / primo → unresolved.
 * @param {object|null} clip
 * @param {unknown} projectNarrators
 */
export function resolveNarratedClipNarrator(clip, projectNarrators) {
  const list = normalizeProjectNarratorsList(projectNarrators);
  const embedded = toNarratorVoice(clip?.narratorVoice);
  const explicitNarratorId = trim(clip?.narratorId);

  if (explicitNarratorId) {
    const n = list.find((x) => x.id === explicitNarratorId);
    if (n?.voiceId) {
      return {
        narratorVoice: toNarratorVoice({
          voiceId: n.voiceId,
          voiceLabel: n.voiceLabel || n.name,
          voiceProvider: "elevenlabs",
        }),
        narratorId: n.id,
        resolvedNarratorId: n.id,
        resolvedNarratorVoiceId: n.voiceId,
        narratorResolutionMode: "clip_explicit_project_narrator",
      };
    }
    return {
      narratorVoice: null,
      narratorId: explicitNarratorId,
      resolvedNarratorId: null,
      resolvedNarratorVoiceId: null,
      narratorResolutionMode: "invalid_narrator_id",
    };
  }

  if (embedded?.voiceId) {
    return {
      narratorVoice: embedded,
      narratorId: null,
      resolvedNarratorId: null,
      resolvedNarratorVoiceId: embedded.voiceId,
      narratorResolutionMode: list.length ? "legacy_embedded_voice" : "legacy_embedded_voice_only",
    };
  }

  const def = pickDefaultProjectNarrator(list);
  if (def?.voiceId) {
    return {
      narratorVoice: toNarratorVoice({
        voiceId: def.voiceId,
        voiceLabel: def.voiceLabel || def.name,
        voiceProvider: "elevenlabs",
      }),
      narratorId: def.id,
      resolvedNarratorId: def.id,
      resolvedNarratorVoiceId: def.voiceId,
      narratorResolutionMode: def.isDefaultNarrator ? "project_default_narrator" : "project_first_narrator",
    };
  }

  return {
    narratorVoice: null,
    narratorId: null,
    resolvedNarratorId: null,
    resolvedNarratorVoiceId: null,
    narratorResolutionMode: "unresolved",
  };
}

/**
 * @param {object} narrator — normalizzato
 * @param {object} partial — campi voce da voice picker
 */
export function mergeNarratorVoiceAssignment(narrator, partial) {
  const n = narrator && typeof narrator === "object" ? { ...narrator } : {};
  const prevVid = trim(n.voiceId);
  const nextVid = partial.voiceId != null ? trim(partial.voiceId) : prevVid;
  let hist = Array.isArray(n.voiceAssignmentHistory) ? [...n.voiceAssignmentHistory] : [];
  if (nextVid && prevVid && nextVid !== prevVid) {
    hist = [
      ...hist,
      {
        voiceId: n.voiceId,
        voiceLabel: n.voiceLabel,
        at: new Date().toISOString(),
        note: "reassigned_before_clip_regeneration",
      },
    ].slice(-12);
  }
  const now = new Date().toISOString();
  return normalizeProjectNarrator({
    ...n,
    ...partial,
    voiceAssignmentHistory: hist,
    updatedAt: now,
    createdAt: n.createdAt || now,
  });
}
