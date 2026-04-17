/**
 * Strategia prodotto ↔ stack tecnico per modulo AXSTUDIO.
 * I path reali restano nei servizi; qui sono default dichiarativi, note e intent di routing
 * (base per futuro capability-routing senza mega-dispatcher).
 */

export const MODULE_IDS = {
  FREE_IMAGE: "free-image",
  FREE_VIDEO: "free-video",
  SCENOGRAFIE: "scenografie",
  VIDEO_EDITOR: "video-editor",
};

/** @typedef {'premium' | 'flexible' | 'editor' | 'utility'} ProductTier */

/**
 * View shell App.js → modulo registry (solo moduli con header condiviso / editor dedicato).
 * @type {Record<string, string>}
 */
export const APP_VIEW_TO_MODULE_ID = {
  "free-image": MODULE_IDS.FREE_IMAGE,
  "free-video": MODULE_IDS.FREE_VIDEO,
  scenografie: MODULE_IDS.SCENOGRAFIE,
  "video-editor": MODULE_IDS.VIDEO_EDITOR,
};

/**
 * @param {string} moduleId
 * @returns {ModuleRegistryEntry | null}
 */
export function getModuleRegistry(moduleId) {
  return MODULE_REGISTRY[moduleId] || null;
}

/**
 * @param {string} appView
 */
export function getRegistryForAppView(appView) {
  const id = APP_VIEW_TO_MODULE_ID[appView];
  return id ? getModuleRegistry(id) : null;
}

/**
 * Sottotitolo header App: hub vs contesto progetto Scenografie.
 * @param {string} appView
 * @param {{ scenografieProjectTitle: string | null }} ctx
 */
export function getAppHeaderSubtitle(appView, ctx = {}) {
  const reg = getRegistryForAppView(appView);
  if (!reg?.ui) return "";
  if (appView === "scenografie") {
    if (ctx.scenografieProjectTitle) {
      return reg.ui.headerSubtitleInProject || reg.ui.headerSubtitle;
    }
    return reg.ui.headerSubtitle;
  }
  return reg.ui.headerSubtitle || "";
}

/**
 * @typedef {{ id: string, purpose: string, default?: boolean, optional?: boolean, notes?: string }} ModelRef
 * @typedef {{ id: string, models: ModelRef[], capabilities: string[], limits?: string[] }} ProviderEntry
 *
 * @typedef {Object} ModuleRegistryEntry
 * @property {string} moduleId
 * @property {string} displayLabel
 * @property {ProductTier} productTier
 * @property {string[]} primaryUseCases
 * @property {string[]} defaultProviders
 * @property {string[]} defaultModels
 * @property {string[]} optionalProviders
 * @property {string[]} optionalModels
 * @property {string[]} capabilityNotes
 * @property {string[]} knownLimits
 * @property {{ headline: string, bullets: string[] }} routingIntent
 * @property {{ headerSubtitle: string, headerSubtitleInProject?: string, homeCardTitle?: string, homeCardDescription?: string }} ui
 * @property {ProviderEntry[]} [providersLegacy]
 * @property {{ chain: string, note: string }} [openRouter]
 */

/** @type {Record<string, ModuleRegistryEntry>} */
export const MODULE_REGISTRY = {
  [MODULE_IDS.FREE_IMAGE]: {
    moduleId: MODULE_IDS.FREE_IMAGE,
    displayLabel: "Immagine libera",
    productTier: "utility",
    primaryUseCases: [
      "Generazione still da testo",
      "Edit rapido immagine (Kontext)",
      "Preset stile e asset veloci",
    ],
    defaultProviders: ["fal"],
    defaultModels: ["fal-ai/flux-2-pro"],
    optionalProviders: ["openrouter"],
    optionalModels: ["fal-ai/flux-pro/kontext/max"],
    capabilityNotes: [
      "Stack FAL immagine/edit come in App.js (generateImage / flussi create+edit).",
      "OpenRouter (openRouterFreeStudio.js) opzionale per traduzione/arricchimento prompt.",
    ],
    knownLimits: [
      "Nessuna pipeline narrativa: non eredita planner o scene da Scenografie.",
      "Modelli principali fissi nel codice; niente picker modello espanso in UI.",
    ],
    routingIntent: {
      headline: "Still e edit rapido",
      bullets: [
        "Priorità: velocità e semplicità prompt-to-image.",
        "Niente orchestrazione capitoli/personaggi.",
        "Allineato al path FAL già usato in Free Studio.",
      ],
    },
    ui: {
      headerSubtitle: "Crea o modifica immagini da prompt — strumento rapido, fuori dal percorso film di Scenografie",
      homeCardTitle: "Immagine libera",
      homeCardDescription: "Immagini da prompt e edit veloce · strumento libero, non crea progetti né film in Scenografie.",
    },
    providersLegacy: [
      {
        id: "fal",
        models: [
          { id: "fal-ai/flux-2-pro", purpose: "Generazione immagine (create)", default: true },
          { id: "fal-ai/flux-pro/kontext/max", purpose: "Edit / update con immagine sorgente", optional: true },
        ],
        capabilities: ["t2i", "img2img_edit", "style_presets", "negative_prompt"],
        limits: ["Modelli principali fissi nel codice App."],
      },
    ],
    openRouter: {
      chain: "LLM_MODELS in services/openRouterFreeStudio.js",
      note: "Traduzione / arricchimento prompt IT→EN per FLUX.",
    },
  },
  [MODULE_IDS.FREE_VIDEO]: {
    moduleId: MODULE_IDS.FREE_VIDEO,
    displayLabel: "Video libero",
    productTier: "flexible",
    primaryUseCases: [
      "Single-shot e ideazione rapida",
      "Reference-to-video da frame",
      "Lip-sync e varianti sperimentali",
    ],
    defaultProviders: ["fal", "elevenlabs"],
    defaultModels: [
      "fal-ai/flux-pro/v1.1-ultra",
      "fal-ai/kling-video/o3/pro/reference-to-video",
    ],
    optionalProviders: ["fal"],
    optionalModels: [
      "fal-ai/kling-video/lipsync/audio-to-video",
      "fal-ai/face-swap",
    ],
    capabilityNotes: [
      "Path App.js: frame FLUX + Kling O3 reference-to-video; lip-sync e face-swap come opzioni nel flusso.",
      "Scene plan e direction suggest in studio/freeVideo/ (OpenRouter).",
    ],
    knownLimits: [
      "Non usa la pipeline Scenografie (planner dedicato, Kling Avatar v2 Pro, montaggio unificato).",
      "Meno vincoli di coerenza narrativa tra shot — by design.",
    ],
    routingIntent: {
      headline: "Sperimentazione e flessibilità",
      bullets: [
        "Priorità: velocità e prova idee > coerenza di lungo periodo.",
        "Reference-to-video e varianti; non stack “produzione guidata”.",
        "Mantiene complessità Free Studio senza importare Scenografie.",
      ],
    },
    ui: {
      headerSubtitle: "Video rapidi da prompt — strumento libero e sperimentale, non il percorso guidato Scenografie",
      homeCardTitle: "Video libero",
      homeCardDescription: "Video veloci da prompt o frame · per prove e shot singoli; non sostituisce Scenografie per un film strutturato.",
    },
    providersLegacy: [
      {
        id: "fal",
        models: [
          { id: "fal-ai/flux-pro/v1.1-ultra", purpose: "Frame iniziale / opening frame", default: true },
          { id: "fal-ai/kling-video/o3/pro/reference-to-video", purpose: "Video da immagine di partenza", default: true },
          { id: "fal-ai/kling-video/lipsync/audio-to-video", purpose: "Lip-sync su audio ElevenLabs", optional: true },
          { id: "fal-ai/face-swap", purpose: "Volto su frame (flusso personaggio)", optional: true },
        ],
        capabilities: ["i2v", "t2v_via_frame", "lipsync", "ambient_in_prompt", "kling_native_voice"],
        limits: ["Stack distinto da Scenografie (non Kling Avatar v2 Pro)."],
      },
      {
        id: "elevenlabs",
        models: [{ id: "eleven_multilingual_v2", purpose: "TTS quando voce `el:`", optional: true }],
        capabilities: ["tts", "lip_sync_input"],
      },
    ],
    openRouter: {
      chain: "LLM_MODELS in openRouterFreeStudio.js",
      note: "Prompt video, scene plan, dialoghi/ambient; directionSuggest in studio/freeVideo/directionSuggest.js.",
    },
  },
  [MODULE_IDS.SCENOGRAFIE]: {
    moduleId: MODULE_IDS.SCENOGRAFIE,
    displayLabel: "Film Studio",
    productTier: "premium",
    primaryUseCases: [
      "Progetti e capitoli con piano narrativo",
      "Personaggi, master immagine, scene e clip",
      "Audio, mix e montaggio (servizi scenografie nel repo)",
    ],
    defaultProviders: ["fal", "elevenlabs", "openrouter"],
    defaultModels: [
      "fal-ai/flux-2-pro",
      "fal-ai/nano-banana-pro/edit",
      "fal-ai/kling-video/ai-avatar/v2/pro",
    ],
    optionalProviders: [],
    optionalModels: ["fal-ai/kling-video/o3/pro/reference-to-video"],
    capabilityNotes: [
      "Pipeline: scenografiePlanner, imagePipeline, videoClipPipeline, servizi audio/mix/montaggio nel repo.",
      "Video clip: dialoghi → Kling Avatar v2 Pro; narrato / cinematic → Kling O3 reference-to-video + mux mix (videoClipPipeline), isolato da Video libero.",
      "Pianificazione LLM: catena PLANNER_MODELS in scenografiePlanner.js (separata da Free Studio).",
    ],
    knownLimits: [
      "Policy e copertura API: scenografiePipelineCompiledPolicy.js (PIPELINE_PROVIDER_COVERAGE).",
      "Non accorpare il modulo con Video libero: executor e vincoli restano dedicati.",
    ],
    routingIntent: {
      headline: "Stack top / produzione guidata",
      bullets: [
        "Priorità: qualità e coerenza > flessibilità single-shot.",
        "Pipeline guidata: planner → immagini scena → clip → audio/montaggio.",
        "Executor premium disponibili nel codice (Avatar v2 Pro, nano-banana edit, ecc.).",
      ],
    },
    ui: {
      headerSubtitle: "Percorso guidato verso il film · capitoli, personaggi, clip, montaggio (stack premium)",
      headerSubtitleInProject: "Percorso guidato · stesso stack premium (planner, scene, clip, audio)",
      homeCardTitle: "Film Studio",
      homeCardDescription: "Il percorso strutturato del prodotto: progetto, capitoli, approvazioni e film finale.",
    },
    providersLegacy: [
      {
        id: "fal",
        models: [
          { id: "fal-ai/flux-2-pro", purpose: "Master / scene (imagePipeline)", default: true },
          { id: "fal-ai/nano-banana-pro/edit", purpose: "Identity lock / edit", default: true },
          { id: "fal-ai/kling-video/ai-avatar/v2/pro", purpose: "Clip dialogiche · immagine + audio", default: true },
          {
            id: "fal-ai/kling-video/o3/pro/reference-to-video",
            purpose: "Clip narrati / cinematic · frame + prompt (mix muxato dopo)",
            optional: true,
          },
        ],
        capabilities: ["character_master", "scene_pipeline", "dialogue_clip", "cinematic_i2v", "montage", "compiled_direction"],
        limits: ["Policy API vs metadata: vedi PIPELINE_PROVIDER_COVERAGE in scenografiePipelineCompiledPolicy.js"],
      },
      {
        id: "elevenlabs",
        models: [{ id: "eleven_multilingual_v2", purpose: "TTS clip (elevenlabsService)", default: true }],
        capabilities: ["tts", "voice_master_resolution"],
      },
      {
        id: "openrouter",
        models: [],
        capabilities: ["narrative_plan"],
        limits: ["Catena PLANNER_MODELS in scenografiePlanner.js (separata da Free Studio)."],
      },
    ],
  },
  [MODULE_IDS.VIDEO_EDITOR]: {
    moduleId: MODULE_IDS.VIDEO_EDITOR,
    displayLabel: "Video Editor",
    productTier: "editor",
    primaryUseCases: [
      "Editing timeline locale",
      "Import clip e export",
      "Composizione non generativa come focus",
    ],
    defaultProviders: [],
    defaultModels: [],
    optionalProviders: [],
    optionalModels: [],
    capabilityNotes: [
      "Modulo editor/VideoEditor.jsx: timeline, tracce, proprietà — non è generazione cloud nel path principale.",
    ],
    knownLimits: [
      "Separato da Video libero e da Scenografie: niente inferenza AI nel flusso principale dell’editor.",
    ],
    routingIntent: {
      headline: "Post-produzione timeline",
      bullets: [
        "Priorità: montaggio e controllo clip, non generazione single-shot.",
        "Non sostituisce né Video libero né pipeline Scenografie.",
      ],
    },
    ui: {
      headerSubtitle: "Montaggio su timeline · rifinisci file MP4 già esistenti (niente generazione guidata)",
      homeCardTitle: "Video Editor",
      homeCardDescription: "Taglio e montaggio su video già esportati · editing, non generazione AI né flusso Scenografie.",
    },
  },
};

/**
 * Compat: forma storica usata per onboarding. Deriva da MODULE_REGISTRY.
 * @type {Record<string, { label: string, tier: string, goal: string, providers: ProviderEntry[], openRouter?: { chain: string, note: string } }>}
 */
export const MODULE_PROVIDER_REGISTRY = Object.fromEntries(
  Object.entries(MODULE_REGISTRY).map(([id, m]) => {
    const tierLabel =
      m.productTier === "premium"
        ? "premium / controlled"
        : m.productTier === "flexible"
          ? "flexible / sandbox"
          : m.productTier === "editor"
            ? "offline_timeline"
            : "fast / still / edit";
    return [
      id,
      {
        label: m.displayLabel,
        tier: tierLabel,
        goal: m.routingIntent.headline + " — " + (m.primaryUseCases[0] || ""),
        providers: m.providersLegacy || [],
        ...(m.openRouter ? { openRouter: m.openRouter } : {}),
      },
    ];
  })
);
