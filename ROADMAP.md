# Roadmap

This is the public roadmap for `ucp-algorand`. Items are ordered by impact.

If you want to work on something, open an issue and claim it. PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## ✅ Done

- [x] Core checkout API (create, get, update, complete, cancel)
- [x] On-chain tx verification (receiver, amount, asset, note)
- [x] Double-spend protection
- [x] Idempotency key support
- [x] HMAC-SHA256 signed webhooks with retry/backoff
- [x] Multi-network asset registry (TestNet USDC, MainNet USDC/USDt/goBTC/goETH)
- [x] Biome lint + format, Jest integration tests
- [x] GitHub Actions CI (typecheck → lint → test → build)
- [x] Docker multi-stage build (node:22-alpine, non-root)
- [x] AI agent autonomous checkout example
- [x] Drop-in browser pay widget (Web Component)

---

## 🔜 Next (help wanted)

### Hosted TestNet Sandbox

> **Impact: High** · Difficulty: Medium · Label: [`good first issue`](https://github.com/yathishbl60/ucp-algorand/issues)

A publicly hosted TestNet instance so anyone can try the API without installing anything.

- Deploy to Fly.io / Railway / Render
- Public URL: `testnet.ucp-algorand.dev`
- Swagger/OpenAPI UI at `/docs`

---

### Redis / Postgres persistence adapter

> **Impact: High** · Difficulty: Medium · Label: [`good first issue`](https://github.com/yathishbl60/ucp-algorand/issues)

Currently the checkout store is in-memory (resets on restart). Needed for production multi-instance deployments.

- Define a `CheckoutStore` interface (already exists — just needs a DB adapter)
- Implement `RedisCheckoutStore` using `ioredis`
- Implement `PostgresCheckoutStore` using `postgres` (or `drizzle-orm`)
- Toggle via `STORE_ADAPTER=redis|postgres|memory` env var

---

### Exchange rate oracle

> **Impact: High** · Difficulty: Easy · Label: [`good first issue`](https://github.com/yathishbl60/ucp-algorand/issues)

Convert USD checkout totals to ALGO/USDC amounts in real time.

- Fetch ALGO/USD price from CoinGecko or Vestige
- Cache with TTL to avoid rate limits
- Expose `/ucp/v1/rates` endpoint
- Include calculated amounts in checkout session response

---

### OpenAPI / Swagger docs

> **Impact: Medium** · Difficulty: Easy · Label: [`good first issue`](https://github.com/yathishbl60/ucp-algorand/issues)

Auto-generate interactive API docs from Fastify's JSON schema.

- Add `@fastify/swagger` + `@fastify/swagger-ui`
- Serve at `/docs`
- Add response schemas to all routes

---

### GPT tool / Claude MCP integration

> **Impact: High** · Difficulty: Medium

Package this handler as a ChatGPT plugin and Claude MCP tool so LLM-powered agents can discover it automatically.

- `/.well-known/ai-plugin.json` for ChatGPT
- MCP tool manifest for Claude
- Example prompts: "Buy the $5 API subscription from this merchant"

---

### Shopify app plugin

> **Impact: Very High** · Difficulty: Hard

A Shopify app that installs this handler as a payment gateway.

- Shopify Partner app with OAuth flow
- Embeds UCP payment option at checkout
- Maps Shopify order IDs to UCP sessions
- Webhook sync: UCP `checkout.completed` → Shopify order paid

---

### Payment dashboard UI

> **Impact: High** · Difficulty: Hard

A simple web UI for merchants to see incoming payments.

- List of checkout sessions with status
- Filter by date, asset, status
- Exportable CSV
- Webhook delivery log

---

### Smart contract escrow

> **Impact: Medium** · Difficulty: Hard

Lock funds in a PyTeal/ARC-4 contract until merchant confirms delivery.

- Escrow contract: buyer → contract → merchant (on delivery)
- Dispute resolution window
- Connect to `ALGORAND_ESCROW_APP_ID` env var (stub already in codebase)

---

### NFT-gated access

> **Impact: Medium** · Difficulty: Easy · Label: [`good first issue`](https://github.com/yathishbl60/ucp-algorand/issues)

Verify buyer holds an NFT before allowing checkout (for gated communities, exclusive drops).

- Check ASA balance on buyer address at session creation
- Config: `REQUIRED_ASSET_ID`, `REQUIRED_ASSET_AMOUNT`

---

### Multi-merchant mode

> **Impact: Medium** · Difficulty: Medium

Run one server instance for multiple merchants (SaaS mode).

- Merchant accounts with API keys
- Per-merchant address + webhook config
- Usage metering

---

## 💬 Ideas (not yet scoped)

- Mobile wallet deep-link support (Pera Wallet, Defly)
- FIAT on-ramp integration (Transak, MoonPay)
- Subscription billing (recurring payments via smart contract)
- Cross-chain bridge payments (pay with ETH, settle in ALGO)
- WooCommerce / Magento plugins

---

## How to contribute

1. Find an issue labeled [`good first issue`](https://github.com/yathishbl60/ucp-algorand/issues?q=label%3A%22good+first+issue%22)
2. Comment to claim it
3. Fork, branch, build, test
4. Open a PR — see [CONTRIBUTING.md](CONTRIBUTING.md)

If you're building something with this or want to discuss a roadmap item, open an issue or start a Discussion.
