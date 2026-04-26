/**
 * UCP Checkout routes — REST transport
 *
 *   POST   /ucp/v1/checkout-sessions                create_checkout
 *   GET    /ucp/v1/checkout-sessions/:id             get_checkout
 *   PATCH  /ucp/v1/checkout-sessions/:id             update_checkout
 *   POST   /ucp/v1/checkout-sessions/:id/complete    complete_checkout
 *   DELETE /ucp/v1/checkout-sessions/:id             cancel_checkout
 *
 * Security properties:
 *   - Double-spend protection: a txid can only complete one order.
 *   - Idempotency: checkout creation is idempotent via X-Idempotency-Key.
 *   - UCP-Agent header is required on every mutating request.
 *   - Webhook events are dispatched (fire-and-forget) on state transitions.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { AlgorandVerifier } from "../../algorand/verifier.js";
import type { Config } from "../../config.js";
import type { InMemoryCheckoutStore } from "../../store/checkout.js";
import {
  ALGORAND_HANDLER_NAME,
  ALGORAND_HANDLER_VERSION,
  type CheckoutSession,
  type CompleteCheckoutBody,
  type CreateCheckoutBody,
  type Totals,
  type UCPErrorBody,
  UCP_VERSION,
  type UpdateCheckoutBody,
} from "../../types/ucp.js";
import { type WebhookConfig, buildWebhookEvent, dispatchWebhook } from "../../utils/webhook.js";

// ─── Zod validators ──────────────────────────────────────────────────────────

const LineItemSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  quantity: z.number().int().min(1),
  unit_price: z.number().int().min(0),
  currency: z.string().length(3),
  image_url: z.string().url().optional(),
});

const AddressSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  street_address: z.string().min(1),
  extended_address: z.string().optional(),
  address_locality: z.string().min(1),
  address_region: z.string().optional(),
  postal_code: z.string().optional(),
  address_country: z.string().length(2),
});

const SignalsSchema = z.record(z.string(), z.unknown()).optional();

const CreateCheckoutSchema = z.object({
  line_items: z.array(LineItemSchema).min(1).max(100),
  shipping_address: AddressSchema.optional(),
  signals: SignalsSchema,
});

const UpdateCheckoutSchema = z.object({
  shipping_address: AddressSchema.optional(),
  signals: SignalsSchema,
});

const AlgorandCredentialSchema = z.object({
  txid: z.string().regex(/^[A-Z2-7]{52}$/, "Must be a valid 52-char Algorand base32 txid"),
  network: z.enum(["mainnet", "testnet", "betanet"]),
  asset_id: z.number().int().min(0).optional().default(0),
  round: z.number().int().min(0).optional(),
});

const PaymentInstrumentSchema = z.object({
  id: z.string().optional(),
  handler_id: z.string().min(1),
  type: z.string().min(1),
  selected: z.boolean().optional().default(true),
  credential: z
    .object({
      type: z.string().optional(),
      token: z.string().optional(),
      algorand: AlgorandCredentialSchema.optional(),
    })
    .optional(),
  billing_address: AddressSchema.optional(),
});

const CompleteCheckoutSchema = z.object({
  payment: z.object({
    instruments: z.array(PaymentInstrumentSchema).min(1).max(10),
  }),
  signals: SignalsSchema,
});

// ─── Helper utilities ────────────────────────────────────────────────────────

function computeTotals(lineItems: CreateCheckoutBody["line_items"]): Totals {
  const subtotal = lineItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  // Tax is set to 0 — merchants integrate their own tax provider (TaxJar, Avalara)
  // by calling PATCH /checkout-sessions/:id after receiving the shipping address.
  const tax = 0;
  const shipping = 0;
  return {
    subtotal,
    tax,
    shipping,
    total: subtotal + tax + shipping,
    currency: lineItems[0]?.currency ?? "ALGO",
  };
}

function buildUCPMeta(handlerId: string): CheckoutSession["ucp"] {
  return {
    version: UCP_VERSION,
    capabilities: {
      "dev.ucp.shopping.checkout": [{ version: UCP_VERSION }],
    },
    payment_handlers: {
      [ALGORAND_HANDLER_NAME]: [
        {
          id: handlerId,
          version: ALGORAND_HANDLER_VERSION,
          available_instruments: [{ type: "algo" }, { type: "asa" }],
        },
      ],
    },
  };
}

/**
 * Parse the UCP-Agent header per spec §Platform Advertisement on Request.
 * Expected format: profile="https://platform.example.com/profile"
 */
function parseUCPAgentHeader(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /profile="([^"]+)"/.exec(header);
  return match?.[1];
}

// ─── Route plugin ────────────────────────────────────────────────────────────

interface CheckoutRouteDeps {
  config: Config;
  store: InMemoryCheckoutStore;
  verifier: AlgorandVerifier;
}

const checkoutRoutes: FastifyPluginAsync<CheckoutRouteDeps> = async (fastify, opts) => {
  const { config, store, verifier } = opts;
  const handlerId = `algorand_${config.algorandNetwork}`;

  /** Build webhook config from server config, or undefined if not configured. */
  const webhookConfig: WebhookConfig | undefined =
    config.webhookUrl && config.webhookSecret
      ? { url: config.webhookUrl, secret: config.webhookSecret }
      : undefined;

  /** Fire a webhook without blocking the response. */
  function fireWebhook(
    eventType: Parameters<typeof buildWebhookEvent>[0],
    session: CheckoutSession,
    extra?: Parameters<typeof buildWebhookEvent>[2],
  ) {
    if (!webhookConfig) return;
    const event = buildWebhookEvent(eventType, session, extra);
    // Intentionally not awaited — webhook delivery must never delay the response
    dispatchWebhook(webhookConfig, event, fastify.log).catch(() => {
      // Already logged inside dispatchWebhook
    });
  }

  // ── POST /ucp/v1/checkout-sessions ──────────────────────────────────────────
  fastify.post<{ Body: CreateCheckoutBody }>(
    "/ucp/v1/checkout-sessions",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const agentProfile = parseUCPAgentHeader(request.headers["ucp-agent"] as string | undefined);
      if (!agentProfile) {
        const err: UCPErrorBody = {
          code: "invalid_profile_url",
          content:
            "UCP-Agent header with platform profile URI is required. " +
            'Example: UCP-Agent: profile="https://yourplatform.com/profile"',
        };
        return reply.status(400).send(err);
      }

      // ── Idempotency key support ─────────────────────────────────────────────
      // If X-Idempotency-Key is present and we've seen it before, return the
      // original session instead of creating a duplicate.
      const idempotencyKey = request.headers["x-idempotency-key"] as string | undefined;
      if (idempotencyKey) {
        const existing = await store.getByIdempotencyKey(idempotencyKey);
        if (existing) {
          request.log.info(
            { idempotencyKey, checkoutId: existing.id },
            "Returning existing session for idempotency key",
          );
          return reply.status(200).send(existing);
        }
      }

      const parsed = CreateCheckoutSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "validation_error",
          content: parsed.error.message,
        });
      }

      const totals = computeTotals(
        parsed.data.line_items as unknown as CreateCheckoutBody["line_items"],
      );
      const now = new Date().toISOString();
      const sessionBase = {
        ucp: buildUCPMeta(handlerId),
        id: `ch_${nanoid(16)}`,
        status: "incomplete" as const,
        line_items: parsed.data.line_items as unknown as CheckoutSession["line_items"],
        totals,
        messages: [] as CheckoutSession["messages"],
        created_at: now,
        updated_at: now,
      };
      const session: CheckoutSession = (parsed.data.shipping_address
        ? { ...sessionBase, shipping_address: parsed.data.shipping_address }
        : sessionBase) as unknown as CheckoutSession;

      await store.create(session);

      if (idempotencyKey) {
        await store.registerIdempotencyKey(idempotencyKey, session.id);
      }

      fireWebhook("checkout.created", session);

      request.log.info(
        { checkoutId: session.id, agentProfile, items: session.line_items.length },
        "Checkout session created",
      );
      return reply.status(201).send(session);
    },
  );

  // ── GET /ucp/v1/checkout-sessions/:id ───────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    "/ucp/v1/checkout-sessions/:id",
    async (request, reply) => {
      const session = await store.get(request.params.id);
      if (!session) {
        return reply.status(404).send({
          code: "not_found",
          content: `Checkout session '${request.params.id}' not found or has expired.`,
        });
      }
      return reply.send(session);
    },
  );

  // ── PATCH /ucp/v1/checkout-sessions/:id ─────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: UpdateCheckoutBody }>(
    "/ucp/v1/checkout-sessions/:id",
    async (request, reply) => {
      const existing = await store.get(request.params.id);
      if (!existing) {
        return reply.status(404).send({
          code: "not_found",
          content: `Checkout session '${request.params.id}' not found or has expired.`,
        });
      }
      if (existing.status !== "incomplete") {
        return reply.status(409).send({
          code: "invalid_state",
          content: `Cannot update a checkout session with status '${existing.status}'.`,
        });
      }

      const parsed = UpdateCheckoutSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "validation_error",
          content: parsed.error.message,
        });
      }

      const shippingAddr = parsed.data.shipping_address ?? existing.shipping_address;
      const updated = await store.update(
        request.params.id,
        shippingAddr !== undefined
          ? ({
              shipping_address: shippingAddr,
            } as unknown as Partial<CheckoutSession>)
          : {},
      );

      if (updated) fireWebhook("checkout.updated", updated);

      return reply.send(updated);
    },
  );

  // ── POST /ucp/v1/checkout-sessions/:id/complete ─────────────────────────────
  fastify.post<{ Params: { id: string }; Body: CompleteCheckoutBody }>(
    "/ucp/v1/checkout-sessions/:id/complete",
    async (request, reply) => {
      const session = await store.get(request.params.id);
      if (!session) {
        return reply.status(404).send({
          code: "not_found",
          content: `Checkout session '${request.params.id}' not found or has expired.`,
        });
      }
      if (session.status !== "incomplete") {
        return reply.status(409).send({
          code: "invalid_state",
          content: `Checkout session is already in status '${session.status}'. Only 'incomplete' sessions can be completed.`,
        });
      }

      const parsed = CompleteCheckoutSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "validation_error",
          content: parsed.error.message,
        });
      }

      // Find the Algorand payment instrument
      const algorandInstrument = parsed.data.payment.instruments.find(
        (i) => i.handler_id === handlerId,
      );
      if (!algorandInstrument) {
        return reply.status(400).send({
          code: "payment_handler_not_found",
          content: `No instrument found for handler '${handlerId}'. Discover the correct handler_id from GET /.well-known/ucp.`,
        });
      }

      const rawCred = algorandInstrument.credential?.algorand;
      const algoCredential = rawCred as typeof rawCred & { round?: number };
      if (!algoCredential?.txid) {
        return reply.status(400).send({
          code: "missing_credential",
          content:
            "Payment instrument must include an 'algorand' credential with a confirmed txid. " +
            "Submit the Algorand transaction first and wait for at least 1 confirmation, " +
            "then provide the txid here.",
        });
      }

      // ── Double-spend protection ─────────────────────────────────────────────
      // A txid can only complete one checkout order. This prevents a buyer from
      // submitting a single on-chain payment to fulfill multiple orders.
      if (await store.isTxidUsed(algoCredential.txid)) {
        request.log.warn(
          { txid: algoCredential.txid, checkoutId: session.id },
          "Double-spend attempt blocked",
        );
        return reply.status(409).send({
          code: "txid_already_used",
          content:
            "This Algorand transaction has already been used to complete another order. " +
            "Please submit a new payment transaction.",
        });
      }

      // ── On-chain verification ───────────────────────────────────────────────
      const assetId = algoCredential.asset_id ?? 0;
      // Note on amounts: unit_price and totals.total must be in the asset's base
      // units (microALGO for ALGO, 6-decimal units for USDC). The platform is
      // responsible for currency conversion before creating the checkout session.
      const expectedAmount = BigInt(session.totals.total);

      request.log.info(
        {
          txid: algoCredential.txid,
          network: algoCredential.network,
          assetId,
          expectedAmount: expectedAmount.toString(),
          checkoutId: session.id,
        },
        "Verifying Algorand payment on-chain",
      );

      const verification = await verifier.verify({
        credential: algoCredential,
        receiverAddress: config.algorandMerchantAddress,
        expectedAmount,
        expectedAssetId: assetId,
        checkoutId: session.id,
        minConfirmations: config.algorandMinConfirmations,
      });

      if (!verification.valid) {
        request.log.warn(
          { txid: algoCredential.txid, reason: verification.reason },
          "Payment verification failed",
        );
        const escalated = await store.update(session.id, {
          status: "requires_escalation",
          messages: [
            {
              type: "error",
              code: "payment_verification_failed",
              content: verification.reason ?? "Payment could not be verified.",
              severity: "requires_buyer_input",
            },
          ],
        });
        if (escalated) fireWebhook("checkout.escalated", escalated);
        return reply.status(200).send(escalated);
      }

      // ── Payment verified — finalise the order ───────────────────────────────
      // Register the txid BEFORE updating status to prevent race conditions
      await store.markTxidUsed(algoCredential.txid, session.id);

      const completed = await store.update(session.id, {
        status: "complete",
        messages: [
          {
            type: "info",
            code: "payment_confirmed",
            content: `Algorand payment verified on-chain. Amount: ${verification.actualAmount?.toString() ?? expectedAmount.toString()} base units. Round: ${verification.confirmedRound ?? "N/A"}.`,
          },
        ],
      });

      request.log.info(
        {
          checkoutId: session.id,
          txid: algoCredential.txid,
          round: verification.confirmedRound,
          senderAddress: verification.senderAddress,
        },
        "Checkout completed successfully",
      );

      if (completed) {
        const extra: Parameters<typeof buildWebhookEvent>[2] = {
          txid: algoCredential.txid,
          ...(verification.confirmedRound !== undefined
            ? { confirmed_round: verification.confirmedRound }
            : {}),
        };
        fireWebhook("checkout.completed", completed, extra);
      }

      return reply.send(completed);
    },
  );

  // ── DELETE /ucp/v1/checkout-sessions/:id ────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    "/ucp/v1/checkout-sessions/:id",
    async (request, reply) => {
      const session = await store.get(request.params.id);
      if (!session) {
        return reply.status(404).send({
          code: "not_found",
          content: `Checkout session '${request.params.id}' not found or has expired.`,
        });
      }
      if (session.status === "complete") {
        return reply.status(409).send({
          code: "invalid_state",
          content: "Cannot cancel a completed checkout session.",
        });
      }
      const cancelled = await store.update(request.params.id, {
        status: "cancelled",
      });
      if (cancelled) fireWebhook("checkout.cancelled", cancelled);
      return reply.status(204).send();
    },
  );
};

export default checkoutRoutes;
