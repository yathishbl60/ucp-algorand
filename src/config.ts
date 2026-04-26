/**
 * Type-safe configuration loader.
 *
 * All env vars are validated at startup — the server refuses to start with
 * invalid config. This catches misconfigured Algorand addresses, bad URLs,
 * and missing required fields before any request is served.
 */

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const AlgorandNetwork = z.enum(["mainnet", "testnet", "betanet"]);
const LogLevel = z.enum(["fatal", "error", "warn", "info", "debug", "trace"]);
const NodeEnv = z.enum(["development", "production", "test"]);

const configSchema = z
  .object({
    // ── Server ──────────────────────────────────────────────────────────────
    port: z.coerce.number().int().min(1).max(65535).default(8000),
    host: z.string().default("0.0.0.0"),
    nodeEnv: NodeEnv.default("development"),
    logLevel: LogLevel.default("info"),
    ucpBaseUrl: z.string().url("UCP_BASE_URL must be a valid URL"),

    // ── Algorand ────────────────────────────────────────────────────────────
    algorandNetwork: AlgorandNetwork.default("testnet"),
    algorandAlgodUrl: z.string().url("ALGORAND_ALGOD_URL must be a valid URL"),
    algorandAlgodToken: z.string().default(""),
    algorandIndexerUrl: z.string().url("ALGORAND_INDEXER_URL must be a valid URL"),
    algorandIndexerToken: z.string().default(""),
    algorandMerchantAddress: z
      .string()
      .regex(
        /^[A-Z2-7]{58}$/,
        "ALGORAND_MERCHANT_ADDRESS must be a valid 58-char base32 Algorand address",
      ),
    algorandEscrowAppId: z.coerce.number().int().positive().optional(),
    algorandMinConfirmations: z.coerce.number().int().min(1).default(1),

    // ── Webhook (optional) ──────────────────────────────────────────────────
    // POST checkout lifecycle events to an external order management system.
    // Both webhookUrl and webhookSecret must be set together, or neither.
    webhookUrl: z.string().url().optional(),
    webhookSecret: z.string().min(16).optional(),

    // ── Store branding (optional) ────────────────────────────────────────────
    // Shown in the UCP profile at /.well-known/ucp
    storeName: z.string().optional(),
    storeDescription: z.string().optional(),
    storeSupportEmail: z.string().email().optional(),
    storeLogoUrl: z.string().url().optional(),

    // ── Rate limiting ────────────────────────────────────────────────────────
    rateLimitMax: z.coerce.number().int().positive().default(100),
    rateLimitWindowMs: z.coerce.number().int().positive().default(60_000),

    // ── CORS ─────────────────────────────────────────────────────────────────
    corsOrigins: z
      .string()
      .transform((v) => (v === "*" ? "*" : v.split(",").map((s) => s.trim())))
      .default("*"),
  })
  .refine(
    (data) =>
      // Webhook URL and secret must both be set, or neither
      !(data.webhookUrl && !data.webhookSecret) && !(!data.webhookUrl && data.webhookSecret),
    {
      message:
        "WEBHOOK_URL and WEBHOOK_SECRET must both be set, or neither. " +
        "A webhook URL without a signing secret is a security risk.",
      path: ["webhookSecret"],
    },
  );

function loadConfig() {
  const result = configSchema.safeParse({
    port: process.env.PORT,
    host: process.env.HOST,
    nodeEnv: process.env.NODE_ENV,
    logLevel: process.env.LOG_LEVEL,
    ucpBaseUrl: process.env.UCP_BASE_URL,

    algorandNetwork: process.env.ALGORAND_NETWORK,
    algorandAlgodUrl: process.env.ALGORAND_ALGOD_URL,
    algorandAlgodToken: process.env.ALGORAND_ALGOD_TOKEN,
    algorandIndexerUrl: process.env.ALGORAND_INDEXER_URL,
    algorandIndexerToken: process.env.ALGORAND_INDEXER_TOKEN,
    algorandMerchantAddress: process.env.ALGORAND_MERCHANT_ADDRESS,
    algorandEscrowAppId: process.env.ALGORAND_ESCROW_APP_ID,
    algorandMinConfirmations: process.env.ALGORAND_MIN_CONFIRMATIONS,

    webhookUrl: process.env.WEBHOOK_URL,
    webhookSecret: process.env.WEBHOOK_SECRET,
    storeName: process.env.STORE_NAME,
    storeDescription: process.env.STORE_DESCRIPTION,
    storeSupportEmail: process.env.STORE_SUPPORT_EMAIL,
    storeLogoUrl: process.env.STORE_LOGO_URL,

    rateLimitMax: process.env.RATE_LIMIT_MAX,
    rateLimitWindowMs: process.env.RATE_LIMIT_WINDOW_MS,
    corsOrigins: process.env.CORS_ORIGINS,
  });

  if (!result.success) {
    const errors = result.error.flatten();
    console.error("❌ Invalid server configuration:\n");
    for (const [field, messages] of Object.entries(errors.fieldErrors)) {
      console.error(`  ${field}: ${(messages as string[]).join(", ")}`);
    }
    for (const msg of errors.formErrors) {
      console.error(`  (global): ${msg}`);
    }
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
export type Config = typeof config;
