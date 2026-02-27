'use client';

import { useCallback, useMemo, useState } from 'react';
import Header from '../../components/Header';
import Footer from '../../components/Footer';
import HandTracker from '../../components/HandTracker';
import { Camera, Copy, Download, Save, Volume2, Sparkles } from 'lucide-react';

type SavedItem = { text: string; createdAt: number };

export default function TranslatorPage() {
  const [output, setOutput] = useState<string>('{Ready for translation... Enable camera and show sign language}');
  const [lastGesture, setLastGesture] = useState<string>('');

  const onPhrase = useCallback((phrase: string, gestureId: string) => {
    setOutput(phrase);
    setLastGesture(gestureId);
  }, []);

  const speak = useCallback(() => {
    if (!('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(output);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [output]);

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

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Camera Feed */}
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Camera className="h-4 w-4 text-muted-foreground" /> Camera Feed
            </h2>
            <div className="mt-4">
              <HandTracker autoStart={false} onPhrase={onPhrase} />
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
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}

