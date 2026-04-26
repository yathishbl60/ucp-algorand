/**
 * Integration tests for the UCP Algorand server.
 *
 * Uses Fastify's `inject()` for in-process HTTP — no network required.
 * Algorand verification is mocked so tests run offline.
 */

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { AlgorandVerifier } from "../algorand/verifier.js";
import type { Config } from "../config.js";
import { buildApp } from "../server/app.js";
import { InMemoryCheckoutStore } from "../store/checkout.js";

// ─── Minimal config for tests ────────────────────────────────────────────────

const testConfig: Config = {
  port: 8000,
  host: "127.0.0.1",
  nodeEnv: "test",
  logLevel: "error",
  ucpBaseUrl: "http://localhost:8000",
  algorandNetwork: "testnet",
  algorandAlgodUrl: "https://testnet-api.algonode.cloud",
  algorandAlgodToken: "",
  algorandIndexerUrl: "https://testnet-idx.algonode.cloud",
  algorandIndexerToken: "",
  algorandMerchantAddress: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  algorandMinConfirmations: 1,
  rateLimitMax: 1000,
  rateLimitWindowMs: 60_000,
  corsOrigins: "*",
};

// ─── Mock verifier ───────────────────────────────────────────────────────────

const mockVerifier = {
  verify: jest.fn(),
  healthCheck: jest.fn(async () => ({ algod: true, indexer: true })),
} as unknown as AlgorandVerifier;

// ─── Test setup ──────────────────────────────────────────────────────────────

let app: Awaited<ReturnType<typeof buildApp>>;
let store: InMemoryCheckoutStore;

beforeAll(async () => {
  store = new InMemoryCheckoutStore();
  app = await buildApp(testConfig, store, mockVerifier);
});

afterAll(async () => {
  await app.close();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /.well-known/ucp", () => {
  it("returns a valid UCP profile with Algorand handler", async () => {
    const res = await app.inject({ method: "GET", url: "/.well-known/ucp" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("public");

    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty("ucp");
    const ucp = body.ucp as Record<string, unknown>;
    expect(ucp.version).toBe("2026-04-08");
    const handlers = ucp.payment_handlers as Record<string, unknown>;
    expect(handlers["org.algorand.shopping.payment_handler"]).toBeDefined();
  });
});

describe("GET /health", () => {
  it("returns 200 ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe("ok");
  });
});

describe("GET /ready", () => {
  it("returns 200 when algod and indexer are reachable", async () => {
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe("ready");
  });
});

describe("POST /ucp/v1/checkout-sessions", () => {
  it("rejects requests without UCP-Agent header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/ucp/v1/checkout-sessions",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        line_items: [
          { id: "sku_1", description: "Test item", quantity: 1, unit_price: 1000, currency: "USD" },
        ],
      }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string }>().code).toBe("invalid_profile_url");
  });

  it("creates a checkout session and returns 201 with ucp metadata", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/ucp/v1/checkout-sessions",
      headers: {
        "Content-Type": "application/json",
        "UCP-Agent": 'profile="http://platform.test/profile"',
      },
      body: JSON.stringify({
        line_items: [
          {
            id: "sku_1",
            description: "Algorand hoodie",
            quantity: 2,
            unit_price: 5000,
            currency: "USD",
          },
        ],
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; status: string; ucp: { version: string } }>();
    expect(body.status).toBe("incomplete");
    expect(body.id).toMatch(/^ch_/);
    expect(body.ucp.version).toBe("2026-04-08");
  });
});

describe("POST /ucp/v1/checkout-sessions/:id/complete", () => {
  const agentHeader = 'profile="http://platform.test/profile"';

  async function createSession() {
    const res = await app.inject({
      method: "POST",
      url: "/ucp/v1/checkout-sessions",
      headers: { "Content-Type": "application/json", "UCP-Agent": agentHeader },
      body: JSON.stringify({
        line_items: [
          { id: "sku_1", description: "ALGO tee", quantity: 1, unit_price: 2000, currency: "USD" },
        ],
      }),
    });
    return res.json<{ id: string }>();
  }

  it("completes checkout when Algorand payment is verified", async () => {
    (mockVerifier.verify as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
      valid: true,
      confirmedRound: 42000000,
      actualAmount: 2200n,
      senderAddress: "SENDERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    });

    const { id } = await createSession();

    const res = await app.inject({
      method: "POST",
      url: `/ucp/v1/checkout-sessions/${id}/complete`,
      headers: { "Content-Type": "application/json", "UCP-Agent": agentHeader },
      body: JSON.stringify({
        payment: {
          instruments: [
            {
              handler_id: "algorand_testnet",
              type: "algo",
              credential: {
                algorand: {
                  txid: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                  network: "testnet",
                  asset_id: 0,
                },
              },
            },
          ],
        },
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe("complete");
  });

  it("returns requires_escalation when verification fails", async () => {
    (mockVerifier.verify as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
      valid: false,
      reason: "Amount too low",
    });

    const { id } = await createSession();

    const res = await app.inject({
      method: "POST",
      url: `/ucp/v1/checkout-sessions/${id}/complete`,
      headers: { "Content-Type": "application/json", "UCP-Agent": agentHeader },
      body: JSON.stringify({
        payment: {
          instruments: [
            {
              handler_id: "algorand_testnet",
              type: "algo",
              credential: {
                algorand: {
                  txid: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
                  network: "testnet",
                  asset_id: 0,
                },
              },
            },
          ],
        },
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe("requires_escalation");
  });
});
