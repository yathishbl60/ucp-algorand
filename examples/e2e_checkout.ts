/**
 * End-to-end TestNet demo
 *
 * Demonstrates the full UCP checkout flow against a locally running server:
 *   1. Discover business UCP profile (GET /.well-known/ucp)
 *   2. Create a checkout session
 *   3. Build, sign and submit an Algorand payment transaction
 *   4. Complete the checkout session with the confirmed txid
 *
 * Usage:
 *   # Terminal 1 — run the server
 *   cp .env.example .env
 *   # edit .env: set ALGORAND_NETWORK=testnet, ALGORAND_MERCHANT_ADDRESS=<your addr>
 *   npm run dev
 *
 *   # Terminal 2 — run this script with a funded TestNet account mnemonic
 *   BUYER_MNEMONIC="word1 word2 ... word25" npx tsx examples/e2e_checkout.ts
 */

import algosdk from "algosdk";

// ─── Configuration ────────────────────────────────────────────────────────────

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:8000";
const BUYER_MNEMONIC = process.env.BUYER_MNEMONIC;
const ALGOD_URL = process.env.ALGORAND_ALGOD_URL ?? "https://testnet-api.algonode.cloud";
const ALGOD_TOKEN = process.env.ALGORAND_ALGOD_TOKEN ?? "";

if (!BUYER_MNEMONIC) {
  console.error("ERROR: Set BUYER_MNEMONIC env var to a funded TestNet account mnemonic.");
  process.exit(1);
}

const algodClient = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_URL, "");
const buyerAccount = algosdk.mnemonicToSecretKey(BUYER_MNEMONIC);

// ─── Step 1: Discover the business profile ─────────────────────────────────

console.log("\n── Step 1: Discover UCP profile ──────────────────────────────────────");
const profileRes = await fetch(`${SERVER_URL}/.well-known/ucp`);
if (!profileRes.ok) {
  console.error(`Profile fetch failed: ${profileRes.status}`);
  process.exit(1);
}
const profile = (await profileRes.json()) as {
  ucp: {
    payment_handlers: Record<
      string,
      Array<{
        id: string;
        config?: { merchant_address?: string };
      }>
    >;
  };
};

const handlers = profile.ucp.payment_handlers;
const handlerEntries = Object.entries(handlers);
console.log(
  "Available handlers:",
  handlerEntries.map(([ns]) => ns),
);

if (handlerEntries.length === 0) {
  console.error("No payment handlers found in business profile.");
  process.exit(1);
}

const [handlerNs, handlerConfigs] = handlerEntries[0];
const handlerConfig = handlerConfigs?.[0];
const handlerId = handlerConfig?.id;
const merchantAddress = handlerConfig?.config?.merchant_address;
console.log(`Using handler: ${handlerNs} (id=${handlerId})`);
console.log(`Merchant address: ${merchantAddress}`);

if (!merchantAddress) {
  console.error("Merchant address not found in handler config.");
  process.exit(1);
}

// ─── Step 2: Create a checkout session ────────────────────────────────────

console.log("\n── Step 2: Create checkout session ────────────────────────────────────");
const createRes = await fetch(`${SERVER_URL}/ucp/v1/checkout-sessions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "UCP-Agent": `profile="${SERVER_URL}/platform-profile"`,
  },
  body: JSON.stringify({
    line_items: [
      {
        id: "sku_algorand_tee",
        description: "Algorand Community T-Shirt",
        quantity: 1,
        unit_price: 1_000_000, // 1 ALGO in microALGO
        currency: "ALGO",
      },
    ],
  }),
});

if (!createRes.ok) {
  console.error(`Create checkout failed: ${createRes.status}`, await createRes.text());
  process.exit(1);
}

const session = (await createRes.json()) as { id: string; totals: { total: number } };
const checkoutId = session.id;
const amountMicroAlgo = session.totals.total;
console.log(`Checkout session created: ${checkoutId}`);
console.log(`Amount due: ${amountMicroAlgo} microALGO (${amountMicroAlgo / 1_000_000} ALGO)`);

// ─── Step 3: Build and submit Algorand payment ─────────────────────────────

console.log("\n── Step 3: Submit Algorand payment ─────────────────────────────────────");
const suggestedParams = await algodClient.getTransactionParams().do();

const paymentTx = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
  from: buyerAccount.addr,
  to: merchantAddress,
  amount: amountMicroAlgo,
  // UCP spec requires the checkout ID in the transaction note
  note: new TextEncoder().encode(checkoutId),
  suggestedParams,
});

const signedTx = paymentTx.signTxn(buyerAccount.sk);
const { txId } = await algodClient.sendRawTransaction(signedTx).do();
console.log(`Transaction submitted: ${txId}`);
console.log("Waiting for confirmation...");

const confirmed = await algosdk.waitForConfirmation(algodClient, txId, 5);
const confirmedRound = confirmed["confirmed-round"] as number;
console.log(`Confirmed in round: ${confirmedRound}`);

// ─── Step 4: Complete the checkout session ─────────────────────────────────

console.log("\n── Step 4: Complete checkout session ──────────────────────────────────");
const completeRes = await fetch(`${SERVER_URL}/ucp/v1/checkout-sessions/${checkoutId}/complete`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "UCP-Agent": `profile="${SERVER_URL}/platform-profile"`,
  },
  body: JSON.stringify({
    payment: {
      instruments: [
        {
          handler_id: handlerId,
          type: "algo",
          credential: {
            algorand: {
              txid: txId,
              network: "testnet",
              asset_id: 0,
            },
          },
        },
      ],
    },
  }),
});

const completedSession = (await completeRes.json()) as {
  id: string;
  status: string;
  messages: unknown[];
};

console.log(`\nCheckout status: ${completedSession.status}`);
if (completedSession.messages.length > 0) {
  console.log("Messages:", JSON.stringify(completedSession.messages, null, 2));
}

if (completedSession.status === "complete") {
  console.log(`\n✓ Success! Checkout ${completedSession.id} completed.`);
  console.log(`  TxID: ${txId}`);
  console.log(`  Confirmed round: ${confirmedRound}`);
  console.log(`  Explorer: https://testnet.algoexplorer.io/tx/${txId}`);
} else {
  console.error(`\n✗ Checkout not completed. Status: ${completedSession.status}`);
  process.exit(1);
}
