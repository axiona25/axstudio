/**
 * Messaggi utente per pipeline clip Scenografie (puliti, brevi).
 * Dettagli tecnici: log lato chiamante (console / executionLog).
 */

/**
 * @param {unknown} err
 * @returns {string}
 */
export function sanitizeClipPipelineErrorForUser(err) {
  const raw = String(err?.message ?? err ?? "").trim();
  if (!raw) return "Operazione non riuscita. Controlla rete e chiavi API nel file .env.";

  if (/REACT_APP_ELEVENLABS_API_KEY/i.test(raw)) {
    return "ElevenLabs: chiave API mancante. Imposta REACT_APP_ELEVENLABS_API_KEY nel .env.";
  }
  if (/REACT_APP_FAL_API_KEY/i.test(raw)) {
    return "fal.ai: chiave API mancante. Imposta REACT_APP_FAL_API_KEY nel .env.";
  }
  if (/Testo TTS vuoto/i.test(raw)) return "Testo per la sintesi voce vuoto.";
  if (/voiceId ElevenLabs mancante/i.test(raw)) return "Voce ElevenLabs non configurata.";
  if (/ElevenLabs TTS \(\d+\)/i.test(raw)) {
    return "ElevenLabs: sintesi voce non riuscita. Controlla voice ID, quota e testo.";
  }
  if (/Immagine scena non trovata|scena sorgente deve essere approvata|URL immagine scena vuoto/i.test(raw)) {
    return raw.length > 240 ? `${raw.slice(0, 220)}…` : raw;
  }
  if (/fal\.ai upload|presigned upload|upload error/i.test(raw)) {
    return "Caricamento su fal.ai non riuscito. Verifica rete e riprova.";
  }
  if (/fal\.ai job failed|Kling Avatar.*nessun video URL|nessun video URL/i.test(raw)) {
    return "Generazione video (Kling) non riuscita. Riprova; se persiste, controlla i log.";
  }
  if (/image_url mancante|audio_url mancante/i.test(raw)) {
    return "Parametri mancanti per il video. Riprova dalla generazione clip.";
  }
  if (/Voice master|Preset voce|stesso voice ID|multi-speaker|non valida/i.test(raw)) {
    return raw.length > 280 ? `${raw.slice(0, 260)}…` : raw;
  }
  if (/decodeAudioData|AudioContext|decode.*audio/i.test(raw)) {
    return "Durata audio non letta nel browser; il video può essere comunque creato.";
  }

  if (raw.length > 220) return `${raw.slice(0, 200)}…`;
  return raw;
}
