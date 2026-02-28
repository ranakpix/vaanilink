import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

export default function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="relative h-10 w-10 overflow-hidden rounded-xl border border-border bg-white/70 shadow-sm">
            <Image
              src="/vaanilink-logo.png"
              alt="VaaniLink sign-to-speech AI logo"
              fill
              sizes="40px"
              className="object-contain"
              priority
            />
          </div>
          <span className="text-lg font-bold tracking-tight text-foreground">VaaniLink</span>
        </div>

        <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
          <Link className="hover:text-foreground transition-colors" href="/">Home</Link>
          <Link className="hover:text-foreground transition-colors" href="/translator">Translator</Link>
        </nav>

        <div className="flex items-center gap-3">
          <ThemeToggle />

          <Link
            href="/translator"
            className="inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background hover:opacity-90 transition-opacity"
          >
            Open Translator
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}