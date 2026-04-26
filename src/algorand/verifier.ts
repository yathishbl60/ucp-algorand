/**
 * Algorand payment verifier.
 *
 * Validates an AlgorandCredential submitted by a platform against the
 * live Algorand network (algod + indexer). This is the on-chain
 * verification step in the UCP complete_checkout flow.
 *
 * Verification rules (all MUST pass):
 *   1. Transaction exists and is confirmed on the correct network.
 *   2. Transaction type is "pay" (ALGO) or "axfer" (ASA).
 *   3. Receiver matches the merchant's configured address.
 *   4. Asset ID matches an accepted asset (0 = ALGO).
 *   5. Amount >= expected checkout total (converted to microALGO / ASA base units).
 *   6. Transaction note contains the UCP checkout session ID (base64-encoded UTF-8).
 *   7. Confirmed round satisfies minConfirmations.
 */

import algosdk from "algosdk";
import type { Config } from "../config.js";
import type { AlgorandCredential, AlgorandNetwork } from "../types/ucp.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VerificationParams {
  credential: AlgorandCredential;
  /** Expected receiver (merchant address) */
  receiverAddress: string;
  /** Expected amount in minor units of the asset (microALGO for ALGO) */
  expectedAmount: bigint;
  /** Expected ASA ID (0 for native ALGO) */
  expectedAssetId: number;
  /** UCP checkout session ID — must appear in the tx note field */
  checkoutId: string;
  /** Minimum rounds to consider payment final */
  minConfirmations?: number;
}

export interface VerificationResult {
  valid: boolean;
  reason?: string;
  confirmedRound?: number;
  actualAmount?: bigint;
  senderAddress?: string;
}

// ─── AlgorandVerifier ────────────────────────────────────────────────────────

export class AlgorandVerifier {
  private readonly algodClient: algosdk.Algodv2;
  private readonly indexerClient: algosdk.Indexer;
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
    this.algodClient = new algosdk.Algodv2(config.algorandAlgodToken, config.algorandAlgodUrl, "");
    this.indexerClient = new algosdk.Indexer(
      config.algorandIndexerToken,
      config.algorandIndexerUrl,
      "",
    );
  }

  /**
   * Verify an Algorand payment credential against the live network.
   * Returns a `VerificationResult` — callers decide how to handle failures.
   */
  async verify(params: VerificationParams): Promise<VerificationResult> {
    const {
      credential,
      receiverAddress,
      expectedAmount,
      expectedAssetId,
      checkoutId,
      minConfirmations = this.config.algorandMinConfirmations,
    } = params;

    // Guard: network must match server config
    if (credential.network !== this.config.algorandNetwork) {
      return {
        valid: false,
        reason: `Network mismatch: credential is for '${credential.network}' but server is configured for '${this.config.algorandNetwork}'`,
      };
    }

    // Guard: txid format
    if (!/^[A-Z2-7]{52}$/.test(credential.txid)) {
      return { valid: false, reason: "Invalid Algorand transaction ID format" };
    }

    let txInfo: algosdk.indexerModels.Transaction;
    try {
      txInfo = await this.fetchTransaction(credential.txid, credential.round);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        valid: false,
        reason: `Could not fetch transaction from Algorand: ${message}`,
      };
    }

    // Must be confirmed
    if (!txInfo.confirmedRound) {
      return { valid: false, reason: "Transaction is not yet confirmed" };
    }

    const confirmedRound = Number(txInfo.confirmedRound);
    const currentRound = await this.getCurrentRound();
    if (currentRound - confirmedRound < minConfirmations) {
      return {
        valid: false,
        reason: `Insufficient confirmations: ${currentRound - confirmedRound} of required ${minConfirmations}`,
      };
    }

    // ── Asset / payment type validation ──────────────────────────────────────
    if (expectedAssetId === 0) {
      // ALGO payment
      const txType = (txInfo as unknown as { type?: string }).type;
      if (txType !== "pay") {
        return {
          valid: false,
          reason: `Expected ALGO payment (type=pay), got type=${txType ?? "unknown"}`,
        };
      }
      const payTxn = txInfo.paymentTransaction;
      if (!payTxn) {
        return { valid: false, reason: "Missing payment transaction details" };
      }
      if (!payTxn.receiver || payTxn.receiver !== receiverAddress) {
        return {
          valid: false,
          reason: `Receiver mismatch: expected ${receiverAddress}, got ${payTxn.receiver ?? "none"}`,
        };
      }
      const actualAmount = BigInt(payTxn.amount ?? 0);
      if (actualAmount < expectedAmount) {
        return {
          valid: false,
          reason: `Insufficient payment: expected ${expectedAmount} microALGO, got ${actualAmount}`,
          actualAmount,
        };
      }
      const noteCheck = this.verifyNote(txInfo.note, checkoutId);
      if (!noteCheck.valid) return noteCheck;

      return {
        valid: true,
        confirmedRound,
        actualAmount,
        senderAddress: txInfo.sender,
      };
    }
    // ASA payment
    const txType2 = (txInfo as unknown as { type?: string }).type;
    if (txType2 !== "axfer") {
      return {
        valid: false,
        reason: `Expected ASA transfer (type=axfer), got type=${txType2 ?? "unknown"}`,
      };
    }
    const axferTxn = txInfo.assetTransferTransaction;
    if (!axferTxn) {
      return { valid: false, reason: "Missing asset transfer details" };
    }
    if (Number(axferTxn.assetId) !== expectedAssetId) {
      return {
        valid: false,
        reason: `ASA ID mismatch: expected ${expectedAssetId}, got ${axferTxn.assetId}`,
      };
    }
    if (!axferTxn.receiver || axferTxn.receiver !== receiverAddress) {
      return {
        valid: false,
        reason: `Receiver mismatch: expected ${receiverAddress}, got ${axferTxn.receiver ?? "none"}`,
      };
    }
    const actualAmount = BigInt(axferTxn.amount ?? 0);
    if (actualAmount < expectedAmount) {
      return {
        valid: false,
        reason: `Insufficient ASA amount: expected ${expectedAmount}, got ${actualAmount}`,
        actualAmount,
      };
    }
    const noteCheck = this.verifyNote(txInfo.note, checkoutId);
    if (!noteCheck.valid) return noteCheck;

    return {
      valid: true,
      confirmedRound,
      actualAmount,
      senderAddress: txInfo.sender,
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Fetch transaction details. Prefers a fast algod lookup by confirmed round
   * when available; falls back to indexer search by txid.
   */
  private async fetchTransaction(
    txid: string,
    round?: number,
  ): Promise<algosdk.indexerModels.Transaction> {
    if (round !== undefined) {
      try {
        // algod lookup is O(1) and doesn't require indexer
        const info = await this.algodClient.pendingTransactionInformation(txid).do();
        if (info.confirmedRound) {
          // Convert algod response to indexer-like shape via indexer lookup
          // (algod pending tx is a different type; use indexer for consistency)
        }
      } catch {
        // pending tx not available (already pruned from algod) — fall through
      }
    }

    // Indexer lookup — always authoritative
    const response = await this.indexerClient.lookupTransactionByID(txid).do();
    return response.transaction;
  }

  /**
   * Get the latest confirmed Algorand round from algod.
   */
  private async getCurrentRound(): Promise<number> {
    const status = await this.algodClient.status().do();
    // algosdk v3: property is camelCase 'lastRound'
    const lastRound =
      (status as unknown as { lastRound?: number }).lastRound ??
      (status as unknown as Record<string, number>)["last-round"] ??
      0;
    return Number(lastRound);
  }

  /**
   * Verify that the transaction note contains the checkout session ID.
   * The note must be base64-encoded UTF-8 containing the checkout ID.
   */
  private verifyNote(note: Uint8Array | undefined, checkoutId: string): VerificationResult {
    if (!note || note.length === 0) {
      return {
        valid: false,
        reason: `Transaction note is empty — must contain checkout ID: ${checkoutId}`,
      };
    }
    try {
      const decoded = Buffer.from(note).toString("utf-8");
      if (!decoded.includes(checkoutId)) {
        return {
          valid: false,
          reason: `Transaction note does not contain checkout ID '${checkoutId}'. Got: '${decoded.slice(0, 64)}'`,
        };
      }
    } catch {
      return {
        valid: false,
        reason: "Could not decode transaction note as UTF-8",
      };
    }
    return { valid: true };
  }

  /**
   * Convenience: check algod connectivity. Used in health checks.
   */
  async healthCheck(): Promise<{ algod: boolean; indexer: boolean }> {
    const [algodOk, indexerOk] = await Promise.allSettled([
      this.algodClient.status().do(),
      this.indexerClient.makeHealthCheck().do(),
    ]);
    return {
      algod: algodOk.status === "fulfilled",
      indexer: indexerOk.status === "fulfilled",
    };
  }
}
