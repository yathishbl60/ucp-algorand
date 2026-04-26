/**
 * Checkout store.
 *
 * Defines the CheckoutStore interface and an in-memory implementation.
 * Swap InMemoryCheckoutStore for a Redis or Postgres-backed store without
 * changing any application code — the interface is the boundary.
 */

import type { CheckoutSession } from "../types/ucp.js";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface CheckoutStore {
  create(session: CheckoutSession): Promise<void>;
  get(id: string): Promise<CheckoutSession | undefined>;
  update(id: string, partial: Partial<CheckoutSession>): Promise<CheckoutSession | undefined>;
  delete(id: string): Promise<boolean>;
  /** Used by health checks and admin endpoints */
  size(): Promise<number>;
}

// ─── In-memory implementation ─────────────────────────────────────────────────
// Suitable for single-instance deployments and testing.
// Replace with RedisCheckoutStore or PostgresCheckoutStore for production clusters.

export class InMemoryCheckoutStore implements CheckoutStore {
  private readonly sessions = new Map<string, CheckoutSession>();

  /**
   * Txid → checkoutId registry — prevents the same on-chain transaction from
   * completing more than one order (double-spend protection).
   */
  private readonly txidRegistry = new Map<string, string>();

  /**
   * Idempotency key → checkoutId — lets platforms safely retry checkout creation
   * without creating duplicate orders.
   */
  private readonly idempotencyRegistry = new Map<string, string>();

  /**
   * Optional TTL in milliseconds. Sessions older than this are automatically
   * evicted on next access. Defaults to 24 hours.
   */
  private readonly ttlMs: number;

  constructor(ttlMs = 24 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  async create(session: CheckoutSession): Promise<void> {
    this.sessions.set(session.id, structuredClone(session));
  }

  async get(id: string): Promise<CheckoutSession | undefined> {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    // TTL eviction — expired sessions are silently dropped on read
    const age = Date.now() - new Date(session.created_at).getTime();
    if (age > this.ttlMs) {
      this.sessions.delete(id);
      return undefined;
    }

    return structuredClone(session);
  }

  async update(
    id: string,
    partial: Partial<CheckoutSession>,
  ): Promise<CheckoutSession | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;

    const updated: CheckoutSession = {
      ...existing,
      ...partial,
      id, // never allow overwriting the id
      updated_at: new Date().toISOString(),
    };
    this.sessions.set(id, updated);
    return structuredClone(updated);
  }

  async delete(id: string): Promise<boolean> {
    return this.sessions.delete(id);
  }

  async size(): Promise<number> {
    return this.sessions.size;
  }

  // ── Double-spend protection ──────────────────────────────────────────────────

  /**
   * Returns true if this Algorand txid has already been used to complete any
   * checkout session. Must be checked BEFORE finalising a payment.
   */
  async isTxidUsed(txid: string): Promise<boolean> {
    return this.txidRegistry.has(txid);
  }

  /**
   * Permanently records that a txid has been consumed for a checkout session.
   * Call this only after successful on-chain verification.
   */
  async markTxidUsed(txid: string, checkoutId: string): Promise<void> {
    this.txidRegistry.set(txid, checkoutId);
  }

  // ── Idempotency ──────────────────────────────────────────────────────────────

  /**
   * Returns the existing checkout session for an idempotency key, or undefined
   * if the key has not been seen before.
   */
  async getByIdempotencyKey(idempotencyKey: string): Promise<CheckoutSession | undefined> {
    const sessionId = this.idempotencyRegistry.get(idempotencyKey);
    if (!sessionId) return undefined;
    return this.get(sessionId);
  }

  /**
   * Associates an idempotency key with a checkout session ID.
   */
  async registerIdempotencyKey(idempotencyKey: string, checkoutId: string): Promise<void> {
    this.idempotencyRegistry.set(idempotencyKey, checkoutId);
  }
}
