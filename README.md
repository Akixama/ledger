# Ledger

**Code that cites its sources.**

Ledger is a DataHub-native code generation agent. Before it writes a single line of SQL, dbt, or pipeline code, it reads your *real* schemas, lineage, and ownership straight from DataHub — then shows you the receipt for exactly which fact justified which line.

Built for **Build with DataHub: The Agent Hackathon** — Track 2, *Metadata-Aware Code Generation*.

---

## The problem

Most AI codegen tools guess at your schema. They hallucinate a column that was renamed six months ago, assume a join key that doesn't exist, and the failure shows up in CI — or worse, in production. Data engineers don't trust code they can't audit.

## What Ledger does

1. **Connects** to a live MCP Server exposing DataHub's metadata graph
2. **Searches** the real catalog for the relevant dataset
3. **Pulls the actual schema** — not a memorized guess — via `get_dataset_schema`
4. **Generates code grounded in that schema**, with every column/table reference cited back to where it came from in DataHub
5. **Shows its work** in a "receipt" panel, so a reviewer can verify every line before merging

## What's in this repo

A single-page site (`index.html` / `styles.css` / `script.js`, no build step, no framework) that does two things:

- **A scripted hero demo** — a typewriter-animated example of the generation → citation flow, so the concept is visible immediately without any setup
- **A real, working MCP client** — the "Connect DataHub" section performs an actual MCP JSON-RPC 2.0 handshake (`initialize` → `tools/list`) against a live MCP Server, then a real `search` → `get_dataset_schema` → Claude API call to generate a grounded SQL query with live citations

This isn't a mockup of the idea. The wiring in `script.js` is the real protocol, tested end-to-end against a local DataHub instance running the `showcase-ecommerce` sample dataset.

## Running it locally

You'll need:
- [DataHub](https://docs.datahub.com) running locally (`pip install acryl-datahub && datahub docker quickstart`)
- [`mcp-proxy`](https://github.com/sparfenyuk/mcp-proxy) and [`uv`](https://github.com/astral-sh/uv) (`pip install mcp-proxy uv`)
- Python 3, for a static file server

**1. Bridge `mcp-server-datahub` to HTTP:**
```bash
mcp-proxy --port 8008 --allow-origin "*" \
  -e DATAHUB_GMS_URL "http://localhost:8080" \
  -e DATAHUB_GMS_TOKEN "" \
  -- uvx mcp-server-datahub@latest
```

**2. Serve this site:**
```bash
python -m http.server 5500
```

**3. Open `http://localhost:5500`**, scroll to **Connect DataHub**, enter `http://localhost:8008/mcp`, and connect.

**4.** Click **Generate real query from this schema** and paste an Anthropic API key when prompted (see [Known limitations](#known-limitations) below on why this is a manual prompt rather than baked in).

## Architecture

```
Browser (this site)
   │
   │  MCP JSON-RPC 2.0 (streamable HTTP)
   ▼
mcp-proxy  ──stdio──▶  mcp-server-datahub
                            │
                            │  GMS REST API
                            ▼
                       DataHub (Docker: GMS, MySQL, Kafka, OpenSearch)
```

`mcp-server-datahub` speaks MCP over stdio by default; `mcp-proxy` bridges it to a browser-reachable HTTP endpoint with CORS enabled, which is what this landing page's client (`script.js`) talks to directly.

## Known limitations

- **Live generation is cost-gated by design.** The "Generate" button calls the Anthropic API directly from the browser and asks for your own API key via a prompt — it's never hardcoded or stored. This keeps the repo free to run and avoids embedding any credential in client-side code (a real security risk if this were deployed publicly as-is). For a production version, this call should go through a small backend proxy instead of a direct browser-to-Anthropic call.
- **`datahub datapack load` fails on native Windows.** The CLI's sample-data loader passes a Windows-style path (e.g. `C:\Users\...`) through a URI parser that interprets the drive letter `C` as a URI scheme, throwing `KeyError: 'Did not find a registered class for c'`. This is a Windows-path-handling bug in the `datahub` CLI itself, not specific to this project. Workaround: run `datahub init` and `datahub datapack load showcase-ecommerce` from **WSL** instead of native Windows `cmd`/PowerShell — Docker Desktop shares its network with WSL2, so `localhost:8080` still resolves correctly and the path bug never triggers.
- **Direct browser-to-MCP-server calls require CORS.** `mcp-proxy --allow-origin "*"` is fine for local development; DataHub Cloud's hosted MCP endpoint requires an OAuth + Dynamic Client Registration flow instead of a raw Bearer token, which this simple client doesn't implement. A production integration would route through a backend.
- **Tool name assumptions.** The live-generation code assumes tools named `search` and `get_dataset_schema` exist on the connected MCP server. Both are logged to the browser console (`[Ledger] Available MCP tools:`) on every successful connection so this can be verified/adjusted against any given DataHub MCP Server version.

## Tech

Plain HTML/CSS/JS — no build step, no dependencies to install for the frontend itself. Fonts: Spectral (display), Inter (body), JetBrains Mono (utility/code). Talks to `mcp-server-datahub` over MCP, and to the Anthropic API for generation.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
