// ============================================
// LEDGER — interaction layer
// 1. Receipt date stamp
// 2. Typewriter code demo synced with citation entries
// 3. Scroll-triggered stamp + line-item reveals
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  setReceiptDate();
  runDemo();
  observeReveals();
  wireConnectForm();
  wireGenerateButton();
});

function setReceiptDate(){
  const el = document.getElementById('receipt-date');
  if(!el) return;
  const now = new Date();
  el.textContent = now.toISOString().slice(0,16).replace('T',' ') + ' UTC';
}

// ---------- Hero demo: typewriter + citations ----------
const DEMO_LINES = [
  { text: 'SELECT o.order_id,', cite: null },
  { text: '       c.customer_ltv_score', cite: 'customer_ltv_score', note: 'Column confirmed in marts.customer_summary — DataHub schema, updated 2d ago.' },
  { text: 'FROM   analytics.orders o', cite: 'analytics.orders', note: 'Table exists. Owner: data-platform@ team (from DataHub ownership).' },
  { text: 'JOIN   marts.customer_summary c', cite: null },
  { text: '  ON   o.customer_id = c.customer_id', cite: 'o.customer_id = c.customer_id', note: 'Join key matches DataHub lineage: orders → customer_summary.' },
];

function runDemo(){
  const codePane = document.getElementById('code-pane');
  const citationPane = document.getElementById('citation-pane');
  if(!codePane || !citationPane) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if(reduce){
    codePane.textContent = DEMO_LINES.map(l => l.text).join('\n');
    DEMO_LINES.filter(l => l.note).forEach(l => citationPane.appendChild(makeCitation(l)));
    return;
  }

  let lineIndex = 0;

  function typeLine(){
    if(lineIndex >= DEMO_LINES.length){
      // loop after a pause
      setTimeout(() => {
        codePane.textContent = '';
        citationPane.innerHTML = '';
        lineIndex = 0;
        typeLine();
      }, 3200);
      return;
    }

    const line = DEMO_LINES[lineIndex];
    let charIndex = 0;
    const prefix = codePane.textContent ? codePane.textContent + '\n' : '';

    const typer = setInterval(() => {
      charIndex++;
      codePane.textContent = prefix + line.text.slice(0, charIndex);
      if(charIndex >= line.text.length){
        clearInterval(typer);
        if(line.note){
          citationPane.appendChild(makeCitation(line));
        }
        lineIndex++;
        setTimeout(typeLine, 260);
      }
    }, 18);
  }

  typeLine();
}

function makeCitation(line){
  const div = document.createElement('div');
  div.className = 'citation-entry';
  const b = document.createElement('b');
  b.textContent = line.cite;
  div.appendChild(b);
  div.appendChild(document.createTextNode(line.note));
  return div;
}

// ---------- Scroll-triggered reveals (line items, ledger rows, stamps) ----------
function observeReveals(){
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const items = document.querySelectorAll('[data-reveal]');
  const stamps = document.querySelectorAll('[data-stamp]');

  if(reduce){
    items.forEach(el => el.classList.add('in-view'));
    stamps.forEach(el => { el.style.opacity = 1; el.style.scale = 1; });
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        entry.target.classList.add('in-view');
        const stamp = entry.target.querySelector('[data-stamp]');
        if(stamp) setTimeout(() => stamp.classList.add('stamp-in'), 220);
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });

  items.forEach(el => io.observe(el));

  // problem section's stamp isn't inside a [data-reveal] wrapper
  const brokenStamp = document.querySelector('.broken-head [data-stamp]');
  if(brokenStamp){
    const io2 = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if(entry.isIntersecting){
          setTimeout(() => brokenStamp.classList.add('stamp-in'), 300);
          io2.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    io2.observe(brokenStamp.closest('.broken-receipt'));
  }
}

// ============================================
// LIVE MCP CONNECTION
// Speaks real MCP JSON-RPC 2.0 over the streamable-HTTP transport:
//   1. "initialize"            — protocol + capability handshake
//   2. "notifications/initialized" — fire-and-forget, per spec
//   3. "tools/list"            — ask the server what it can do
// Works against any spec-compliant MCP endpoint, e.g.:
//   https://mcp.datahub.com/mcp          (DataHub Cloud, shared)
//   https://<tenant>.acryl.io/integrations/ai/mcp
//   http://localhost:8080/mcp            (self-hosted mcp-server-datahub)
// Browser-direct calls only succeed if the server sends CORS headers —
// most local/dev servers do, DataHub Cloud requires the OAuth+DCR flow
// described in its docs, which this simple form doesn't perform.
// ============================================

let mcpRequestId = 1;

async function mcpCall(endpoint, token, method, params, sessionId){
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if(token) headers['Authorization'] = `Bearer ${token}`;
  if(sessionId) headers['Mcp-Session-Id'] = sessionId;

  const body = { jsonrpc: '2.0', method, params: params || {} };
  if(method !== 'notifications/initialized'){
    body.id = mcpRequestId++;
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const returnedSessionId = res.headers.get('mcp-session-id') || sessionId || null;

  if(!res.ok){
    let detail = '';
    try{ detail = await res.text(); }catch(e){}
    const err = new Error(`Server responded ${res.status} ${res.statusText}${detail ? ' — ' + detail.slice(0,200) : ''}`);
    err.sessionId = returnedSessionId;
    throw err;
  }

  // notifications get no body back
  if(body.id === undefined) return { result: null, sessionId: returnedSessionId };

  const contentType = res.headers.get('content-type') || '';
  let parsed;
  if(contentType.includes('text/event-stream')){
    const raw = await res.text();
    const dataLine = raw.split('\n').find(l => l.startsWith('data:'));
    if(!dataLine) throw new Error('Malformed SSE response from MCP server');
    parsed = JSON.parse(dataLine.slice(5).trim());
  } else {
    parsed = await res.json();
  }
  return { result: parsed, sessionId: returnedSessionId };
}

function wireConnectForm(){
  const form = document.getElementById('connect-form');
  if(!form) return;

  const urlInput = document.getElementById('mcp-url');
  const tokenInput = document.getElementById('mcp-token');
  const btn = document.getElementById('connect-btn');
  const receipt = document.getElementById('connect-receipt');
  const log = document.getElementById('connect-log');
  const target = document.getElementById('connect-target');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    let endpoint = urlInput.value.trim();
    const token = tokenInput.value.trim();
    if(!endpoint) return;

    // Be forgiving about missing scheme — "localhost:8080/mcp" or a bare
    // "mcp.datahub.com/mcp" are both realistic things to paste here, and
    // both throw inside new URL() without a leading http(s)://.
    if(!/^https?:\/\//i.test(endpoint)){
      endpoint = 'http://' + endpoint;
    }

    let host;
    try{
      host = new URL(endpoint).host;
    } catch(urlErr){
      receipt.hidden = false;
      log.innerHTML = '';
      target.textContent = '';
      logLine('Invalid MCP Server URL', 'err', 'Enter a full URL, e.g. https://mcp.datahub.com/mcp or http://localhost:8080/mcp.');
      return;
    }

    receipt.hidden = false;
    log.innerHTML = '';
    target.textContent = host;
    btn.disabled = true;
    btn.textContent = 'Connecting…';

    logLine('Opening MCP session…', 'pending');

    try{
      const initCall = await mcpCall(endpoint, token, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'ledger', version: '0.1.0' },
      });
      const sessionId = initCall.sessionId;
      const initResult = initCall.result;

      if(initResult && initResult.error){
        throw new Error(initResult.error.message || 'Server rejected initialize');
      }

      const serverName = initResult?.result?.serverInfo?.name || 'MCP server';
      logLine(`Handshake OK — connected to ${serverName}`, 'ok');

      // best-effort notification per MCP spec — servers may ignore the response
      mcpCall(endpoint, token, 'notifications/initialized', {}, sessionId).catch(() => {});

      logLine('Requesting available tools…', 'pending');
      const toolsCall = await mcpCall(endpoint, token, 'tools/list', {}, sessionId);
      const toolsResult = toolsCall.result;

      if(toolsResult && toolsResult.error){
        throw new Error(toolsResult.error.message || 'tools/list rejected');
      }

      const tools = toolsResult?.result?.tools || [];
      if(tools.length){
        logLine(`${tools.length} tool${tools.length === 1 ? '' : 's'} available`, 'ok');
        tools.slice(0, 6).forEach(t => {
          logLine(t.name, 'ok', t.description, { truncate: true });
        });
        // Full tool list (names + input schemas) for verifying the exact
        // names/arguments generateRealQuery() below assumes — check this
        // in DevTools if the live-generation call fails with "tool not found".
        console.log('[Ledger] Available MCP tools:', tools);

        lastMcpSession = { endpoint, token, sessionId };
        const generateRow = document.getElementById('generate-row');
        if(generateRow) generateRow.hidden = false;
      } else {
        logLine('Connected, but no tools were returned', 'pending');
      }

    } catch(err){
      logLine('Direct browser connection failed', 'err', explainError(err, endpoint));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Connect DataHub →';
    }
  });
}

const LOG_DETAIL_TRUNCATE_LEN = 120;

function truncateDetail(detail){
  if(!detail || detail.length <= LOG_DETAIL_TRUNCATE_LEN) return { short: detail, isTruncated: false };
  // cut at the last whitespace before the limit so we don't chop mid-word
  let cut = detail.slice(0, LOG_DETAIL_TRUNCATE_LEN);
  const lastSpace = cut.lastIndexOf(' ');
  if(lastSpace > 40) cut = cut.slice(0, lastSpace);
  return { short: cut + '…', isTruncated: true };
}

function logLine(message, status, detail, opts){
  const log = document.getElementById('connect-log');
  const row = document.createElement('div');
  row.className = 'log-line';
  const tagText = status === 'ok' ? 'OK' : status === 'err' ? 'FAILED' : '…';

  let detailHtml = '';
  if(detail){
    const shouldTruncate = opts && opts.truncate;
    const { short, isTruncated } = shouldTruncate ? truncateDetail(detail) : { short: detail, isTruncated: false };

    if(isTruncated){
      // full text lives in the title attribute (hover) and toggles open on click
      detailHtml = `<br><span class="log-detail" data-expanded="0" data-full="${escapeHtml(detail)}" data-short="${escapeHtml(short)}" title="Click to expand" style="color:#A6A190;font-size:0.78rem;cursor:pointer;">${escapeHtml(short)} <span style="text-decoration:underline;">more</span></span>`;
    } else {
      detailHtml = `<br><span style="color:#A6A190;font-size:0.78rem">${escapeHtml(detail)}</span>`;
    }
  }

  row.innerHTML = `<span class="log-msg">${escapeHtml(message)}${detailHtml}</span><span class="log-tag ${status}">${tagText}</span>`;

  const expandable = row.querySelector('.log-detail');
  if(expandable){
    expandable.addEventListener('click', () => {
      const expanded = expandable.dataset.expanded === '1';
      if(expanded){
        expandable.innerHTML = `${escapeHtml(expandable.dataset.short)} <span style="text-decoration:underline;">more</span>`;
        expandable.dataset.expanded = '0';
        expandable.title = 'Click to expand';
      } else {
        expandable.innerHTML = `${escapeHtml(expandable.dataset.full)} <span style="text-decoration:underline;">less</span>`;
        expandable.dataset.expanded = '1';
        expandable.title = 'Click to collapse';
      }
    });
  }

  log.appendChild(row);
}

function explainError(err, endpoint){
  const msg = (err && err.message) || String(err);
  if(msg.includes('Failed to fetch') || msg.includes('NetworkError')){
    return `Likely CORS: ${new URL(endpoint).host} didn't allow a direct browser request. Self-hosted mcp-server-datahub instances usually need CORS enabled; DataHub Cloud needs the OAuth+DCR flow instead of a raw Bearer token. Route this through your own backend for production use.`;
  }
  return msg;
}
function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================
// LIVE GENERATION — the codegen half, actually wired up
//
// Everything above this point proves the connection is real. This section
// closes the remaining gap: it pulls one REAL dataset schema from your live
// DataHub instance, then asks Claude to write a SQL statement using ONLY
// columns that schema actually contains, with citations back to it.
//
// ASSUMPTIONS TO VERIFY against your real server (check the
// console.log('[Ledger] Available MCP tools:', tools) output above):
//   - a tool named "search" accepting { query: <string> }
//   - a tool named "get_dataset_schema" accepting { urn: <string> }
// If your server names these differently, or expects different argument
// keys, adjust TOOL_SEARCH / TOOL_SCHEMA and the `arguments` objects below.
// ============================================

const TOOL_SEARCH = 'search';
const TOOL_SCHEMA = 'get_dataset_schema';

let lastMcpSession = null; // { endpoint, token, sessionId } — set after a successful connect

function wireGenerateButton(){
  const btn = document.getElementById('generate-btn');
  if(!btn) return;

  btn.addEventListener('click', async () => {
    if(!lastMcpSession){
      alert('Connect to a live MCP server first.');
      return;
    }

    // Kept in memory only for this call — never written to the page,
    // never logged, never saved. Get your own key from console.anthropic.com.
    // This demo calls the Anthropic API directly from the browser, which is
    // fine for a local hackathon demo but not something to ship publicly —
    // a real deployment should proxy this through a small backend instead.
    const apiKey = window.prompt('Anthropic API key (used only for this call, not stored):');
    if(!apiKey) return;

    const liveReceipt = document.getElementById('live-gen-receipt');
    const codePane = document.getElementById('live-code-pane');
    const citationPane = document.getElementById('live-citation-pane');
    const dateEl = document.getElementById('live-gen-date');

    liveReceipt.hidden = false;
    dateEl.textContent = new Date().toISOString().slice(0,16).replace('T',' ') + ' UTC';
    citationPane.innerHTML = '';
    codePane.textContent = 'Pulling a real dataset schema from DataHub…';

    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Generating…';

    try{
      const { endpoint, token, sessionId } = lastMcpSession;
      const { urn, schemaText } = await pullRealSchema(endpoint, token, sessionId);

      codePane.textContent = 'Asking Claude to write a query using only real columns…';
      const raw = await askClaudeForQuery(schemaText, apiKey);
      const { sql, citations } = parseGeneratedResponse(raw);

      codePane.textContent = sql || raw;

      if(citations.length){
        citations.forEach(c => citationPane.appendChild(makeCitation({ cite: c.label, note: c.note })));
      } else {
        citationPane.appendChild(makeCitation({ cite: 'Source dataset', note: urn }));
      }

    } catch(err){
      codePane.textContent = `Live generation failed: ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });
}

async function pullRealSchema(endpoint, token, sessionId){
  const searchCall = await mcpCall(endpoint, token, 'tools/call', {
    name: TOOL_SEARCH,
    arguments: { query: 'order' },
  }, sessionId);

  const searchResult = searchCall.result?.result;
  if(searchResult?.isError){
    throw new Error(`"${TOOL_SEARCH}" tool returned an error — check its real name/arguments in the console tool list`);
  }

  const searchText = extractToolText(searchResult);
  const urn = extractFirstUrn(searchText);
  if(!urn) throw new Error(`No dataset urn found in "${TOOL_SEARCH}" results — try a different query keyword`);

  const schemaCall = await mcpCall(endpoint, token, 'tools/call', {
    name: TOOL_SCHEMA,
    arguments: { urn },
  }, sessionId);

  const schemaResult = schemaCall.result?.result;
  if(schemaResult?.isError){
    throw new Error(`"${TOOL_SCHEMA}" tool returned an error for ${urn}`);
  }

  const schemaText = extractToolText(schemaResult);
  if(!schemaText) throw new Error(`No schema content returned for ${urn}`);

  return { urn, schemaText };
}

function extractToolText(mcpToolResult){
  // Standard MCP tool-call shape: { content: [{ type: 'text', text: '...' }, ...] }
  return (mcpToolResult?.content || []).map(c => c.text || '').join('\n');
}

function extractFirstUrn(text){
  const match = text.match(/urn:li:dataset:[^\s"'),]+/);
  return match ? match[0] : null;
}

async function askClaudeForQuery(schemaText, apiKey){
  const prompt = `You are generating exactly ONE SQL SELECT statement using ONLY the tables and columns present in the schema below. Do not invent any column or table that isn't listed.

DataHub schema (real, pulled live moments ago):
${schemaText}

Respond in exactly this format and nothing else:
SQL:
<the single select statement>
CITATIONS:
- <column or table name>: <one short sentence citing where in the schema above it came from>
- <repeat for each column/table used>`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if(!res.ok){
    const detail = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}${detail ? ' — ' + detail.slice(0,150) : ''}`);
  }

  const data = await res.json();
  return (data.content || []).map(b => b.text || '').join('\n');
}

function parseGeneratedResponse(raw){
  const sqlMatch = raw.match(/SQL:\s*([\s\S]*?)(?:\nCITATIONS:|$)/i);
  const citeMatch = raw.match(/CITATIONS:\s*([\s\S]*)/i);
  const sql = sqlMatch ? sqlMatch[1].trim() : '';
  const citations = [];
  if(citeMatch){
    citeMatch[1].split('\n').forEach(line => {
      const m = line.match(/^-?\s*([^:]+):\s*(.+)$/);
      if(m) citations.push({ label: m[1].trim(), note: m[2].trim() });
    });
  }
  return { sql, citations };
}