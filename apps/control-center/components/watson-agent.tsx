/**
 * @file      apps/control-center/components/watson-agent.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   Interactive AI Assistant powered by IBM watsonx.ai (IBM Granite).
 *            Allows users to query database status, deployment topology, recovery logs, and live telemetry.
 * @depends   react, @/lib/api, clsx
 * @usedBy    app/page.tsx, app/run/page.tsx
 */
'use client';
import { useState } from 'react';
import clsx from 'clsx';
import { api } from '@/lib/api';

interface ChatMessage {
  id: string;
  sender: 'user' | 'watson';
  text: string;
  time: string;
  model?: string;
  suggestedQuestions?: string[];
}

const DEFAULT_PROMPTS = [
  'What is the status and schema of our IBM Cloudant database?',
  'Explain how Bob diagnosed and recovered the 503 incident',
  'What is the public endpoint of the live AWS Lambda service?',
  'How does AXIS enforce cryptographic human approval gates?',
];

export function WatsonAgent({ runId }: { runId?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'watson',
      text: 'Hello! I am the **AXIS Watson Agent**, powered by **IBM watsonx.ai & IBM Granite**. Ask me anything about your IBM Cloudant database, live AWS Lambda endpoints, Bob\'s autonomous self-healing runs, or multi-cloud architecture.',
      time: 'Just now',
      model: 'ibm/granite-3-8b-instruct',
      suggestedQuestions: DEFAULT_PROMPTS,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSend(questionText: string) {
    const q = questionText.trim();
    if (!q || loading) return;

    const userMsg: ChatMessage = {
      id: String(Date.now()),
      sender: 'user',
      text: q,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await api.askWatson(q, runId);
      const botMsg: ChatMessage = {
        id: String(Date.now() + 1),
        sender: 'watson',
        text: res.answer,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        model: res.model,
        suggestedQuestions: res.suggestedQuestions,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: String(Date.now() + 1),
        sender: 'watson',
        text: `Error connecting to Watson Agent: ${err instanceof Error ? err.message : String(err)}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-layer flex flex-col h-[520px] overflow-hidden shadow-2xl">
      {/* Agent Header */}
      <header className="border-b border-line bg-canvas/80 px-5 py-3.5 flex items-center justify-between backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-bob/15 border border-bob/40 flex items-center justify-center font-mono text-sm font-semibold text-bob shadow-inner">
            W/
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-fg">Watson Agent</h3>
              <span className="rounded-full bg-ok/15 text-ok border border-ok/30 px-2 py-0.2 font-mono text-[10px] font-medium flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse" />
                Live
              </span>
            </div>
            <p className="text-[11px] text-muted">IBM watsonx.ai Foundation Model Copilot</p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <span className="rounded bg-layer-2 px-2.5 py-1 font-mono text-[11px] text-muted border border-line">
            Model: <strong className="text-bob font-medium">IBM Granite 3-8B</strong>
          </span>
        </div>
      </header>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 font-sans text-sm">
        {messages.map((m) => (
          <div key={m.id} className={clsx('flex flex-col', m.sender === 'user' ? 'items-end' : 'items-start')}>
            <div className="flex items-center gap-2 mb-1 px-1">
              <span className="text-[11px] font-medium text-muted">
                {m.sender === 'user' ? 'You' : 'Watson Agent'}
              </span>
              <span className="text-[10px] text-muted/70 font-mono">{m.time}</span>
              {m.model && (
                <span className="text-[10px] text-bob/80 font-mono bg-bob/10 px-1.5 py-0.2 rounded border border-bob/20">
                  {m.model}
                </span>
              )}
            </div>
            <div
              className={clsx(
                'rounded-2xl px-4 py-3 max-w-[85%] leading-relaxed text-xs sm:text-sm shadow-sm',
                m.sender === 'user'
                  ? 'bg-ibm text-white rounded-tr-none'
                  : 'bg-layer-2 border border-line text-fg rounded-tl-none space-y-2'
              )}
            >
              <div className="whitespace-pre-wrap font-sans">{m.text}</div>
            </div>

            {/* Suggested quick follow-up questions */}
            {m.suggestedQuestions && m.suggestedQuestions.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5 max-w-[90%]">
                {m.suggestedQuestions.map((sq) => (
                  <button
                    key={sq}
                    onClick={() => handleSend(sq)}
                    disabled={loading}
                    className="rounded-full border border-line-strong/60 bg-canvas/70 hover:bg-bob/10 hover:border-bob/50 hover:text-bob text-[11px] text-muted px-3 py-1 transition-all text-left shadow-sm active:scale-98"
                  >
                    💬 {sq}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted font-mono bg-layer-2/50 border border-line px-3.5 py-2.5 rounded-xl w-fit animate-pulse">
            <span className="h-2 w-2 rounded-full bg-bob animate-ping" />
            Watson is querying IBM watsonx.ai & live infrastructure state…
          </div>
        )}
      </div>

      {/* Input Box */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend(input);
        }}
        className="border-t border-line bg-canvas p-3 flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Watson about IBM Cloudant DB, deployment endpoints, incidents, or costs…"
          className="flex-1 rounded-lg border border-line bg-layer px-4 py-2.5 text-xs sm:text-sm text-fg placeholder:text-muted/60 focus:outline-none focus:border-bob transition-colors font-sans"
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="rounded-lg bg-ibm hover:bg-ibm/90 disabled:opacity-40 disabled:hover:bg-ibm text-white px-5 py-2.5 text-xs sm:text-sm font-medium transition-all flex items-center gap-1.5 cursor-pointer shadow-md"
        >
          <span>Send</span>
          <span>→</span>
        </button>
      </form>
    </div>
  );
}
