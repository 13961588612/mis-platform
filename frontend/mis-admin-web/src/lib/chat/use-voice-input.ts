import { useCallback, useRef, useState } from 'react';
import {
  mapMicError,
  SPEECH_MAX_SECONDS,
  transcribeSpeech,
} from './speech-transcribe';

export type VoiceInputStatus = 'idle' | 'recording' | 'transcribing';

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return 'audio/webm';
  }
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'audio/webm';
}

export function useVoiceInput() {
  const [status, setStatus] = useState<VoiceInputStatus>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const stopAndTranscribeRef = useRef<() => Promise<string | null>>(async () => null);

  const clearTimers = () => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (stopTimerRef.current != null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  };

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  };

  const cancel = useCallback(() => {
    clearTimers();
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
    } catch {
      /* ignore */
    }
    releaseStream();
    setStatus('idle');
    setElapsedSec(0);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('当前浏览器无法录音');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = pickMimeType();
      const rec = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = rec;
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.start(250);
      startedAtRef.current = Date.now();
      setElapsedSec(0);
      setStatus('recording');
      timerRef.current = window.setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);
      stopTimerRef.current = window.setTimeout(() => {
        void stopAndTranscribeRef.current();
      }, SPEECH_MAX_SECONDS * 1000);
    } catch (err) {
      releaseStream();
      setStatus('idle');
      setError(mapMicError(err));
    }
  }, []);

  const stopAndTranscribe = useCallback(async (): Promise<string | null> => {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') {
      setStatus('idle');
      return null;
    }
    clearTimers();
    const durationMs = Date.now() - startedAtRef.current;
    const mime = rec.mimeType || 'audio/webm';
    const blob = await new Promise<Blob>((resolve, reject) => {
      rec.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: mime }));
      };
      rec.onerror = () => reject(new Error('录音中断'));
      try {
        rec.stop();
      } catch (e) {
        reject(e);
      }
    }).finally(() => {
      releaseStream();
    });
    setStatus('transcribing');
    try {
      const text = await transcribeSpeech(blob, durationMs);
      setStatus('idle');
      setElapsedSec(0);
      return text;
    } catch (err) {
      setStatus('idle');
      setElapsedSec(0);
      setError(err instanceof Error ? err.message : '语音转写失败');
      return null;
    }
  }, []);

  stopAndTranscribeRef.current = stopAndTranscribe;

  return { status, elapsedSec, error, start, stopAndTranscribe, cancel, setError };
}
