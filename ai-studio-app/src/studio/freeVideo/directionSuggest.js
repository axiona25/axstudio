/**
 * Video libero — direction style suggestion (heuristic + OpenRouter).
 */

import { LLM_MODELS, OPENROUTER_API_URL, OPENROUTER_API_KEY } from "../../services/openRouterFreeStudio.js";
import { VIDEO_DIRECTION_STYLE_PRESETS } from "../presets/videoStylePresets.js";

// ─────────────────────────────────────────────────────────────────────────────
// ── DIRECTION STYLE SUGGESTION ENGINE ────────────────────────────────────────
// Hybrid: fast local heuristics → optional LLM refinement for reason_it.
// Returns { recommended_direction_style, alternative_direction_styles, reason_it, confidence, source }
// ─────────────────────────────────────────────────────────────────────────────

const DIRECTION_VALID_IDS = new Set(VIDEO_DIRECTION_STYLE_PRESETS.map(p => p.id));

const DIRECTION_HEURISTIC_RULES = [
  {
    keywords: ["caffè", "cucina", "colazione", "pranzo", "cena", "tavola", "divano", "letto", "bagno", "doccia", "specchio", "quotidian", "routine", "sveglia", "mattina", "casa", "appartamento", "stanza", "camera da letto", "salotto"],
    recommended: "documentary", alternatives: ["handheld", "cinematic"],
    reason: "Scena quotidiana e intima: una regia osservazionale mantiene naturalezza e leggibilità dell'azione.",
    confidence: 0.85,
  },
  {
    keywords: ["vola", "volare", "drago", "panorama", "città dall'alto", "montagna", "valle", "sorvola", "sopra la città", "veduta", "paesaggio", "aereo", "cielo", "nuvole", "orizzonte", "costa", "mare dall'alto", "castello"],
    recommended: "drone", alternatives: ["cinematic", "trailer"],
    reason: "Scena ampia e panoramica con grande respiro visivo: una ripresa aerea o cinematica valorizza il movimento nello spazio.",
    confidence: 0.88,
  },
  {
    keywords: ["sogno", "sogna", "oniric", "magico", "luminosa", "sfera luminosa", "bosco incantato", "fata", "galleggia", "fluttua", "contempla", "ammira", "meraviglia", "surreale", "nebbia", "foschia", "aurora", "stelle cadenti", "riflesso nell'acqua", "magia", "incanto", "fiaba"],
    recommended: "dreamy", alternatives: ["cinematic", "dolly_in"],
    reason: "Scena contemplativa e poetica: una regia sognante esalta atmosfera e meraviglia.",
    confidence: 0.84,
  },
  {
    keywords: ["corre", "correre", "inseguit", "fuga", "scappa", "vicolo", "inseguimento", "rincorre", "spara", "sparo", "combattimento", "lotta", "pugni", "calci", "esplosione", "esplosioni", "scontro", "attacco", "difesa", "panico", "emergenza"],
    recommended: "handheld", alternatives: ["chaotic", "bodycam"],
    reason: "Alta energia e tensione: una camera a mano con movimento reattivo trasmette urgenza e immersione.",
    confidence: 0.87,
  },
  {
    keywords: ["orologio", "gioiello", "anello", "bottiglia", "profumo", "scarpa", "borsa", "lusso", "prodotto", "design", "elegante", "packaging", "vetrina", "espositore", "diamante", "cristallo", "brand"],
    recommended: "commercial", alternatives: ["orbit", "push_in_macro"],
    reason: "Focus prodotto e dettaglio: una regia commerciale con movimento controllato esalta eleganza e precisione.",
    confidence: 0.89,
  },
  {
    keywords: ["tramonto", "alba", "nuvole che si muovono", "cielo che cambia", "stagioni", "passare del tempo", "costruzione", "folla", "traffico", "fiori che sbocciano", "giorno e notte", "ore passano"],
    recommended: "timelapse", alternatives: ["hyperlapse", "cinematic"],
    reason: "Scena con passaggio del tempo o evoluzione ambientale: il time-lapse comprime il cambiamento in modo chiaro e visivo.",
    confidence: 0.86,
  },
  {
    keywords: ["dettaglio", "occhio", "labbra", "texture", "superficie", "goccia", "gocce", "pioggia su", "rugiada", "food", "cibo da vicino", "primo piano estremo", "macro", "filo d'erba", "insetto", "petalo"],
    recommended: "push_in_macro", alternatives: ["rack_focus", "dolly_in"],
    reason: "Focus su dettaglio ravvicinato: una regia macro valorizza texture, materialità e intimità visiva.",
    confidence: 0.85,
  },
  {
    keywords: ["epico", "epica", "battaglia", "guerra", "esercito", "armata", "cavaliere", "gladiatore", "arena", "trono", "spada", "fantasy", "sci-fi", "astronave", "galassia", "supereroe", "apocalisse", "catastrofe", "distruzione"],
    recommended: "trailer", alternatives: ["cinematic", "drone"],
    reason: "Scena epica e ad alto impatto: una regia da trailer massimizza drammaticità e tensione narrativa.",
    confidence: 0.87,
  },
  {
    keywords: ["danza", "balla", "ballare", "palco", "performance", "concerto", "cantante", "rapper", "dj", "discoteca", "club", "neon", "luci colorate", "moda", "sfilata", "passerella", "modella"],
    recommended: "music_video", alternatives: ["gimbal", "cinematic"],
    reason: "Scena performativa e stilizzata: una regia da music video esalta ritmo, energia e impatto visivo.",
    confidence: 0.86,
  },
  {
    keywords: ["statua", "monumento", "scultura", "personaggio in posa", "creatura", "robot", "mech", "auto", "macchina", "moto", "icona", "busto", "ritratto a 360"],
    recommended: "orbit", alternatives: ["dolly_in", "commercial"],
    reason: "Soggetto iconico e centrale: un'orbita attorno al soggetto ne esalta la presenza e la tridimensionalità.",
    confidence: 0.84,
  },
  {
    keywords: ["cammina per", "attraversa", "corridoio", "tunnel", "mercato", "strada affollata", "passeggiata", "esplora", "percorre", "cammino", "viaggio", "sentiero"],
    recommended: "gimbal", alternatives: ["hyperlapse", "handheld"],
    reason: "Movimento attraverso uno spazio: una ripresa stabilizzata con gimbal mantiene fluidità e progressione narrativa.",
    confidence: 0.83,
  },
  {
    keywords: ["rivela", "reveal", "compare", "appare", "scopre", "trova", "apre gli occhi", "si volta", "dietro la porta", "momento chiave", "emozione", "piange", "lacrima", "sorriso lento"],
    recommended: "dolly_in", alternatives: ["cinematic", "rack_focus"],
    reason: "Momento emotivo o reveal: un lento avvicinamento al soggetto amplifica tensione e coinvolgimento.",
    confidence: 0.85,
  },
  {
    keywords: ["cctv", "sicurezza", "telecamera", "sorveglianza", "registrazione", "infrarossi", "notturna", "parcheggio vuoto"],
    recommended: "surveillance", alternatives: ["found_footage", "documentary"],
    reason: "Estetica da sorveglianza: inquadratura fissa e distaccata per un effetto di osservazione fredda.",
    confidence: 0.90,
  },
  {
    keywords: ["soggettiva", "prima persona", "punto di vista", "pov", "vedo", "guardo le mie mani", "mi guardo"],
    recommended: "first_person", alternatives: ["bodycam", "handheld"],
    reason: "Prospettiva soggettiva: la camera in prima persona crea immersione diretta nell'esperienza del personaggio.",
    confidence: 0.88,
  },
  {
    keywords: ["loop", "ripetizione", "ciclico", "infinito", "continuo", "wallpaper", "sfondo animato", "fiamma", "acqua che scorre"],
    recommended: "loop", alternatives: ["slow_motion", "dreamy"],
    reason: "Composizione ciclica e ripetibile: una regia loop crea continuità visiva senza interruzioni.",
    confidence: 0.87,
  },
  {
    keywords: ["rallentatore", "slow motion", "al rallentatore", "caduta lenta", "goccia che cade", "capelli al vento", "esplosione lenta", "impatto lento"],
    recommended: "slow_motion", alternatives: ["cinematic", "dreamy"],
    reason: "Azione da valorizzare al rallentatore: lo slow motion enfatizza il gesto e crea eleganza visiva.",
    confidence: 0.88,
  },
  {
    keywords: ["stop motion", "pupazzo", "plastilina", "marionetta", "claymation", "miniatura", "giocattolo", "artigianale"],
    recommended: "stop_motion", alternatives: ["commercial", "loop"],
    reason: "Estetica artigianale e handmade: una regia stop motion dà carattere tattile e charme alla scena.",
    confidence: 0.87,
  },
];

export function suggestDirectionStyleHeuristic(promptIT, promptEN = "", selectedVisualStyles = [], duration = 5) {
  const text = `${promptIT} ${promptEN}`.toLowerCase();

  let bestMatch = null;
  let bestScore = 0;

  for (const rule of DIRECTION_HEURISTIC_RULES) {
    const hits = rule.keywords.filter(kw => text.includes(kw)).length;
    if (hits > 0) {
      const score = hits / rule.keywords.length + rule.confidence * 0.1;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = rule;
      }
    }
  }

  const heuristicDuration = (() => {
    const SHORT_KW = ["dettaglio", "sguardo", "occhio", "labbra", "reazione", "goccia", "flash", "glitch", "micro"];
    const LONG_KW = ["panorama", "panoramica", "paesaggio", "attraversa", "cammina per", "viaggio", "sequenza", "storia", "racconto", "epico", "epica", "battaglia", "inseguimento", "esplora"];
    const VLONG_KW = ["sceneggiatura", "scena complessa", "più azioni", "camera change", "transizione"];
    if (VLONG_KW.some(kw => text.includes(kw))) return 15;
    if (LONG_KW.some(kw => text.includes(kw))) return 10;
    if (SHORT_KW.some(kw => text.includes(kw))) return 3;
    return 5;
  })();

  if (bestMatch) {
    return {
      recommended_direction_style: bestMatch.recommended,
      alternative_direction_styles: bestMatch.alternatives.filter(a => a !== bestMatch.recommended),
      reason_it: bestMatch.reason,
      confidence: Math.min(0.95, bestMatch.confidence + bestScore * 0.05),
      source: "heuristic",
      suggested_duration: heuristicDuration,
      duration_reason_it: `Durata stimata in base al tipo di scena rilevata.`,
    };
  }

  return {
    recommended_direction_style: "cinematic",
    alternative_direction_styles: ["gimbal", "documentary"],
    reason_it: "Nessun pattern specifico rilevato: la regia cinematica è la scelta più versatile e sicura.",
    confidence: 0.55,
    source: "heuristic_fallback",
    suggested_duration: heuristicDuration,
    duration_reason_it: `Durata stimata in base al tipo di scena rilevata.`,
  };
}

const DIRECTION_SUGGEST_SYSTEM_PROMPT =
  "You are a video direction advisor for an AI video generator. " +
  "Given a scene description, suggest the BEST camera direction style AND the optimal clip duration. " +
  "You MUST choose ONLY from this exact list of IDs: " +
  "cinematic, slow_motion, timelapse, hyperlapse, drone, handheld, gimbal, dolly_in, dolly_out, orbit, push_in_macro, rack_focus, found_footage, documentary, surveillance, bodycam, first_person, fpv_drone, music_video, commercial, trailer, dreamy, chaotic, loop, stop_motion. " +
  "\n\nAnalyze the scene for: type (intimate/epic/action/poetic/product/transitional), energy level, shot width, mood, and visual style compatibility. " +
  "\n\nFor duration, choose ONLY one of: 3, 5, 7, 10, 15 (seconds). Guidelines: " +
  "3s = micro-action, reaction, detail shot. " +
  "5s = one complete action (default). " +
  "7s = short sequence of 2-3 connected movements. " +
  "10s = scene with multiple actions in one continuous flow. " +
  "15s = complex scene with camera changes or multiple beats. " +
  "\n\nReturn ONLY valid JSON (no markdown): " +
  '{"recommended_direction_style": "id", "alternative_direction_styles": ["id1", "id2"], "suggested_duration": 5, "duration_reason_it": "Brief Italian explanation of why this duration fits", "reason_it": "Brief Italian explanation of why this direction fits the scene", "confidence": 0.85}' +
  "\n\nThe reason_it and duration_reason_it MUST be in Italian, 1-2 sentences max. " +
  "Alternatives must be 2-3 different valid IDs. Never duplicate the recommended in alternatives.";

export async function suggestDirectionStyleLLM(promptIT, promptEN = "", selectedVisualStyles = []) {
  const context = [
    promptEN ? `Scene (EN): ${promptEN}` : "",
    `Scene (IT): ${promptIT}`,
    selectedVisualStyles.length > 0 ? `Visual style: ${selectedVisualStyles.join(", ")}` : "",
  ].filter(Boolean).join("\n");

  for (const model of LLM_MODELS) {
    try {
      const res = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://axstudio.app",
          "X-Title": "AXSTUDIO",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: DIRECTION_SUGGEST_SYSTEM_PROMPT },
            { role: "user", content: context },
          ],
          temperature: 0.4,
          max_tokens: 300,
        }),
      });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) continue;
      const clean = text.replace(/```json|```/g, "").trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.recommended_direction_style && DIRECTION_VALID_IDS.has(parsed.recommended_direction_style)) {
        const alts = (parsed.alternative_direction_styles || [])
          .filter(id => DIRECTION_VALID_IDS.has(id) && id !== parsed.recommended_direction_style)
          .slice(0, 3);
        const VALID_DURATIONS = new Set([3, 5, 7, 10, 15]);
        const rawDur = Number(parsed.suggested_duration);
        const suggestedDuration = VALID_DURATIONS.has(rawDur) ? rawDur : null;
        return {
          recommended_direction_style: parsed.recommended_direction_style,
          alternative_direction_styles: alts.length > 0 ? alts : ["cinematic", "gimbal"].filter(id => id !== parsed.recommended_direction_style).slice(0, 2),
          reason_it: parsed.reason_it || "",
          confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.75,
          source: "llm",
          ...(suggestedDuration != null ? { suggested_duration: suggestedDuration, duration_reason_it: parsed.duration_reason_it || "" } : {}),
        };
      }
    } catch (e) {
      console.warn("[DIRECTION SUGGEST LLM] Model failed:", e.message);
    }
  }
  return null;
}

export async function suggestDirectionStyle(promptIT, promptEN = "", selectedVisualStyles = [], duration = 5) {
  const heuristic = suggestDirectionStyleHeuristic(promptIT, promptEN, selectedVisualStyles, duration);
  try {
    const llmResult = await suggestDirectionStyleLLM(promptIT, promptEN, selectedVisualStyles);
    if (llmResult) {
      if (process.env.NODE_ENV === "development") {
        console.log("[DIRECTION SUGGEST]", {
          userPromptIT: promptIT,
          preparedPromptEn: promptEN,
          selectedVideoVisualStyle: selectedVisualStyles,
          videoDuration: duration,
          heuristicResult: heuristic,
          llmResult,
          recommendationSource: "hybrid",
        });
      }
      return {
        ...llmResult,
        source: "hybrid",
        suggested_duration: llmResult.suggested_duration ?? heuristic.suggested_duration,
        duration_reason_it: llmResult.duration_reason_it ?? heuristic.duration_reason_it,
      };
    }
  } catch (e) {
    console.warn("[DIRECTION SUGGEST] LLM layer failed, using heuristic only:", e.message);
  }
  if (process.env.NODE_ENV === "development") {
    console.log("[DIRECTION SUGGEST]", {
      userPromptIT: promptIT,
      preparedPromptEn: promptEN,
      selectedVideoVisualStyle: selectedVisualStyles,
      videoDuration: duration,
      directionRecommendation: heuristic,
      recommendationSource: "heuristic",
    });
  }
  return heuristic;
}
