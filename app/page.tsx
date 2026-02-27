import Link from 'next/link';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { Camera, Zap, MessageSquareText } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(20,184,166,0.20),transparent_45%),radial-gradient(circle_at_80%_30%,rgba(37,99,235,0.20),transparent_45%)]" />
          <div className="relative mx-auto max-w-6xl px-4 py-20">
            <div className="mx-auto max-w-3xl text-center animate-fade-in-up">
              <h1 className="text-4xl font-black tracking-tight text-foreground sm:text-6xl">
                Breaking Barriers with{' '}
                <span className="bg-linear-to-r from-primary to-secondary bg-clip-text text-transparent">
                  Real-Time Sign Translation
                </span>
              </h1>
              <p className="mt-6 text-base text-muted-foreground sm:text-lg">
                VaaniLink uses advanced AI to instantly translate sign language into text and speech,
                creating seamless communication for everyone.
              </p>

              <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/translator"
                  className="inline-flex items-center justify-center rounded-xl bg-foreground px-6 py-3 text-sm font-semibold text-background hover:opacity-90 transition-opacity"
                >
                  Start Translating →
                </Link>
                <Link
                  href="#how-it-works"
                  className="inline-flex items-center justify-center rounded-xl border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground hover:bg-white/60 transition-colors"
                >
                  Learn More
                </Link>
              </div>

              <div className="mt-10 flex items-center justify-center gap-2 text-xs font-medium text-secondary">
                <span className="h-2 w-2 rounded-full bg-secondary" />
                Real-time translation ready
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-16">
          <div className="text-center">
            <h2 className="text-3xl font-extrabold text-foreground">How It Works</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Three simple steps to break down communication barriers
            </p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              {
                step: '1',
                title: 'Capture',
                body: 'Point your camera at sign language and VaaniLink instantly recognizes hand gestures and movements.',
                accent: 'from-blue-500 to-blue-600',
                icon: Camera,
              },
              {
                step: '2',
                title: 'Process',
                body: 'Our AI model analyzes movements in real-time, identifying signs and converting them into meaningful content.',
                accent: 'from-teal-400 to-teal-600',
                icon: Zap,
              },
              {
                step: '3',
                title: 'Translate',
                body: 'Get instant text and speech output. Copy, download, or save translations to continue seamlessly.',
                accent: 'from-cyan-400 to-blue-600',
                icon: MessageSquareText,
              },
            ].map((card) => (
              <div
                key={card.step}
                className="relative rounded-2xl border border-border bg-card p-6 shadow-sm"
              >
                <div className="absolute -left-3 -top-3 grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-xs font-bold text-foreground">
                  {card.step}
                </div>
                <div className={`grid h-10 w-10 place-items-center rounded-xl bg-linear-to-br ${card.accent} mb-5 text-white`}>
                  <card.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold text-foreground">{card.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{card.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}