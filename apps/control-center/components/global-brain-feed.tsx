/**
 * @file      apps/control-center/components/global-brain-feed.tsx
 * @phase     P11+
 * @owner     Product & Experience
 * @purpose   Cross-run real-time event feed on the home page. Uses SSE to push new events live.
 *            Shows every Bob OBSERVATION/INFERENCE/PROPOSAL/ACTION/VERIFICATION across all runs.
 *            This is the "WOW" live scroll — judges watch Bob think across every stage in real time.
 * @depends   react, clsx, @bobops/core, @/lib/api, @/lib/format
 * @usedBy    app/page.tsx (🧠 Live Feed tab)
 * @agentNotes Polls /api/runs to get all events, refreshed on every SSE push. Caps at 120 events (perf).
 */
'use client';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import type { Run, RunEvent } from '@bobops/core';
import { api, subscribeEvents } from '@/lib/api';
import { fmtTime } from '@/lib/format';

// ── Label styles (mirrors brain-feed.tsx but self-contained) ─────────────────
const KIND: Record<string, { label: string; bg: string; text: string }> = {
  observation:  { label: 'OBS',    bg: 'bg-info/10 border-info/30',   text: 'text-info' },
  inference:    { label: 'INFER',  bg: 'bg-bob/10 border-bob/30',     text: 'text-bob' },
  proposal:     { label: 'PROP',   bg: 'bg-warn/10 border-warn/30',   text: 'text-warn' },
  action:       { label: 'ACTION', bg: 'bg-ibm/10 border-ibm/30',     text: 'text-ibm-soft' },
  verification: { label: 'VERIFY', bg: 'bg-ok/10 border-ok/30',       text: 'text-ok' },
};

const ACTOR_COLOR: Record<string, string> = {
  bob:               'text-bob',
  human:             'text-fg font-semibold',
  orchestrator:      'text-ibm-soft',
  sentinel:          'text-warn',
  'provider:ibm-cloud': 'text-ibm-soft',
  'provider:aws':    'text-aws',
};

const ACTOR_LABEL: Record<string, string> = {
  bob:               '◆ Bob',
  human:             '● Human',
  orchestrator:      '▣ Orch',
  sentinel:          '⏱ Sentinel',
  'provider:ibm-cloud': '☁ IBM',
  'provider:aws':    '⚡ AWS',
};

type Filter = 'all' | 'bob' | 'human' | 'sentinel';

interface EnrichedEvent extends RunEvent { projectName: string }

function buildEvents(runs: Run[], allEvents: RunEvent[]): EnrichedEvent[] {
  const nameMap = new Map(runs.map((r) => [r.id, r.projectName]));
  return allEvents.map((e) => ({ ...e, projectName: nameMap.get(e.runId) ?? e.runId.slice(0, 8) }));
}

export function GlobalBrainFeed() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<EnrichedEvent[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [paused, setPaused] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  // Load all events from all runs
  async function loadAll() {
    try {
      const rs = await api.listRuns();
      setRuns(rs);
      // Collect events from all run aggregates in parallel (cap at 5 most recent)
      const recent = rs.slice(0, 5);
      const aggs = await Promise.all(recent.map((r) => api.getRun(r.id).catch(() => null)));
      const allEvts: RunEvent[] = [];
      for (const agg of aggs) if (agg) allEvts.push(...agg.events);
      allEvts.sort((a, b) => a.at.localeCompare(b.at));
      const enriched = buildEvents(rs, allEvts).slice(-120);
      setEvents(enriched);
      if (!pausedRef.current) {
        setTimeout(() => {
          const el = scrollRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        }, 50);
      }
    } catch {
      // silent — no orchestrator connected
    }
  }

  useEffect(() => {
    void loadAll();
    const unsub = subscribeEvents(() => {
      if (!pausedRef.current) {
        void loadAll();
      } else {
        setNewCount((n) => n + 1);
      }
    });
    const poll = setInterval(() => void loadAll(), 8_000);
    return () => { unsub(); clearInterval(poll); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resume() {
    setPaused(false);
    setNewCount(0);
    void loadAll();
  }

  const filtered = filter === 'all' ? events : events.filter((e) => e.actor === filter || (filter === 'sentinel' && e.actor === 'sentinel'));

  // Stats
  const counts = events.reduce((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="rounded-xl border border-line bg-layer overflow-hidden flex flex-col h-[640px]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-5 py-3 bg-canvas/80">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-bob animate-pulse" />
            <h2 className="text-sm font-semibold text-fg">🧠 Bob&apos;s Brain — Live Event Feed</h2>
          </div>
          <span className="text-[10px] font-mono text-muted border border-line bg-layer-2 px-2 py-0.5 rounded hidden sm:block">
            SSE · real-time · all runs
          </span>
        </div>
        <div className="flex items-center gap-2">
          {paused && newCount > 0 && (
            <button
              onClick={resume}
              className="flex items-center gap-1.5 rounded-full bg-bob/20 border border-bob/40 px-3 py-1 text-[11px] font-mono text-bob animate-pulse cursor-pointer hover:bg-bob/30 transition-colors"
            >
              ↓ {newCount} new events — click to resume
            </button>
          )}
          <button
            onClick={() => { paused ? resume() : setPaused(true); }}
            className={clsx(
              'rounded border px-2.5 py-1 text-[10px] font-mono transition-colors cursor-pointer',
              paused ? 'border-warn/40 text-warn bg-warn/10 hover:bg-warn/20' : 'border-line text-muted hover:text-fg hover:border-line-strong',
            )}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-line bg-canvas/40 overflow-x-auto">
        {Object.entries(KIND).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5 shrink-0">
            <span className={clsx('rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold', v.bg, v.text)}>
              {v.label}
            </span>
            <span className="text-fg font-mono text-[10px]">{counts[k] ?? 0}</span>
          </span>
        ))}
        <div className="flex-1" />
        <span className="text-[10px] font-mono text-muted shrink-0">{events.length} events · {runs.length} run(s)</span>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-line">
        {(['all', 'bob', 'human', 'sentinel'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={clsx(
              'rounded-full px-3 py-0.5 text-[10px] font-mono font-medium transition-all cursor-pointer border',
              filter === f
                ? f === 'bob' ? 'bg-bob/20 text-bob border-bob/40'
                  : f === 'human' ? 'bg-layer-2 text-fg border-line-strong'
                  : f === 'sentinel' ? 'bg-warn/15 text-warn border-warn/40'
                  : 'bg-layer text-fg border-line'
                : 'bg-transparent text-muted border-transparent hover:border-line hover:text-fg',
            )}
          >
            {f === 'all' ? `All (${events.length})` : f === 'bob' ? `◆ Bob (${events.filter((e) => e.actor === 'bob').length})` : f === 'human' ? `● Human (${events.filter((e) => e.actor === 'human').length})` : `⏱ Sentinel (${events.filter((e) => e.actor === 'sentinel').length})`}
          </button>
        ))}
      </div>

      {/* Event scroll */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-px"
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (atBottom && paused) resume();
        }}
      >
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
            <div className="h-12 w-12 rounded-xl bg-layer-2 border border-line flex items-center justify-center text-2xl">🧠</div>
            <p className="text-sm font-semibold text-fg">Waiting for Bob to think…</p>
            <p className="text-xs text-muted max-w-xs leading-relaxed">
              Start a deployment from IBM Bob using{' '}
              <code className="rounded bg-layer-2 px-1.5 py-0.5 font-mono text-bob text-[11px]">/deploy apps/demo-service</code>{' '}
              in the <strong className="text-bob">🛰️ Multi-Cloud DevOps Engineer</strong> mode. Events will appear here live.
            </p>
          </div>
        ) : (
          filtered.map((e) => {
            const k = KIND[e.kind] ?? KIND.observation;
            const actorColor = ACTOR_COLOR[e.actor] ?? 'text-muted';
            const actorLabel = ACTOR_LABEL[e.actor] ?? e.actor;
            const text = e.message.replace(/^[a-z-]+:\s/, '');
            return (
              <div
                key={e.id}
                className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-layer-2/50 transition-colors group"
              >
                {/* Time */}
                <span className="text-[9px] font-mono text-muted/60 whitespace-nowrap mt-0.5 w-16 shrink-0">
                  {fmtTime(e.at)}
                </span>
                {/* Kind badge */}
                <span className={clsx('rounded border px-1.5 py-px font-mono text-[9px] font-bold shrink-0 mt-0.5', k.bg, k.text)}>
                  {k.label}
                </span>
                {/* Actor */}
                <span className={clsx('text-[9px] font-mono shrink-0 w-16 mt-0.5 truncate', actorColor)}>
                  {actorLabel}
                </span>
                {/* Project tag */}
                <span className="text-[9px] font-mono text-muted/60 shrink-0 mt-0.5 hidden sm:block w-20 truncate" title={e.runId}>
                  {e.projectName}
                </span>
                {/* Message */}
                <span className="text-xs text-fg leading-relaxed break-words min-w-0 flex-1">{text}</span>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-line bg-canvas/60 px-5 py-2 flex items-center justify-between text-[10px] font-mono text-muted">
        <span>
          IBM Bob evidence standard — every event labelled OBSERVATION · INFERENCE · PROPOSAL · ACTION · VERIFICATION
        </span>
        <span>{filtered.length} shown</span>
      </div>
    </div>
  );
}
