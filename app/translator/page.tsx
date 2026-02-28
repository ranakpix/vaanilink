'use client';

import { useCallback, useMemo, useState } from 'react';
import Header from '../../components/Header';
import Footer from '../../components/Footer';
import HandTracker from '../../components/HandTracker';
import { Camera, Copy, Download, Save, Volume2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

type SavedItem = { text: string; createdAt: number };
type VoiceItem = { voice_id: string; name: string };

export default function TranslatorPage() {
  const [output, setOutput] = useState<string>('{Ready for translation... Enable camera and show sign language}');
  const [lastGesture, setLastGesture] = useState<string>('');
  const [transcript, setTranscript] = useState<Array<{ id: string; text: string; gestureId: string; createdAt: number }>>([]);
  const [voices, setVoices] = useState<VoiceItem[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('');

  const onPhrase = useCallback((phrase: string, gestureId: string) => {
    setOutput(phrase);
    setLastGesture(gestureId);
    setTranscript((prev) => [
      { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, text: phrase, gestureId, createdAt: Date.now() },
      ...prev,
    ].slice(0, 100));
  }, []);

  const speak = useCallback(() => {
    if (!('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(output);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [output]);

  const loadVoices = useCallback(async () => {
    try {
      const res = await fetch('/api/voices');
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as any;
        const msg = data?.error?.detail?.message ?? `Failed to load voices (status ${res.status})`;
        toast.warning('Could not load ElevenLabs voices', { description: msg });
        return;
      }
      const data = (await res.json()) as { voices?: VoiceItem[]; warning?: { code?: string; message?: string } };

      if (data.warning?.code === 'missing_voices_read') {
        toast.info('Using default ElevenLabs voice.', {
          description: data.warning.message ?? 'Your API key cannot list voices, but speech still works.',
        });
        setVoices([]);
        setSelectedVoiceId('');
        return;
      }

      const v = Array.isArray(data.voices) ? data.voices : [];
      setVoices(v);
      if (!selectedVoiceId && v.length > 0) {
        setSelectedVoiceId(v[0]?.voice_id ?? '');
      }
    } catch {
      toast.warning('Could not load ElevenLabs voices');
    }
  }, [selectedVoiceId]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(output);
    } catch {
      // ignore
    }
  }, [output]);

  const download = useCallback(() => {
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vaanilink-translation-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [output]);

  const save = useCallback(() => {
    try {
      const key = 'vaanilink:saved';
      const existing = JSON.parse(localStorage.getItem(key) ?? '[]') as SavedItem[];
      const next = [{ text: output, createdAt: Date.now() }, ...existing].slice(0, 25);
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, [output]);

  const subtitle = useMemo(() => {
    if (!lastGesture) return 'Enable your camera and show sign language to get instant translations';
    return `Detected: ${lastGesture}`;
  }, [lastGesture]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-foreground">Sign Language Translator</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Camera Feed */}
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Camera className="h-4 w-4 text-muted-foreground" /> Camera Feed
            </h2>
            <div className="mt-4">
              <HandTracker autoStart={false} onPhrase={onPhrase} voiceId={selectedVoiceId || undefined} />
            </div>
          </section>

          {/* Translation Results */}
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm flex flex-col">
            <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Sparkles className="h-4 w-4 text-muted-foreground" /> Translation Results
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">Real-time translation results will appear here</p>

            <div className="mt-4 flex-1 rounded-xl border border-border bg-white/40 p-4 text-sm text-foreground whitespace-pre-wrap">
              {output}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <button
                onClick={copy}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:bg-white/60 transition-colors"
              >
                <Copy className="h-4 w-4" /> Copy
              </button>
              <button
                onClick={speak}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:bg-white/60 transition-colors"
              >
                <Volume2 className="h-4 w-4" /> Speak
              </button>
              <button
                onClick={download}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:bg-white/60 transition-colors"
              >
                <Download className="h-4 w-4" /> Download
              </button>
              <button
                onClick={save}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:bg-white/60 transition-colors"
              >
                <Save className="h-4 w-4" /> Save
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-border bg-card/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-foreground">Voice</p>
                  <p className="text-[11px] text-muted-foreground">Choose an ElevenLabs voice (optional)</p>
                </div>
                <button
                  type="button"
                  onClick={loadVoices}
                  className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-white/60 transition-colors"
                  title="Load voices from ElevenLabs"
                >
                  Load
                </button>
              </div>

              <div className="mt-2">
                <select
                  value={selectedVoiceId}
                  onChange={(e) => setSelectedVoiceId(e.target.value)}
                  disabled={voices.length === 0}
                  className="w-full rounded-lg border border-border bg-white/40 px-3 py-2 text-sm text-foreground outline-none disabled:opacity-60"
                >
                  {voices.length === 0 ? (
                    <option value="">Using default voice</option>
                  ) : (
                    voices.map((v) => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>
          </section>

          {/* Transcript */}
          <aside className="rounded-2xl border border-border bg-card p-5 shadow-sm flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-foreground">Transcript</h2>
                <p className="mt-1 text-xs text-muted-foreground">Your recent spoken translations</p>
              </div>
              <button
                type="button"
                onClick={() => setTranscript([])}
                className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-white/60 transition-colors"
                disabled={transcript.length === 0}
              >
                Clear
              </button>
            </div>

            <div className="mt-4 flex-1 overflow-auto rounded-xl border border-border bg-white/40 p-3">
              {transcript.length === 0 ? (
                <p className="text-xs text-muted-foreground">No messages yet.</p>
              ) : (
                <ul className="space-y-2">
                  {transcript.map((t) => (
                    <li key={t.id} className="rounded-lg border border-border bg-card/70 p-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] font-semibold text-muted-foreground">{new Date(t.createdAt).toLocaleTimeString()}</span>
                        <span className="text-[11px] font-semibold text-muted-foreground">{t.gestureId}</span>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-foreground">{t.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </main>

      <Footer />
    </div>
  );
}

