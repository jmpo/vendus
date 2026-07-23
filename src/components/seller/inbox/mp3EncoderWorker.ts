// Web Worker: codifica PCM (Float32 mono) a MP3 fuera del hilo principal.
// Antes esto corría en el main thread y congelaba la UI ~1.5s por minuto de audio
// (Chrome lo reportaba como "INP Issue" al confirmar el envío de una nota de voz).
import { Mp3Encoder } from '@breezystack/lamejs';

interface EncodeRequest {
  samples: Float32Array;
  sampleRate: number;
}

self.onmessage = (e: MessageEvent<EncodeRequest>) => {
  try {
    const { samples, sampleRate } = e.data;
    const enc = new Mp3Encoder(1, sampleRate, 128);
    const blockSize = 1152;

    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    const chunks: Uint8Array[] = [];
    for (let i = 0; i < pcm.length; i += blockSize) {
      const buf = enc.encodeBuffer(pcm.subarray(i, i + blockSize));
      if (buf.length) chunks.push(buf);
    }
    const end = enc.flush();
    if (end.length) chunks.push(end);

    const blob = new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
    (self as unknown as Worker).postMessage({ ok: true, blob });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err) });
  }
};
