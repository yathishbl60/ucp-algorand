# Pay with Algorand — in 4 seconds, for $0.001

[![CI](https://img.shields.io/github/actions/workflow/status/yathishbl60/ucp-algorand/ci.yml?branch=main&label=CI)](https://github.com/yathishbl60/ucp-algorand/actions/workflows/ci.yml)
[![Node 22+](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**Accept ALGO and Algorand tokens in your store — no payment processor, no chargebacks, no KYC, no waiting days for settlement.**

Built on the [Universal Commerce Protocol (UCP)](https://ucp.dev) — the open standard that lets AI agents, apps, and wallets pay any compatible merchant without custom integrations.

---

## Why this beats the alternatives

| | **This project** | Coinbase Commerce | Stripe Crypto | PayPal Crypto |
|---|---|---|---|---|
| Settlement time | **~4 seconds** | Minutes–hours | Days | Days |
| Transaction fee | **< $0.001** | 1% | 1.5% | 1.5–3.5% |
| Chargebacks | **Impossible** | Possible | Possible | Possible |
| KYC required | **No** | Yes | Yes | Yes |
| AI agent native | **Yes** | No | No | No |
| Self-hosted | **Yes** | No | No | No |
| Open source | **Yes (Apache 2)** | No | No | No |

---

## The AI agent angle

AI agents are buying things right now. GPT plugins, Claude tools, AutoGPT workflows — they all need a way to pay for goods and services autonomously.

Traditional payment processors **don't work for agents**: they require user sessions, 2FA, card numbers, and human intervention at checkout.

This project implements the [UCP payment handler spec](https://ucp.dev/specification/overview), which is purpose-built for machine-to-machine commerce. An agent can:

1. Discover your store's payment capabilities with one HTTP request
2. Create a checkout session
3. Sign and submit an Algorand transaction from its wallet
4. Complete the checkout — fully autonomously, no human in the loop

See [`examples/ai_agent_checkout.ts`](examples/ai_agent_checkout.ts) for a working demo.

---

## 30-second quickstart

```bash
git clone https://github.com/yathishbl60/ucp-algorand.git
cd ucp-algorand
npm ci
cp .env.example .env
# Set ALGORAND_MERCHANT_ADDRESS in .env to your Algorand address
npm run dev
```

Your store is now live at `http://localhost:8000`.

Test it immediately:

```bash
curl http://localhost:8000/.well-known/ucp | jq
```

---

## How a payment works

```
Agent / Buyer app             This server                   Algorand blockchain
─────────────────             ───────────                   ──────────────────
GET /.well-known/ucp ──►  Returns assets + merchant addr
POST /checkout-sessions ──►  Creates session (pending)
                              ◄── session ID returned
[Sign + submit Algorand tx with session ID in note]  ──►  Confirmed in ~4s
POST /checkout-sessions/{id}/complete ──►  Verifies tx on-chain
                                           Amount ✓  Receiver ✓
                                           Asset ✓   Note ✓
                                           Session → complete ✓
```

---

## What you get

- **On-chain verification** — server checks receiver, amount, asset ID, and session ID in note. Fraudulent txids are rejected.
- **Double-spend protection** — a txid can only complete one order, ever.
- **4-second finality** — Algorand has immediate finality. No waiting for confirmations.
- **Near-zero fees** — Algorand transactions cost ~0.001 ALGO (~$0.001).
- **ALGO + stablecoins** — accepts native ALGO, USDC, USDt, and wrapped BTC/ETH.
- **Idempotent API** — safe to retry any request with `X-Idempotency-Key`.
- **Signed webhooks** — HMAC-SHA256 events to your order system on every state change.
- **AI-agent ready** — discovery + checkout designed for autonomous machine clients.

---

## Table of Contents

1. [Quick start (5 minutes)](#quick-start-5-minutes)
2. [All environment variables](#all-environment-variables)
3. [API reference](#api-reference)
4. [Supported assets](#supported-assets)
5. [Webhooks](#webhooks)
6. [Security features](#security-features)
7. [AI agent integration](#ai-agent-integration)
8. [Drop-in pay widget](#drop-in-pay-widget)
9. [Development commands](#development-commands)
10. [Architecture map](#architecture-map)
11. [Local end-to-end demo (TestNet)](#local-end-to-end-demo-testnet)
12. [Docker](#docker)
13. [CI / CD](#ci--cd)
14. [Roadmap](#roadmap)
15. [Production checklist](#production-checklist)
16. [Contributing](#contributing)
17. [License](#license)

---

## Quick start (5 minutes)

### Prerequisites

- Node.js ≥ 22 (`node --version`)
- An Algorand address to receive payments ([create one free](https://wallet.myalgo.com))

### 1. Clone and install

```bash
git clone https://github.com/yathishbl60/ucp-algorand.git
cd ucp-algorand
npm ci
```

### 2. Configure

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

```env
ALGORAND_NETWORK=testnet
ALGORAND_ALGOD_URL=https://testnet-api.algonode.cloud
ALGORAND_INDEXER_URL=https://testnet-idx.algonode.cloud
ALGORAND_MERCHANT_ADDRESS=YOUR_58_CHAR_ALGORAND_ADDRESS
UCP_BASE_URL=http://localhost:8000
```

> No API key required — Algonode public endpoints work out of the box.

### 3. Start the server

```bash
npm run dev
```

### 4. Verify

```bash
curl http://localhost:8000/health
curl http://localhost:8000/.well-known/ucp | jq
```

---

## All environment variables

### Required

| Variable | Description |
|---|---|
| `ALGORAND_NETWORK` | `testnet`, `mainnet`, or `betanet` |
| `ALGORAND_ALGOD_URL` | Algod node base URL |
| `ALGORAND_INDEXER_URL` | Indexer base URL |
| `ALGORAND_MERCHANT_ADDRESS` | Your 58-char Algorand address |
| `UCP_BASE_URL` | Public base URL of this server |

### Optional — server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `LOG_LEVEL` | `info` | `trace` / `debug` / `info` / `warn` / `error` |
| `NODE_ENV` | `development` | Set `production` for prod |
| `ALGORAND_MIN_CONFIRMATIONS` | `1` | Rounds before payment is final (1 ≈ 4 s) |
| `RATE_LIMIT_MAX` | `100` | Requests per window per IP |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window in ms |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins |

### Optional — webhooks (set both or neither)

| Variable | Description |
|---|---|
| `WEBHOOK_URL` | Your order system endpoint |
| `WEBHOOK_SECRET` | HMAC signing secret (min 16 chars) |

### Optional — store branding

| Variable | Description |
|---|---|
| `STORE_NAME` | Display name in UCP profile |
| `STORE_DESCRIPTION` | Short store description |
| `STORE_SUPPORT_EMAIL` | Support contact |
| `STORE_LOGO_URL` | Logo URL |

> Server validates all config at startup and exits with a clear message if anything is wrong.

---

## API reference

### Discovery

#### `GET /`

Returns service info and endpoint list.

#### `GET /.well-known/ucp`

Returns UCP profile: accepted assets, merchant address, optional branding.

<details>
<summary>Example response</summary>

```json
{
  "ucp": {
    "version": "2026-04-08",
    "payment_handlers": {
      "org.algorand.shopping.payment_handler": {
        "version": "2026-04-26",
        "available_instruments": [
          { "id": 0, "symbol": "ALGO", "name": "Algorand", "decimals": 6 },
          { "id": 10458941, "symbol": "USDC", "name": "USD Coin", "decimals": 6 }
        ],
        "merchant_address": "YOUR_MERCHANT_ADDRESS"
      }
    }
  }
}
```

</details>

### Health

#### `GET /health`

Liveness. Returns `200` when server is up.

#### `GET /ready`

Readiness. Verifies Algorand node reachable. Returns `503` if not (use for k8s probes).

### Checkout sessions

#### `POST /ucp/v1/checkout-sessions`

```
UCP-Agent: profile="https://your-platform.example/ucp-profile"
X-Idempotency-Key: <uuid>   (optional)
```

```json
{
  "line_items": [{ "id": "item-1", "description": "T-shirt (L)", "quantity": 1, "unit_price": 2000, "currency": "USD" }],
  "totals": { "subtotal": 2000, "tax": 0, "shipping": 0, "total": 2000, "currency": "USD" }
}
```

Returns `201` with session ID and payment instructions.

#### `GET /ucp/v1/checkout-sessions/:id`

Retrieve session.

#### `PATCH /ucp/v1/checkout-sessions/:id`

Update shipping/buyer info on a `pending` session.

#### `POST /ucp/v1/checkout-sessions/:id/complete`

```json
{ "payment_handler": "org.algorand.shopping.payment_handler", "txid": "ALGO_TX_ID" }
```

Server verifies on-chain, guards double-spend, marks complete, fires webhook.

#### `DELETE /ucp/v1/checkout-sessions/:id`

Cancel session.

### Error format

```json
{
  "ucp": {
    "status": "error",
    "messages": [{ "type": "error", "code": "PAYMENT_VERIFICATION_FAILED", "content": "Receiver mismatch", "severity": "unrecoverable" }]
  }
}
```

---

## Supported assets

### TestNet

| Symbol | ASA ID | Type |
|---|---|---|
| ALGO | 0 (native) | Native |
| USDC | 10458941 | Stablecoin |

### MainNet

| Symbol | ASA ID | Type |
|---|---|---|
| ALGO | 0 (native) | Native |
| USDC | 31566704 | Stablecoin |
| USDt | 312769 | Stablecoin |
| goBTC | 386192725 | Wrapped BTC |
| goETH | 386195940 | Wrapped ETH |

To add an asset: edit `src/algorand/assets.ts`. Profile, verifier, and routes update automatically.

---

## Webhooks

### Events

| Event | When |
|---|---|
| `checkout.created` | Session created |
| `checkout.updated` | Session patched |
| `checkout.completed` | Payment verified |
| `checkout.cancelled` | Session cancelled |
| `checkout.escalated` | Verification failed |

### Signature verification

```typescript
import { createHmac } from "node:crypto";

function verifyWebhook(rawBody: string, secret: string, header: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  return header === expected;
}
```

Retries up to 3× with exponential backoff.

---

## Security features

| Feature | Detail |
|---|---|
| On-chain verification | Receiver, amount, asset, note field all checked |
| Double-spend protection | Txid can complete exactly one session |
| Idempotency | `X-Idempotency-Key` — safe to retry |
| Rate limiting | Per-IP via `@fastify/rate-limit` |
| Secure headers | HSTS, CSP, X-Frame-Options via `@fastify/helmet` |
| Signed webhooks | HMAC-SHA256 on every outgoing event |
| Config guard | Server exits on bad config — no silent misconfigurations |
| Body size limit | 1 MB cap |

---

## AI agent integration

This server speaks the UCP protocol, which is designed for autonomous agents.

See [`examples/ai_agent_checkout.ts`](examples/ai_agent_checkout.ts) for a full working example. The pattern is:

```typescript
// 1. Agent discovers what the merchant accepts
const profile = await fetch("https://merchant.example.com/.well-known/ucp").then(r => r.json());

// 2. Agent creates a checkout
const session = await fetch("https://merchant.example.com/ucp/v1/checkout-sessions", {
  method: "POST",
  headers: { "UCP-Agent": 'profile="https://agent.example.com/profile"', "Content-Type": "application/json" },
  body: JSON.stringify({ line_items: [...], totals: { ... } })
}).then(r => r.json());

// 3. Agent signs and submits Algorand tx with session ID in note
// ... (algosdk)

// 4. Agent completes checkout
await fetch(`https://merchant.example.com/ucp/v1/checkout-sessions/${session.id}/complete`, {
  method: "POST",
  body: JSON.stringify({ payment_handler: "org.algorand.shopping.payment_handler", txid })
});
```

No human interaction required at any step.

---

## Drop-in pay widget

For browser-based storefronts, include the widget script in your checkout page:

```html
<script src="https://your-ucp-server.com/widget/pay.js"></script>

<ucp-pay-button
  server="https://your-ucp-server.com"
  amount="19.99"
  currency="USD"
  item="Premium subscription"
  on-complete="handlePaymentComplete">
</ucp-pay-button>
```

The widget handles:
- Showing accepted assets and QR code for mobile wallets
- Polling for session completion
- Triggering your callback when payment is confirmed

See [`widget/`](widget/) for source and self-hosting instructions.

---

## Development commands

```bash
npm run dev           # tsx watch — auto-restarts on changes
npm run build         # Compile TypeScript → dist/
npm start             # Run compiled build

npm run typecheck     # Strict TS checks
npm run lint          # Biome lint
npm run lint:fix      # Biome autofix
npm run quality       # typecheck + lint + tests

npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

---

## Architecture map

```
src/
├── config.ts                      Validates all env vars at startup
├── types/ucp.ts                   UCP protocol types + constants
├── algorand/
│   ├── assets.ts                  Asset registry per network — single source of truth
│   └── verifier.ts                On-chain tx verification
├── store/checkout.ts              Checkout persistence + double-spend / idempotency
├── utils/webhook.ts               Signed webhook dispatcher + retry
└── server/
    ├── app.ts                     Fastify factory
    ├── profile.ts                 /.well-known/ucp builder
    └── routes/
        ├── health.ts              GET /, /health, /ready
        └── checkout.ts            Checkout lifecycle

examples/
├── e2e_checkout.ts                Full TestNet flow (buyer mnemonic required)
└── ai_agent_checkout.ts           Autonomous agent payment demo

widget/
└── pay.js                         Drop-in browser payment button
```

---

## Local end-to-end demo (TestNet)

### Step 1 — Generate a buyer account

```bash
node --input-type=module << 'EOF'
import algosdk from "algosdk";
const acct = algosdk.generateAccount();
console.log("Address: ", acct.addr.toString());
console.log("Mnemonic:", algosdk.secretKeyToMnemonic(acct.sk));
EOF
```

> Copy the address exactly from the output — Algorand addresses include a checksum and must be 58 characters.

### Step 2 — Fund it

1. **https://bank.testnet.algorand.network/** → paste address → Dispense (10 test ALGO)
2. Verify: `https://testnet.algoexplorer.io/address/<your-address>`

### Step 3 — Set `.env`

```env
ALGORAND_MERCHANT_ADDRESS=<address from Step 1>
```

### Step 4 — Run

```bash
npm run dev
# in another terminal:
BUYER_MNEMONIC="word1 ... word25" npx tsx examples/e2e_checkout.ts
```

---

## Docker

```bash
docker build -t ucp-algorand .
docker run --env-file .env -p 8000:8000 ucp-algorand
```

Multi-stage build, `node:22-alpine`, non-root `node` user, wget healthcheck on `/health`.

---

## CI / CD

Every push/PR to `main`:

1. `npm run typecheck`
2. `npm run lint`
3. `npm test -- --coverage`
4. `npm run build`

---

## Roadmap

See [`ROADMAP.md`](ROADMAP.md) for the full plan. Highlights:

| Status | Item |
|---|---|
| ✅ Done | Core checkout API, on-chain verification, webhooks, double-spend protection |
| ✅ Done | Biome quality gates, Jest tests, Docker, GitHub Actions CI |
| 🔜 Next | Hosted TestNet sandbox (try without installing) |
| 🔜 Next | Drop-in browser pay widget |
| 🔜 Next | AI agent example (GPT tool / Claude MCP integration) |
| 🔜 Next | Shopify app plugin |
| 🔜 Next | Redis/Postgres persistence adapter |
| 🔜 Next | Payment dashboard (incoming orders UI) |

Good first issues are labeled [`good first issue`](https://github.com/yathishbl60/ucp-algorand/issues?q=label%3A%22good+first+issue%22) on GitHub.

---

## Production checklist

- [ ] Replace Algonode public endpoints with a managed provider (QuickNode, NodelyTech)
- [ ] Replace in-memory store with Redis or Postgres
- [ ] Set `WEBHOOK_URL` + strong `WEBHOOK_SECRET`
- [ ] Restrict `CORS_ORIGINS` to your domains
- [ ] `NODE_ENV=production`
- [ ] TLS-terminating reverse proxy (nginx, Caddy)
- [ ] Alert on `checkout.escalated` events
- [ ] Monitor webhook retry failures

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — local setup, PR standards, how to add ASAs, how to deploy escrow contracts.

Star the repo if this is useful. Open an issue if you're building something with it — I want to know.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
