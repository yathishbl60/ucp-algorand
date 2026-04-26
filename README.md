# UCP Algorand Payment Handler

[![CI](https://img.shields.io/github/actions/workflow/status/YOUR_ORG/ucp-algorand/ci.yml?branch=main&label=CI)](https://github.com/YOUR_ORG/ucp-algorand/actions/workflows/ci.yml)
[![Node 22+](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Production-ready Algorand payment handler for the **Universal Commerce Protocol (UCP)**.

Buyer apps and AI agents discover your store, create a checkout session, pay on-chain
with ALGO or any accepted ASA, and submit the txid for server-side verification — all
over a standard REST API with no custom SDKs required on the buyer side.

---

## Table of Contents

1. [Who this is for](#who-this-is-for)
2. [How it works](#how-it-works)
3. [Tech stack](#tech-stack)
4. [Quick start (5 minutes)](#quick-start-5-minutes)
5. [All environment variables](#all-environment-variables)
6. [API reference](#api-reference)
7. [Supported assets](#supported-assets)
8. [Webhooks](#webhooks)
9. [Security features](#security-features)
10. [Development commands](#development-commands)
11. [Architecture map](#architecture-map)
12. [Local end-to-end demo (TestNet)](#local-end-to-end-demo-testnet)
13. [Docker](#docker)
14. [CI / CD](#ci--cd)
15. [Production checklist](#production-checklist)
16. [Contributing](#contributing)
17. [License](#license)

---

## Who this is for

| Audience | What you get |
|---|---|
| **Merchants** | Drop-in Algorand checkout backend — configure one `.env`, run one command |
| **Platform / AI agent teams** | A spec-compliant UCP endpoint you can integrate against immediately |
| **Algorand builders** | A clean extension point for new assets, escrow contracts, and settlement logic |

---

## How it works

```
Buyer app                    This server                     Algorand TestNet / MainNet
──────────                   ──────────                      ──────────────────────────
GET /.well-known/ucp  ──►   Returns handler config,    ◄──  (merchant address live)
                             accepted assets, merchant addr

POST /ucp/v1/checkout-sessions  ──►  Creates session (pending)
                                     Returns session ID + payment instructions

[Buyer builds + signs tx off-chain, puts session ID in tx note]
[Buyer submits tx directly to Algorand]

POST /ucp/v1/checkout-sessions/{id}/complete  ──►  Server fetches tx from Indexer
                                                     Verifies: receiver ✓ amount ✓
                                                     asset ✓ note ✓ confirmations ✓
                                                     Session → complete ✓
                                                     Webhook dispatched ✓
```

Protocol identifiers:
- **Handler namespace:** `org.algorand.shopping.payment_handler`
- **UCP spec version:** `2026-04-08`
- **Handler version:** `2026-04-26`

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js ≥ 22 | Native `fetch`, `crypto`, ESM support |
| Language | TypeScript 5 (strict) | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Server | Fastify 5 | Schema-based serialization, pino logging, plugin system |
| Validation | Zod 3 | Runtime schema validation + startup config guard |
| Chain SDK | algosdk v3 | Official Algorand TypeScript SDK |
| Quality | Biome 1.9 | Single tool for lint + format (replaces ESLint + Prettier) |
| Testing | Jest + ts-jest | ESM-native integration tests |
| CI | GitHub Actions | Typecheck → lint → test → build on every push |
| Container | Docker (multi-stage) | `node:22-alpine`, non-root user, wget healthcheck |

---

## Quick start (5 minutes)

### Prerequisites

- Node.js ≥ 22 (`node --version`)
- An Algorand address to receive payments

### 1. Clone and install

```bash
git clone https://github.com/YOUR_ORG/ucp-algorand.git
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

> No Algonode API key is required for TestNet or MainNet — the public endpoints work out of the box.

### 3. Start the server

```bash
npm run dev
```

You should see:

```
{"level":"info","msg":"Server listening at http://127.0.0.1:8000"}
```

### 4. Verify everything is running

```bash
# Health check
curl http://localhost:8000/health

# Inspect your UCP profile (shows accepted assets + merchant address)
curl http://localhost:8000/.well-known/ucp | jq
```

---

## All environment variables

### Required

| Variable | Description |
|---|---|
| `ALGORAND_NETWORK` | `testnet`, `mainnet`, or `betanet` |
| `ALGORAND_ALGOD_URL` | Algod node base URL (no trailing slash) |
| `ALGORAND_INDEXER_URL` | Indexer base URL (no trailing slash) |
| `ALGORAND_MERCHANT_ADDRESS` | Your 58-char Algorand address that receives payments |
| `UCP_BASE_URL` | Public base URL of this server (used in UCP profile links) |

### Optional — server behaviour

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8000` | HTTP port to listen on |
| `HOST` | `0.0.0.0` | Bind address |
| `LOG_LEVEL` | `info` | Pino log level (`trace`, `debug`, `info`, `warn`, `error`) |
| `NODE_ENV` | `development` | Set to `production` to enable production optimizations |
| `ALGORAND_ALGOD_TOKEN` | _(empty)_ | API key for private Algod nodes |
| `ALGORAND_INDEXER_TOKEN` | _(empty)_ | API key for private Indexer nodes |
| `ALGORAND_MIN_CONFIRMATIONS` | `1` | Rounds before a payment is considered final (1 round ≈ 4 s) |
| `RATE_LIMIT_MAX` | `100` | Max requests per window per IP |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in milliseconds |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins (restrict in production) |

### Optional — webhooks (both required together)

| Variable | Description |
|---|---|
| `WEBHOOK_URL` | URL the server posts lifecycle events to |
| `WEBHOOK_SECRET` | HMAC-SHA256 signing secret (min 16 chars). Must be set with `WEBHOOK_URL` |

### Optional — store branding

| Variable | Description |
|---|---|
| `STORE_NAME` | Display name shown in the UCP profile |
| `STORE_DESCRIPTION` | Short description of your store |
| `STORE_SUPPORT_EMAIL` | Support contact shown to buyer platforms |
| `STORE_LOGO_URL` | URL to your store logo |

> The server validates all config at startup and exits immediately with a clear error message if anything is wrong.

---

## API reference

### Discovery

#### `GET /`

Returns service info and a list of available endpoints.

#### `GET /.well-known/ucp`

Returns the merchant's UCP profile: accepted payment handlers, asset list, merchant
Algorand address, and optional branding metadata.

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

Liveness check. Returns `200 { status: "ok" }` when the server is up.

#### `GET /ready`

Readiness check. Verifies the Algorand node is reachable. Returns `200` when ready,
`503` when the node is unavailable (use this for Kubernetes readiness probes).

### Checkout sessions

All checkout endpoints require the `UCP-Agent` header on mutating requests to identify the calling platform.

#### `POST /ucp/v1/checkout-sessions`

Create a new checkout session.

**Headers:**

```
UCP-Agent: profile="https://your-platform.example/ucp-profile"
X-Idempotency-Key: <uuid>   (optional — ensures at-most-once creation)
```

**Request body:**

```json
{
  "line_items": [
    {
      "id": "item-1",
      "description": "T-shirt (L)",
      "quantity": 1,
      "unit_price": 2000,
      "currency": "USD"
    }
  ],
  "totals": {
    "subtotal": 2000,
    "tax": 0,
    "shipping": 0,
    "total": 2000,
    "currency": "USD"
  }
}
```

**Response:** `201` with session object including `id`, `status: "pending"`, and payment instructions.

#### `GET /ucp/v1/checkout-sessions/:id`

Retrieve a checkout session by ID.

#### `PATCH /ucp/v1/checkout-sessions/:id`

Update shipping address or buyer info on a `pending` session.

#### `POST /ucp/v1/checkout-sessions/:id/complete`

Submit the on-chain txid for verification and mark the session complete.

**Request body:**

```json
{
  "payment_handler": "org.algorand.shopping.payment_handler",
  "txid": "ALGORAND_TX_ID_HERE"
}
```

The server:

1. Fetches the transaction from the Algorand Indexer
2. Verifies receiver address, amount, asset ID, and note contains the session ID
3. Checks confirmation count ≥ `ALGORAND_MIN_CONFIRMATIONS`
4. Guards against double-spend (same txid cannot complete two sessions)
5. Moves session to `complete` and dispatches a `checkout.completed` webhook

#### `DELETE /ucp/v1/checkout-sessions/:id`

Cancel a `pending` session. Dispatches a `checkout.cancelled` webhook.

### Error format

All errors follow the UCP error envelope:

```json
{
  "ucp": {
    "status": "error",
    "messages": [
      {
        "type": "error",
        "code": "PAYMENT_VERIFICATION_FAILED",
        "content": "Transaction receiver does not match merchant address",
        "severity": "unrecoverable"
      }
    ]
  }
}
```

---

## Supported assets

### TestNet

| Symbol | ASA ID | Decimals | Type |
|---|---|---|---|
| ALGO | 0 (native) | 6 | Native |
| USDC | 10458941 | 6 | Stablecoin |

### MainNet

| Symbol | ASA ID | Decimals | Type |
|---|---|---|---|
| ALGO | 0 (native) | 6 | Native |
| USDC | 31566704 | 6 | Stablecoin |
| USDt | 312769 | 6 | Stablecoin |
| goBTC | 386192725 | 8 | Wrapped |
| goETH | 386195940 | 8 | Wrapped |

To add a new asset, edit `src/algorand/assets.ts`. No other changes are needed — the
profile, verifier, and checkout routes pick it up automatically.

---

## Webhooks

When `WEBHOOK_URL` and `WEBHOOK_SECRET` are both set, the server sends a signed HTTP
POST to your endpoint on every checkout state change.

### Events

| Event | Triggered when |
|---|---|
| `checkout.created` | New session is created |
| `checkout.updated` | Session fields are patched |
| `checkout.completed` | On-chain payment verified successfully |
| `checkout.cancelled` | Session is cancelled |
| `checkout.escalated` | Payment verification failed after all retries |

### Request headers

```
X-UCP-Event: checkout.completed
X-UCP-Delivery: <uuid>
X-UCP-Signature: sha256=<hmac-sha256-hex>
Content-Type: application/json
```

### Verifying the signature

The signature is `HMAC-SHA256(raw_body, WEBHOOK_SECRET)` encoded as hex with a `sha256=` prefix.

```typescript
import { createHmac } from "node:crypto";

function verifyWebhook(rawBody: string, secret: string, header: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  return header === expected;
}
```

The server retries failed deliveries up to 3 times with exponential backoff.

---

## Security features

| Feature | Detail |
|---|---|
| **On-chain verification** | Every txid verified against receiver address, amount, asset ID, and note field |
| **Double-spend protection** | A txid can only complete one session — ever |
| **Idempotency** | Checkout creation is idempotent via `X-Idempotency-Key` — safe to retry |
| **Request IDs** | Every request gets a UUID for log tracing |
| **Rate limiting** | Configurable per-IP limiting via `@fastify/rate-limit` |
| **Secure headers** | `@fastify/helmet` sets HSTS, CSP, X-Frame-Options, and more |
| **CORS** | Configurable allowed origins via `CORS_ORIGINS` |
| **Config guard** | Server refuses to start if any required env var is missing or malformed |
| **Signed webhooks** | HMAC-SHA256 on every outgoing event |
| **Body size limit** | Requests capped at 1 MB |

---

## Development commands

```bash
npm run dev           # Start with tsx watch (auto-restarts on file changes)
npm run build         # Compile TypeScript → dist/
npm start             # Run compiled build (production mode)

npm run typecheck     # Strict TypeScript checks (no emit)
npm run lint          # Biome lint check
npm run lint:fix      # Biome autofix (safe fixes)
npm run format        # Biome format (write)
npm run quality       # typecheck + lint + tests (run before pushing)

npm test              # Run all tests
npm run test:watch    # Tests in watch mode
npm run test:coverage # Tests with coverage report
```

---

## Architecture map

```
src/
├── config.ts                      Config loader — validates all env vars at startup
├── types/
│   └── ucp.ts                     UCP protocol types + constants
├── algorand/
│   ├── assets.ts                  Accepted asset registry per network
│   └── verifier.ts                On-chain tx verification (algod + indexer)
├── store/
│   └── checkout.ts                Checkout persistence + txid/idempotency registries
├── utils/
│   └── webhook.ts                 HMAC-signed webhook dispatcher + retry logic
└── server/
    ├── app.ts                     Fastify app factory (plugins, routes, config)
    ├── profile.ts                 /.well-known/ucp profile builder
    └── routes/
        ├── health.ts              GET /, /health, /ready
        └── checkout.ts            UCP checkout session lifecycle routes

examples/
└── e2e_checkout.ts                Full end-to-end TestNet demo script

schemas/
└── algorand_payment_handler.json  JSON schema for the handler payload
```

---

## Local end-to-end demo (TestNet)

Run a complete checkout flow against your local server using a real Algorand TestNet transaction.

### Step 1 — Generate a buyer account

Run this to create a fresh keypair:

```bash
node --input-type=module << 'EOF'
import algosdk from "algosdk";
const acct = algosdk.generateAccount();
console.log("Address: ", acct.addr.toString());
console.log("Mnemonic:", algosdk.secretKeyToMnemonic(acct.sk));
EOF
```

> **Important:** Copy the address exactly from the terminal output. Do not retype it manually — Algorand addresses include a checksum and must be exactly 58 characters.

### Step 2 — Fund the account

1. Open **https://bank.testnet.algorand.network/**
2. Paste your address and click **Dispense** (you'll receive 10 test ALGO)
3. Verify the balance at `https://testnet.algoexplorer.io/address/<your-address>`

### Step 3 — Set the merchant address in `.env`

For a self-contained demo, use the same address for buyer and merchant (funds return to you):

```env
ALGORAND_MERCHANT_ADDRESS=<paste address from Step 1>
```

### Step 4 — Start the server

```bash
npm run dev
```

### Step 5 — Run the demo

```bash
BUYER_MNEMONIC="word1 word2 ... word25" npx tsx examples/e2e_checkout.ts
```

The script will:

1. `GET /.well-known/ucp` — discover handler config and merchant address
2. `POST /ucp/v1/checkout-sessions` — create a checkout session
3. Build, sign, and submit a `pay` transaction with the session ID in the `note` field
4. Wait for on-chain confirmation (~4 s on TestNet)
5. `POST /ucp/v1/checkout-sessions/{id}/complete` — submit txid for server-side verification
6. Print the confirmed round and an AlgoExplorer link to the transaction

---

## Docker

### Build

```bash
docker build -t ucp-algorand .
```

### Run

```bash
docker run --env-file .env -p 8000:8000 ucp-algorand
```

The image uses a multi-stage build (`node:22-alpine`) with a non-root `node` user and
a `wget`-based healthcheck on `/health`.

---

## CI / CD

`.github/workflows/ci.yml` runs on every push and pull request to `main`:

1. `npm run typecheck` — strict TypeScript, no emit
2. `npm run lint` — Biome rules
3. `npm test -- --coverage` — integration tests with coverage
4. `npm run build` — confirms the dist compiles cleanly

---

## Production checklist

Before going live on MainNet:

- [ ] Replace Algonode public endpoints with a managed provider (e.g. NodelyTech, QuickNode) for uptime SLAs
- [ ] Replace in-memory store with Redis or Postgres for multi-instance deployments
- [ ] Set `WEBHOOK_URL` and a strong random `WEBHOOK_SECRET`
- [ ] Restrict `CORS_ORIGINS` to your buyer platform domains
- [ ] Set `NODE_ENV=production`
- [ ] Run behind a TLS-terminating reverse proxy (nginx, Caddy, load balancer)
- [ ] Set up alerting on `checkout.escalated` webhook events (payment failed to verify)
- [ ] Monitor webhook retry queue for persistent delivery failures

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, PR standards, how to add new
ASAs, and how to deploy escrow contracts.

---

## License

Apache License 2.0 — see [LICENSE](LICENSE).
