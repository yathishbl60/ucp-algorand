/**
 * Algorand UCP Payment Escrow — ARC-4 smart contract.
 *
 * Provides trustless UCP checkout payments:
 *   - Platform locks funds in escrow tied to a UCP checkout session ID.
 *   - Business calls `releasePayment` once goods/services are confirmed.
 *   - Buyer can trigger `refundPayment` if the business calls `cancelSession`.
 *
 * This module handles building and submitting the ABI method calls via algosdk.
 * The PyTeal/TEALScript source is in contracts/PaymentEscrow.teal (deploy separately).
 */

import algosdk from "algosdk";
import type { Config } from "../config.js";

// ARC-4 ABI method signatures for the PaymentEscrow contract
const ABI_METHODS = {
  initiatePayment: algosdk.ABIMethod.fromSignature("initiatePayment(string,uint64,uint64)void"),
  releasePayment: algosdk.ABIMethod.fromSignature("releasePayment(string)void"),
  refundPayment: algosdk.ABIMethod.fromSignature("refundPayment(string)void"),
  getPaymentStatus: algosdk.ABIMethod.fromSignature(
    "getPaymentStatus(string)(uint8,uint64,address)",
  ),
} as const;

export type PaymentStatusCode = 0 | 1 | 2 | 3; // PENDING, RELEASED, REFUNDED, CANCELLED

export interface EscrowPaymentStatus {
  statusCode: PaymentStatusCode;
  amount: bigint;
  buyer: string;
}

export class PaymentEscrowClient {
  private readonly algodClient: algosdk.Algodv2;
  private readonly appId: number;

  constructor(config: Config) {
    if (!config.algorandEscrowAppId) {
      throw new Error("ALGORAND_ESCROW_APP_ID is required to use the escrow contract");
    }
    this.appId = config.algorandEscrowAppId;
    this.algodClient = new algosdk.Algodv2(config.algorandAlgodToken, config.algorandAlgodUrl, "");
  }

  /**
   * Build an `initiatePayment` atomic transaction group.
   * The caller (platform) must sign and submit this group.
   *
   * @param checkoutId  - UCP checkout session ID
   * @param amount      - Payment amount in microALGO or ASA base units
   * @param assetId     - 0 for native ALGO; ASA ID otherwise
   * @param buyerAddress - Platform / buyer Algorand address
   */
  async buildInitiatePaymentTxns(
    checkoutId: string,
    amount: bigint,
    assetId: number,
    buyerAddress: string,
  ): Promise<algosdk.Transaction[]> {
    const suggestedParams = await this.algodClient.getTransactionParams().do();

    const atc = new algosdk.AtomicTransactionComposer();

    if (assetId === 0) {
      // ALGO payment: send ALGO to the escrow app
      atc.addMethodCall({
        appID: this.appId,
        method: ABI_METHODS.initiatePayment,
        methodArgs: [checkoutId, amount, BigInt(assetId)],
        sender: buyerAddress,
        suggestedParams,
        signer: algosdk.makeEmptyTransactionSigner(),
      });
    } else {
      // ASA payment: include an axfer of the ASA alongside the method call
      atc.addMethodCall({
        appID: this.appId,
        method: ABI_METHODS.initiatePayment,
        methodArgs: [checkoutId, amount, BigInt(assetId)],
        sender: buyerAddress,
        suggestedParams,
        signer: algosdk.makeEmptyTransactionSigner(),
      });
    }

    const group = atc.buildGroup();
    return group.map((txnWithSigner) => txnWithSigner.txn);
  }

  /**
   * Submit a signed `releasePayment` call (merchant side).
   * Signs with the provided merchant signer.
   */
  async releasePayment(
    checkoutId: string,
    merchantSigner: algosdk.TransactionSigner,
    merchantAddress: string,
  ): Promise<string> {
    const suggestedParams = await this.algodClient.getTransactionParams().do();
    const atc = new algosdk.AtomicTransactionComposer();

    atc.addMethodCall({
      appID: this.appId,
      method: ABI_METHODS.releasePayment,
      methodArgs: [checkoutId],
      sender: merchantAddress,
      suggestedParams,
      signer: merchantSigner,
    });

    const result = await atc.execute(this.algodClient, 4);
    return result.txIDs[0] ?? "";
  }

  /**
   * Submit a signed `refundPayment` call.
   * Can be called by the merchant (cancellation) or buyer (dispute).
   */
  async refundPayment(
    checkoutId: string,
    callerSigner: algosdk.TransactionSigner,
    callerAddress: string,
  ): Promise<string> {
    const suggestedParams = await this.algodClient.getTransactionParams().do();
    const atc = new algosdk.AtomicTransactionComposer();

    atc.addMethodCall({
      appID: this.appId,
      method: ABI_METHODS.refundPayment,
      methodArgs: [checkoutId],
      sender: callerAddress,
      suggestedParams,
      signer: callerSigner,
    });

    const result = await atc.execute(this.algodClient, 4);
    return result.txIDs[0] ?? "";
  }

  /**
   * Read-only query for the escrow status of a checkout session.
   */
  async getPaymentStatus(checkoutId: string, callerAddress: string): Promise<EscrowPaymentStatus> {
    const suggestedParams = await this.algodClient.getTransactionParams().do();
    const atc = new algosdk.AtomicTransactionComposer();

    atc.addMethodCall({
      appID: this.appId,
      method: ABI_METHODS.getPaymentStatus,
      methodArgs: [checkoutId],
      sender: callerAddress,
      suggestedParams,
      signer: algosdk.makeEmptyTransactionSigner(),
    });

    const result = await atc.simulate(this.algodClient);
    const returnValue = result.methodResults[0]?.returnValue as
      | [number, bigint, string]
      | undefined;

    if (!returnValue) {
      throw new Error(`No return value for checkout ${checkoutId}`);
    }

    return {
      statusCode: returnValue[0] as PaymentStatusCode,
      amount: returnValue[1],
      buyer: returnValue[2],
    };
  }
}
