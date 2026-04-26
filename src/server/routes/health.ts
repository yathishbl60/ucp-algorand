/**
 * Health + readiness routes.
 * GET /health  — liveness probe (always 200 if the process is alive)
 * GET /ready   — readiness probe (checks Algorand node connectivity)
 */

import type { FastifyPluginAsync } from "fastify";
import type { AlgorandVerifier } from "../../algorand/verifier.js";
import type { CheckoutStore } from "../../store/checkout.js";

interface HealthDeps {
  verifier: AlgorandVerifier;
  store: CheckoutStore;
}

const healthRoutes: FastifyPluginAsync<HealthDeps> = async (fastify, opts) => {
  fastify.get("/", { logLevel: "silent" }, async (_req, reply) => {
    return reply.send({
      service: "ucp-algorand",
      status: "ok",
      endpoints: {
        health: "/health",
        ready: "/ready",
        profile: "/.well-known/ucp",
        checkout_create: "/ucp/v1/checkout-sessions",
      },
      docs: "https://ucp.dev/",
      timestamp: new Date().toISOString(),
    });
  });

  fastify.get("/health", { logLevel: "silent" }, async (_req, reply) => {
    return reply.send({ status: "ok", timestamp: new Date().toISOString() });
  });

  fastify.get("/ready", async (_req, reply) => {
    const [algorand, sessions] = await Promise.all([
      opts.verifier.healthCheck(),
      opts.store.size(),
    ]);

    const isReady = algorand.algod && algorand.indexer;
    return reply.status(isReady ? 200 : 503).send({
      status: isReady ? "ready" : "not_ready",
      checks: {
        algorand_algod: algorand.algod ? "ok" : "fail",
        algorand_indexer: algorand.indexer ? "ok" : "fail",
        active_sessions: sessions,
      },
      timestamp: new Date().toISOString(),
    });
  });
};

export default healthRoutes;
