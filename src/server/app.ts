/**
 * Fastify application factory.
 *
 * Registers all plugins and routes. Kept separate from main.ts so that
 * tests can import `buildApp()` without binding to a port.
 */

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import type { AlgorandVerifier } from "../algorand/verifier.js";
import type { Config } from "../config.js";
import type { CheckoutStore } from "../store/checkout.js";
import type { InMemoryCheckoutStore } from "../store/checkout.js";
import checkoutRoutes from "./routes/checkout.js";
import healthRoutes from "./routes/health.js";
import wellKnownRoutes from "./routes/wellKnown.js";

export async function buildApp(
  config: Config,
  store: InMemoryCheckoutStore,
  verifier: AlgorandVerifier,
) {
  const fastify = Fastify({
    // Reject bodies larger than 1 MB to prevent memory abuse / DDoS
    bodyLimit: 1_048_576,
    logger:
      config.nodeEnv === "development"
        ? { transport: { target: "pino-pretty" }, level: config.logLevel }
        : { level: config.logLevel },
    // Assign a unique request ID to every request — visible in all log lines
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: "x-request-id",
    trustProxy: true,
  });

  // ── Security & cross-cutting plugins ──────────────────────────────────────

  await fastify.register(helmet, {
    // UCP profiles must be reachable from any origin
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  await fastify.register(cors, {
    origin: config.corsOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "UCP-Agent",
      "Idempotency-Key",
      "X-Request-Id",
    ],
    exposedHeaders: ["X-Request-Id"],
  });

  await fastify.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    errorResponseBuilder: (_req, context) => ({
      code: "rate_limit_exceeded",
      content: `Too many requests. Retry after ${context.after}.`,
    }),
  });

  // ── Global error handler ──────────────────────────────────────────────────

  fastify.setErrorHandler((error: unknown, request, reply) => {
    request.log.error({ err: error }, "Unhandled error");
    const fastifyErr = error as { statusCode?: number; message?: string };
    const statusCode = fastifyErr.statusCode ?? 500;
    void reply.status(statusCode).send({
      code: "internal_error",
      content:
        config.nodeEnv === "production"
          ? "An unexpected error occurred."
          : (fastifyErr.message ?? "Unknown error"),
    });
  });

  fastify.setNotFoundHandler((_req, reply) => {
    void reply.status(404).send({
      code: "not_found",
      content: "The requested endpoint does not exist.",
    });
  });

  // ── Routes ────────────────────────────────────────────────────────────────

  await fastify.register(healthRoutes, { verifier, store });
  await fastify.register(wellKnownRoutes, { config });
  await fastify.register(checkoutRoutes, { config, store, verifier });

  return fastify;
}
