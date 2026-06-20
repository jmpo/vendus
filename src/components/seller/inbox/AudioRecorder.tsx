import { useEffect, useRef, useState } from 'react';
import { Trash2, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Mp3Encoder } from '@breezystack/lamejs';

interface AudioRecorderProps {
  /** Llamado cuando el usuario confirma el envío. Devuelve el Blob MP3 + duración ms. */
  onConfirm: (blob: Blob, durationMs: number) => void;
  onCancel: () => void;
  disabled?: boolean;
}

function formatTime(ms: number) {
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60).toString().padStart(2, '0');
  const ss = (total % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

/** Codifica PCM (Float32 mono) a MP3 con lamejs. WhatsApp no acepta el webm de MediaRecorder. */
function encodeMp3(samples: Float32Array, sampleRate: number): Blob {
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
  return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
}

/**
 * Grabador de audio inline. Captura PCM crudo vía Web Audio y lo codifica a MP3
 * (formato soportado por WhatsApp, junto con OGG-opus/AAC/AMR).
 */
export function AudioRecorder({ onConfirm, onCancel, disabled }: AudioRecorderProps) {
  const [elapsed, setElapsed] = useState(0);
  const [isStarting, setIsStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const buffersRef = useRef<Float32Array[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const teardown = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    try { processorRef.current?.disconnect(); } catch { /* noop */ }
    try { sourceRef.current?.disconnect(); } catch { /* noop */ }
    try { ctxRef.current?.close(); } catch { /* noop */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
  };

  // Inicia al montar
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx: AudioContext = new Ctx();
        ctxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        sourceRef.current = source;
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;
        buffersRef.current = [];
        processor.onaudioprocess = (e) => {
          buffersRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        };
        source.connect(processor);
        processor.connect(ctx.destination); // necesario para que dispare onaudioprocess
        startTimeRef.current = Date.now();
        timerRef.current = setInterval(() => setElapsed(Date.now() - startTimeRef.current), 200);
        setIsStarting(false);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Permiso de micrófono denegado.');
        setIsStarting(false);
      }
    })();

    return () => { cancelled = true; teardown(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfirm = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    const duration = Date.now() - startTimeRef.current;
    try {
      const sampleRate = ctxRef.current?.sampleRate || 44100;
      const parts = buffersRef.current;
      const total = parts.reduce((n, b) => n + b.length, 0);
      const merged = new Float32Array(total);
      let offset = 0;
      for (const b of parts) { merged.set(b, offset); offset += b.length; }
      teardown();
      const blob = encodeMp3(merged, sampleRate);
      onConfirm(blob, duration);
    } catch (e: any) {
      setError(e?.message || 'Fallo al finalizar la grabación.');
    }
  };

  const handleCancel = () => {
    teardown();
    onCancel();
  };

  if (error) {
    return (
      <div className="px-3 py-2 border-t border-border bg-destructive/10 flex items-center gap-2">
        <span className="text-xs text-destructive flex-1">{error}</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>OK</Button>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 border-t border-border bg-muted/40 flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 text-destructive hover:text-destructive hover:bg-destructive/10"
        onClick={handleCancel}
        disabled={disabled || isStarting}
        aria-label="Cancelar grabación"
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      <div className="flex-1 flex items-center gap-2">
        <span className={cn(
          "h-2.5 w-2.5 rounded-full bg-destructive",
          !isStarting && "animate-pulse",
        )} />
        <span className="text-sm font-mono tabular-nums">{formatTime(elapsed)}</span>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          {isStarting ? 'Iniciando micrófono…' : 'Grabando… tocá enviar para terminar'}
        </span>
      </div>

      <Button
        size="icon"
        className="h-10 w-10 rounded-full"
        onClick={handleConfirm}
        disabled={disabled || isStarting || elapsed < 500}
        aria-label="Enviar audio"
      >
        {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </Button>
    </div>
  );
}
