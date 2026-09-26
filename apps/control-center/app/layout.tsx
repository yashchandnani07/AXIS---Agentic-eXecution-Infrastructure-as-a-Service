/**
 * @file      apps/control-center/app/layout.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   App shell: IBM Plex fonts, header with product identity ("powered by IBM Bob") and LIVE/REPLAY mode badge.
 * @depends   next/font/google, @/lib/api
 * @usedBy    every page
 * @agentNotes Keep "powered by IBM Bob" visible on every screen — judges must see Bob as the core component.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { MODE } from '@/lib/api';
import './globals.css';

export const metadata: Metadata = {
  title: 'AXIS — Agentic Execution Infrastructure',
  description: 'Multi-Cloud DevOps & Self-Healing Infrastructure powered by IBM Bob & watsonx.ai',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased bg-canvas text-fg selection:bg-ibm/30">
        <header className="border-b border-line bg-layer/95 sticky top-0 z-50 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
            <div className="flex items-center gap-8">
              <Link href="/" className="flex items-center gap-2.5 group">
                <div className="grid h-7 w-7 place-items-center rounded bg-ibm font-mono text-xs font-bold text-white shadow-sm group-hover:scale-105 transition-transform">
                  A/
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold tracking-tight text-base text-fg">AXIS</span>
                  <span className="hidden sm:inline-block rounded bg-layer-2 px-2 py-0.5 font-mono text-[10px] text-muted border border-line uppercase tracking-wider">
                    Infrastructure-as-a-Service
                  </span>
                </div>
              </Link>

              <nav className="hidden md:flex items-center gap-1 text-xs">
                <Link href="/" className="px-3 py-1.5 rounded-md text-fg font-medium hover:bg-canvas transition-colors">
                  Overview
                </Link>
                <Link href="/#deployments" className="px-3 py-1.5 rounded-md text-muted hover:text-fg hover:bg-canvas transition-colors">
                  Deployments
                </Link>
                <Link href="/#clouds" className="px-3 py-1.5 rounded-md text-muted hover:text-fg hover:bg-canvas transition-colors">
                  Clouds & DB
                </Link>
                <Link href="/#watson-agent" className="px-3 py-1.5 rounded-md text-bob hover:bg-bob/10 transition-colors font-medium flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-bob animate-pulse" />
                  Watson AI
                </Link>
              </nav>
            </div>

            <div className="flex items-center gap-3 text-xs">
              <div className="hidden lg:flex items-center gap-2 text-muted font-mono text-[11px] border-r border-line pr-4">
                <span>Core: <strong className="text-bob font-medium">IBM Bob 2.0</strong></span>
                <span>·</span>
                <span>AI: <strong className="text-ibm-soft font-medium">watsonx.ai</strong></span>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold border flex items-center gap-1.5 ${
                  MODE === 'live' ? 'bg-ok/10 text-ok border-ok/30' : 'bg-warn/10 text-warn border-warn/30'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${MODE === 'live' ? 'bg-ok' : 'bg-warn'}`} />
                {MODE === 'live' ? 'LIVE' : 'REPLAY'}
              </span>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
