import { SPEECH_RATE, mixDown, resampleLinear } from '../core/audio/segments';

/**
 * Décode un fichier audio en échantillons mono à 16 kHz (entrée des modèles de reconnaissance).
 * Une heure d'audio occupe environ 230 Mo pendant la transcription.
 */
export async function decodeForSpeech(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer();
  try {
    // Le navigateur décode et rééchantillonne directement à 16 kHz.
    const ctx = new OfflineAudioContext(1, 1, SPEECH_RATE);
    const buf = await ctx.decodeAudioData(bytes.slice(0));
    return mixDown(channelsOf(buf));
  } catch {
    const ctx = new AudioContext();
    try {
      const buf = await ctx.decodeAudioData(bytes);
      return resampleLinear(mixDown(channelsOf(buf)), buf.sampleRate);
    } finally {
      void ctx.close();
    }
  }
}

function channelsOf(buf: AudioBuffer): Float32Array[] {
  return Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
}
