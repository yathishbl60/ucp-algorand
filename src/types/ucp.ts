/**
 * UCP Protocol types — aligned with the UCP specification v2026-04-08.
 * https://ucp.dev/specification/overview
 */

export const UCP_VERSION = "2026-04-08" as const;
export const ALGORAND_HANDLER_VERSION = "2026-04-26" as const;
export const ALGORAND_HANDLER_NAME = "org.algorand.shopping.payment_handler" as const;

// ─── Core metadata ────────────────────────────────────────────────────────────

export interface UCPCapabilityRef {
  version: string;
}

export interface UCPPaymentHandlerRef {
  id: string;
  version: string;
  available_instruments?: PaymentInstrumentDescriptor[];
}

export interface UCPResponseMeta {
  version: typeof UCP_VERSION;
  capabilities: Record<string, UCPCapabilityRef[]>;
  payment_handlers?: Record<string, UCPPaymentHandlerRef[]>;
  status?: "error";
}

// ─── Messages ────────────────────────────────────────────────────────────────

export type MessageType = "error" | "info" | "warning";
export type MessageSeverity = "recoverable" | "requires_buyer_input" | "unrecoverable";

export interface UCPMessage {
  type: MessageType;
  code: string;
  content: string;
  severity?: MessageSeverity;
  /** JSONPath pointing to the problematic field */
  path?: string;
}

// ─── Commerce primitives ─────────────────────────────────────────────────────

export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  /** Price in minor units (e.g. cents for USD) */
  unit_price: number;
  currency: string;
  image_url?: string;
}

export interface Totals {
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;
}

export interface Address {
  first_name?: string;
  last_name?: string;
  street_address: string;
  extended_address?: string;
  address_locality: string;
  address_region?: string;
  postal_code?: string;
  /** ISO 3166-1 alpha-2 */
  address_country: string;
}

// ─── Signals ────────────────────────────────────────────────────────────────

export interface Signals {
  "dev.ucp.buyer_ip"?: string;
  "dev.ucp.user_agent"?: string;
  [key: string]: unknown;
}

// ─── Algorand payment types ──────────────────────────────────────────────────

export type AlgorandNetwork = "mainnet" | "testnet" | "betanet";

/**
 * On-chain proof provided by the platform in complete_checkout.
 * The server verifies this against the Algorand indexer/algod.
 */
export interface AlgorandCredential {
  /** Confirmed Algorand transaction ID (base32, 52 uppercase chars) */
  txid: string;
  network: AlgorandNetwork;
  /** ASA ID used; 0 = native ALGO */
  asset_id?: number;
  /** Confirmed Algorand round number — speeds up indexer lookup */
  round?: number;
}

// ─── Payment ─────────────────────────────────────────────────────────────────

export interface PaymentInstrumentDescriptor {
  type: "algo" | "asa" | string;
  constraints?: {
    asset_ids?: number[];
    brands?: string[];
    [key: string]: unknown;
  };
}

export interface PaymentCredential {
  type?: string;
  token?: string;
  /** Populated for Algorand payments */
  algorand?: AlgorandCredential;
}

export interface PaymentInstrument {
  id?: string;
  handler_id: string;
  type: string;
  selected?: boolean;
  credential?: PaymentCredential;
  display?: Record<string, unknown>;
  billing_address?: Address;
}

export interface Payment {
  instruments: PaymentInstrument[];
}

// ─── Checkout ────────────────────────────────────────────────────────────────

export type CheckoutStatus =
  | "incomplete"
  | "complete"
  | "requires_escalation"
  | "cancelled"
  | "error";

export interface CheckoutSession {
  ucp: UCPResponseMeta;
  id: string;
  status: CheckoutStatus;
  line_items: LineItem[];
  totals: Totals;
  shipping_address?: Address;
  messages: UCPMessage[];
  continue_url?: string;
  /** ISO-8601 */
  created_at: string;
  updated_at: string;
}

// ─── Request bodies ──────────────────────────────────────────────────────────

export interface CreateCheckoutBody {
  line_items: LineItem[];
  shipping_address?: Address;
  signals?: Signals;
}

export interface UpdateCheckoutBody {
  shipping_address?: Address;
  signals?: Signals;
}

export interface CompleteCheckoutBody {
  payment: Payment;
  signals?: Signals;
}

// ─── Error responses ─────────────────────────────────────────────────────────

export interface UCPErrorBody {
  code: string;
  content: string;
  continue_url?: string;
}
