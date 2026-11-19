// The approval card of `jirallm mcp` (an MCP App, text/html;profile=mcp-app): shows a proposed Jira change
// and makes it only when the person presses Approve (through the app-only tool jira_apply). Self-contained:
// the default MCP Apps CSP allows no external scripts or connections. Speaks the MCP Apps postMessage
// JSON-RPC protocol (ui/initialize, ui/notifications/tool-result, tools/call, ui/update-model-context).
export const APPROVAL_CARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>jirallm approval</title>
<style>
  :root { --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --line: #d0d7de; --box: #f6f8fa; --ok: #1a7f37; --bad: #cf222e; --btn: #1f6feb; --btn-fg: #ffffff; color-scheme: light; }
  :root[data-theme="dark"] { --bg: #1e1e1e; --fg: #e6edf3; --muted: #9198a1; --line: #3d444d; --box: #262a30; --ok: #3fb950; --bad: #f85149; --btn: #388bfd; --btn-fg: #0d1117; color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
  .head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .tag { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; }
  h1 { font-size: 15px; margin: 0; font-weight: 600; }
  pre { white-space: pre-wrap; word-break: break-word; background: var(--box); border: 1px solid var(--line); border-radius: 8px; padding: 10px; margin: 8px 0; max-height: 340px; overflow: auto; font: 12.5px/1.45 ui-monospace, Consolas, monospace; }
  details summary { cursor: pointer; color: var(--muted); font-size: 12.5px; }
  .actions { display: flex; gap: 8px; margin-top: 12px; align-items: center; flex-wrap: wrap; }
  button { font: inherit; border-radius: 8px; padding: 6px 14px; cursor: pointer; border: 1px solid var(--line); background: var(--box); color: var(--fg); }
  button.primary { background: var(--btn); border-color: var(--btn); color: var(--btn-fg); font-weight: 600; }
  button:disabled { opacity: .55; cursor: default; }
  .status { font-size: 13px; color: var(--muted); }
  .status.ok { color: var(--ok); } .status.bad { color: var(--bad); }
</style>
</head>
<body>
<div class="card">
  <div class="head"><span class="tag">jirallm · Jira change</span></div>
  <h1 id="title">Preparing the preview…</h1>
  <div id="bodyWrap" hidden><pre id="body"></pre></div>
  <details id="previewWrap" hidden><summary>What jirallm will send</summary><pre id="preview"></pre></details>
  <div class="actions">
    <button id="approve" class="primary" disabled>Approve</button>
    <button id="cancel" disabled>Cancel</button>
    <span id="status" class="status"></span>
  </div>
</div>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  let nextId = 1;
  const waiting = new Map();
  let approvalId = '';
  let title = '';
  const post = (m) => window.parent.postMessage(Object.assign({ jsonrpc: '2.0' }, m), '*');
  const request = (method, params) => new Promise((resolve, reject) => { const id = nextId++; waiting.set(id, { resolve, reject }); post({ id, method, params }); });
  const notify = (method, params) => post({ method, params });
  const setTheme = (ctx) => { const t = ctx && ctx.theme; if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; };
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';
  const status = (msg, kind) => { const s = $('status'); s.textContent = msg; s.className = 'status' + (kind ? ' ' + kind : ''); };
  const textOf = (r) => ((r && r.content) || []).filter((c) => c.type === 'text').map((c) => c.text).join('\\n');
  const done = () => { $('approve').disabled = true; $('cancel').disabled = true; };

  function show(result) {
    const sc = (result && result.structuredContent) || {};
    const meta = (result && result._meta) || {};
    approvalId = typeof meta.approvalId === 'string' ? meta.approvalId : '';
    title = sc.title || 'Jira change';
    $('title').textContent = title;
    if (typeof sc.body === 'string') { $('body').textContent = sc.body; $('bodyWrap').hidden = false; }
    if (sc.preview) { $('preview').textContent = sc.preview; $('previewWrap').hidden = false; if (typeof sc.body !== 'string') $('previewWrap').open = true; }
    if (result && result.isError) { status(textOf(result), 'bad'); done(); return; }
    if (!approvalId) { status(textOf(result)); done(); return; }
    $('approve').disabled = false; $('cancel').disabled = false;
  }

  async function act(tool, verb) {
    done();
    status(verb === 'approved' ? 'Writing to Jira…' : 'Cancelling…');
    let r;
    try { r = await request('tools/call', { name: tool, arguments: { id: approvalId } }); }
    catch (e) { status('Failed: ' + ((e && e.message) || e), 'bad'); return; }
    const msg = textOf(r);
    status(r && r.isError ? msg : verb === 'approved' ? '✓ ' + msg.split('\\n')[0] : msg, r && r.isError ? 'bad' : verb === 'approved' ? 'ok' : '');
    // Claude learns the outcome on its next turn.
    request('ui/update-model-context', { content: [{ type: 'text', text: 'jirallm approval card: the user ' + verb + ' "' + title + '". Result: ' + msg }] }).catch(() => {});
  }
  $('approve').onclick = () => act('jira_apply', 'approved');
  $('cancel').onclick = () => act('jira_cancel', 'cancelled');

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const m = e.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.id !== undefined && !m.method) {
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      if (m.error) w.reject(new Error(m.error.message || 'error')); else w.resolve(m.result);
      return;
    }
    if (m.id !== undefined) post({ id: m.id, result: {} }); // ping, teardown: nothing to clean up
    if (m.method === 'ui/notifications/tool-result') show(m.params);
    else if (m.method === 'ui/notifications/host-context-changed') setTheme(m.params);
  });

  new ResizeObserver(() => notify('ui/notifications/size-changed', { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })).observe(document.body);

  request('ui/initialize', { protocolVersion: '2026-01-26', clientInfo: { name: 'jirallm-approval-card', version: '1' }, appCapabilities: { availableDisplayModes: ['inline'] } })
    .then((r) => { setTheme(r && r.hostContext); notify('ui/notifications/initialized', {}); })
    .catch(() => status('This app cannot show the approval card.', 'bad'));
})();
</script>
</body>
</html>
`;
