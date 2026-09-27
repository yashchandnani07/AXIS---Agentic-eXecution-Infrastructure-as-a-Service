/**
 * @file      apps/orchestrator/src/lib/email.ts
 * @phase     P11+
 * @owner     Orchestration & Cloud
 * @purpose   Thin Resend email client — no SDK, just fetch. Sends incident alert emails with
 *            a GenAI-composed HTML body. Skips silently when RESEND_API_KEY is absent.
 * @depends   node fetch (Node 22 built-in)
 * @usedBy    routes/demo.ts (POST /api/demo/collapse)
 * @agentNotes Never throws — email failure must not break the demo flow. Logs to stderr only.
 */

export interface IncidentEmailPayload {
  /** Plain-text subject line composed by the AI narrative. */
  subject: string;
  /** Structured failure evidence for the body. */
  projectName: string;
  runId: string;
  provider: string;
  faultKey: string;
  probeStatus: number;
  probeBody: unknown;
  probeLatencyMs: number;
  endpoint: string;
  rootCause: string;
  remediationHint: string;
  /** ISO timestamp of the incident. */
  detectedAt: string;
  /** Bob's full narrative paragraph (pre-generated). */
  narrative: string;
}

/** Builds the HTML email body. No external templating — plain tagged-template. */
function buildHtml(p: IncidentEmailPayload): string {
  const statusColor = p.probeStatus >= 500 ? '#fa4d56' : p.probeStatus >= 400 ? '#f1c21b' : '#42be65';
  const providerLabel = p.provider === 'ibm-cloud' ? 'IBM Cloud Code Engine' : 'AWS Lambda';
  const providerColor = p.provider === 'ibm-cloud' ? '#78a9ff' : '#ff9900';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${p.subject}</title>
<style>
  body { margin:0; padding:0; background:#161616; font-family:'IBM Plex Sans',Arial,sans-serif; color:#f4f4f4; }
  .wrapper { max-width:600px; margin:32px auto; background:#262626; border-radius:12px; overflow:hidden; border:1px solid #393939; }
  .header { background:#0f62fe; padding:24px 28px; }
  .header h1 { margin:0; font-size:18px; font-weight:700; color:#fff; letter-spacing:-0.3px; }
  .header p { margin:6px 0 0; font-size:12px; color:rgba(255,255,255,0.75); font-family:'IBM Plex Mono',monospace; }
  .body { padding:24px 28px; }
  .alert-box { background:#fa4d561a; border:1px solid #fa4d5640; border-radius:8px; padding:14px 16px; margin-bottom:20px; }
  .alert-box .label { font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:#fa4d56; font-family:'IBM Plex Mono',monospace; font-weight:600; margin-bottom:6px; }
  .alert-box p { margin:0; font-size:13px; color:#f4f4f4; line-height:1.6; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:20px; }
  .stat { background:#393939; border-radius:6px; padding:10px 12px; }
  .stat .key { font-size:9px; text-transform:uppercase; letter-spacing:0.08em; color:#a8a8a8; font-family:'IBM Plex Mono',monospace; margin-bottom:3px; }
  .stat .val { font-size:14px; font-weight:700; font-family:'IBM Plex Mono',monospace; }
  .narrative { background:#1e1e2e; border:1px solid #be95ff40; border-radius:8px; padding:14px 16px; margin-bottom:20px; }
  .narrative .label { font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:#be95ff; font-family:'IBM Plex Mono',monospace; font-weight:600; margin-bottom:8px; }
  .narrative p { margin:0; font-size:12px; color:#c0c0d0; line-height:1.7; }
  .remediation { background:#f1c21b1a; border:1px solid #f1c21b40; border-radius:8px; padding:14px 16px; margin-bottom:20px; }
  .remediation .label { font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:#f1c21b; font-family:'IBM Plex Mono',monospace; font-weight:600; margin-bottom:6px; }
  .remediation p { margin:0; font-size:12px; color:#f4f4f4; line-height:1.6; }
  .probe-body { background:#161616; border-radius:6px; padding:10px 12px; font-family:'IBM Plex Mono',monospace; font-size:11px; color:#a8a8a8; word-break:break-all; margin-bottom:20px; }
  .footer { border-top:1px solid #393939; padding:16px 28px; font-size:10px; color:#6f6f6f; font-family:'IBM Plex Mono',monospace; }
  .footer a { color:#78a9ff; text-decoration:none; }
  a { color:#78a9ff; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <h1>🚨 AXIS Incident Alert — ${p.projectName}</h1>
    <p>Run ${p.runId} · Detected ${new Date(p.detectedAt).toUTCString()}</p>
  </div>
  <div class="body">

    <div class="alert-box">
      <div class="label">Failure Summary</div>
      <p>${p.rootCause}</p>
    </div>

    <div class="grid">
      <div class="stat">
        <div class="key">Provider</div>
        <div class="val" style="color:${providerColor}">${providerLabel}</div>
      </div>
      <div class="stat">
        <div class="key">HTTP Status</div>
        <div class="val" style="color:${statusColor}">HTTP ${p.probeStatus || 'ERR'}</div>
      </div>
      <div class="stat">
        <div class="key">Latency</div>
        <div class="val" style="color:#f4f4f4">${p.probeLatencyMs} ms</div>
      </div>
      <div class="stat">
        <div class="key">Fault Injected</div>
        <div class="val" style="color:#fa4d56; font-size:11px">${p.faultKey} removed</div>
      </div>
    </div>

    <div class="narrative">
      <div class="label">◆ IBM Granite AI Analysis (watsonx.ai)</div>
      <p>${p.narrative.replace(/\*\*/g, '').replace(/\n/g, '<br/>')}</p>
    </div>

    <div class="remediation">
      <div class="label">Recommended Action</div>
      <p>${p.remediationHint}</p>
    </div>

    <div style="margin-bottom:12px;">
      <div class="key" style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#a8a8a8;font-family:'IBM Plex Mono',monospace;margin-bottom:6px;">
        Raw Probe Response
      </div>
      <div class="probe-body">${JSON.stringify(p.probeBody, null, 2).slice(0, 600)}</div>
    </div>

    ${p.endpoint ? `<p style="font-size:11px;color:#a8a8a8;font-family:'IBM Plex Mono',monospace;">
      Endpoint: <a href="${p.endpoint}">${p.endpoint}</a>
    </p>` : ''}

  </div>
  <div class="footer">
    Sent by AXIS · Agentic eXecution Infrastructure · Powered by IBM Bob 2.0 &amp; watsonx.ai<br/>
    To resolve this incident, approve the remediation in the
    <a href="http://localhost:3000">AXIS Control Center</a>.
  </div>
</div>
</body>
</html>`;
}

/** Send an incident alert email via Resend. Returns true on success, false (never throws) on failure. */
export async function sendIncidentEmail(
  apiKey: string,
  from: string,
  to: string[],
  payload: IncidentEmailPayload,
): Promise<boolean> {
  if (!apiKey || to.length === 0) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject: payload.subject,
        html: buildHtml(payload),
        text: [
          `AXIS Incident Alert — ${payload.projectName} (Run ${payload.runId})`,
          '',
          payload.subject,
          '',
          `Provider: ${payload.provider === 'ibm-cloud' ? 'IBM Cloud Code Engine' : 'AWS Lambda'}`,
          `HTTP Status: ${payload.probeStatus || 'ERR'} — Latency: ${payload.probeLatencyMs}ms`,
          `Fault injected: ${payload.faultKey} removed`,
          '',
          'ROOT CAUSE',
          payload.rootCause,
          '',
          'AI ANALYSIS (IBM Granite · watsonx.ai)',
          payload.narrative.replace(/\*\*/g, ''),
          '',
          'RECOMMENDED ACTION',
          payload.remediationHint,
          '',
          `Endpoint: ${payload.endpoint}`,
          `Probe response: ${JSON.stringify(payload.probeBody).slice(0, 300)}`,
          '',
          'Resolve via AXIS Control Center: http://localhost:3000',
        ].join('\n'),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[email] Resend error ${res.status}: ${body}`);
      return false;
    }
    console.error(`[email] Incident alert sent to ${to.join(', ')}`);
    return true;
  } catch (err) {
    console.error('[email] Failed to send incident alert:', err instanceof Error ? err.message : err);
    return false;
  }
}
