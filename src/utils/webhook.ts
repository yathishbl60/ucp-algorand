/**
 * Webhook dispatcher.
 *
 * Delivers checkout lifecycle events to a configured merchant endpoint.
 * Payload is signed with HMAC-SHA256 so merchants can verify authenticity.
 *
 * Delivery guarantee: at-least-once with 3 attempts and exponential back-off.
 * Merchants MUST implement idempotent event handlers.
 *
 * Signature format (set in X-UCP-Signature header):
 *   sha256=<hex digest of the raw JSON body signed with WEBHOOK_SECRET>
 *
 * Verifying in Express/Fastify:
 *   const sig = createHmac("sha256", secret).update(rawBody).digest("hex");
 *   assert.strictEqual(sig, req.headers["x-ucp-signature"].replace("sha256=", ""));
 */

import { createHmac } from "node:crypto";
import type { CheckoutSession } from "../types/ucp.js";

// ─── Event types ─────────────────────────────────────────────────────────────

export type WebhookEventType =
  | "checkout.created"
  | "checkout.updated"
  | "checkout.completed"
  | "checkout.cancelled"
  | "checkout.escalated";

export interface WebhookEvent {
  /** Unique delivery ID — use this for idempotency in your handler */
  delivery_id: string;
  event_type: WebhookEventType;
  /** ISO-8601 timestamp when the event was generated */
  timestamp: string;
  /** The full checkout session at the time of the event */
  checkout: CheckoutSession;
  /** Algorand txid — only present on checkout.completed events */
  txid?: string;
  /** Algorand confirmed round — only present on checkout.completed events */
  confirmed_round?: number;
}

// ─── Configuration ────────────────────────────────────────────────────────────

export interface WebhookConfig {
  url: string;
  /** HMAC-SHA256 signing secret */
  secret: string;
  /** Timeout per attempt in milliseconds (default: 10s) */
  timeoutMs?: number;
  /** Maximum delivery attempts (default: 3) */
  maxAttempts?: number;
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Dispatch a webhook event with retry logic.
 *
 * Does NOT throw on delivery failure — logs the error and returns false.
 * The caller should log failed deliveries for manual retry / dead-letter queue.
 */
export async function dispatchWebhook(
  config: WebhookConfig,
  event: WebhookEvent,
  logger?: { warn: (obj: unknown, msg: string) => void },
): Promise<boolean> {
  const body = JSON.stringify(event);
  const signature = createHmac("sha256", config.secret).update(body).digest("hex");
  const maxAttempts = config.maxAttempts ?? 3;
  const timeoutMs = config.timeoutMs ?? 10_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UCP-Signature": `sha256=${signature}`,
          "X-UCP-Event": event.event_type,
          "X-UCP-Delivery": event.delivery_id,
          "User-Agent": "ucp-algorand/1.0",
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.ok) return true;

      // 4xx = misconfigured endpoint, don't retry
      if (res.status >= 400 && res.status < 500) {
        logger?.warn(
          { status: res.status, url: config.url, eventType: event.event_type },
          "Webhook endpoint returned 4xx — not retrying",
        );
        return false;
      }

      // 5xx — server-side issue, retry after back-off
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger?.warn(
        { attempt, maxAttempts, url: config.url, error: message },
        "Webhook delivery attempt failed",
      );
    }

    if (attempt < maxAttempts) {
      // Exponential back-off: 1s, 2s, 4s…
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }

  logger?.warn(
    { url: config.url, eventType: event.event_type, deliveryId: event.delivery_id },
    `Webhook delivery failed after ${maxAttempts} attempts`,
  );
  return false;
}

/** Build a webhook event from a checkout session */
export function buildWebhookEvent(
  eventType: WebhookEventType,
  checkout: CheckoutSession,
  extra?: { txid?: string; confirmed_round?: number },
): WebhookEvent {
  return {
    delivery_id: crypto.randomUUID(),
    event_type: eventType,
    timestamp: new Date().toISOString(),
    checkout,
    ...extra,
  };
}
