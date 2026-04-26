/**
 * AI Agent Autonomous Checkout — UCP + Algorand
 *
 * This example simulates an AI agent (think: GPT tool, Claude MCP, AutoGPT action)
 * autonomously purchasing a digital product from a UCP-compatible merchant.
 *
 * The agent does everything without human input:
 *   1. Discovers what the merchant accepts
 *   2. Creates a checkout session
 *   3. Signs and submits an Algorand payment
 *   4. Waits for on-chain confirmation
 *   5. Completes the checkout
 *
 * To run:
 *   AGENT_MNEMONIC="word1 ... word25" npx tsx examples/ai_agent_checkout.ts
 *
 * Get a funded TestNet wallet:
 *   node --input-type=module -e "
 *     import algosdk from 'algosdk';
 *     const a = algosdk.generateAccount();
 *     console.log(a.addr.toString());
 *     console.log(algosdk.secretKeyToMnemonic(a.sk));
 *   "
 *   Then fund at: https://bank.testnet.algorand.network/
 */

import algosdk from "algosdk";

// ─── Config ──────────────────────────────────────────────────────────────────

const MERCHANT_SERVER = process.env.SERVER_URL ?? "http://localhost:8000";
const AGENT_MNEMONIC = process.env.AGENT_MNEMONIC ?? "";
const ALGOD_URL = process.env.ALGORAND_ALGOD_URL ?? "https://testnet-api.algonode.cloud";
const INDEXER_URL = process.env.ALGORAND_INDEXER_URL ?? "https://testnet-idx.algonode.cloud";

// ─── Agent identity ───────────────────────────────────────────────────────────

/** Simulated AI agent profile — in production this would be a hosted JSON file */
const AGENT_PROFILE = {
  id: "ai-shopping-agent-v1",
  name: "Autonomous Shopping Agent",
  version: "1.0.0",
  capabilities: ["ucp:checkout", "algorand:payment"],
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface UCPProfile {
  ucp: {
    payment_handlers: Record<
      string,
      {
        version: string;
        available_instruments: Array<{ id: number; symbol: string; decimals: number }>;
        merchant_address: string;
      }
    >;
  };
}

interface CheckoutSession {
  id: string;
  status: string;
  totals: { total: number; currency: string };
}

// ─── Step 1: Discover merchant capabilities ───────────────────────────────────

async function discoverMerchant(): Promise<{
  handlerName: string;
  merchantAddress: string;
  acceptsAlgo: boolean;
}> {
  console.log("\n🔍 [Agent] Discovering merchant capabilities...");
  console.log(`   GET ${MERCHANT_SERVER}/.well-known/ucp`);

  const res = await fetch(`${MERCHANT_SERVER}/.well-known/ucp`);
  if (!res.ok) throw new Error(`Discovery failed: ${res.status}`);

  const profile = (await res.json()) as UCPProfile;
  const handlers = profile.ucp.payment_handlers;
  const handlerName = Object.keys(handlers)[0];

  if (!handlerName) throw new Error("No payment handlers found in UCP profile");

  const handler = handlers[handlerName];
  if (!handler) throw new Error("Handler config missing");

  const acceptsAlgo = handler.available_instruments.some((i) => i.id === 0);
  const merchantAddress = handler.merchant_address;

  console.log(`   ✓ Handler: ${handlerName}`);
  console.log(`   ✓ Merchant address: ${merchantAddress}`);
  console.log(`   ✓ Accepts ALGO: ${acceptsAlgo}`);
  console.log(`   ✓ Assets: ${handler.available_instruments.map((i) => i.symbol).join(", ")}`);

  return { handlerName, merchantAddress, acceptsAlgo };
}

// ─── Step 2: Create checkout session ─────────────────────────────────────────

async function createCheckout(handlerName: string): Promise<CheckoutSession> {
  console.log("\n🛒 [Agent] Creating checkout session...");

  // The agent has decided to buy a "Premium API Access" subscription for $5
  const payload = {
    line_items: [
      {
        id: "premium-api-access",
        description: "Premium API Access — 1 month",
        quantity: 1,
        unit_price: 500, // $5.00 in cents
        currency: "USD",
      },
    ],
    totals: {
      subtotal: 500,
      tax: 0,
      shipping: 0,
      total: 500,
      currency: "USD",
    },
    payment_handler: handlerName,
    signals: {
      "dev.ucp.user_agent": `${AGENT_PROFILE.name}/${AGENT_PROFILE.version}`,
    },
  };

  const res = await fetch(`${MERCHANT_SERVER}/ucp/v1/checkout-sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // UCP-Agent header identifies the calling platform to the merchant
      "UCP-Agent": `profile="${MERCHANT_SERVER}/agent-profile"`,
      // Idempotency key — safe to retry without creating duplicate orders
      "X-Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Checkout creation failed ${res.status}: ${err}`);
  }

  const data = (await res.json()) as { session: CheckoutSession };
  const session = data.session;

  console.log(`   ✓ Session ID: ${session.id}`);
  console.log(`   ✓ Status: ${session.status}`);
  console.log(`   ✓ Total: ${session.totals.total / 100} ${session.totals.currency}`);

  return session;
}

// ─── Step 3: Pay on Algorand ──────────────────────────────────────────────────

async function payWithAlgo(
  sessionId: string,
  merchantAddress: string,
  agentAccount: algosdk.Account,
): Promise<string> {
  console.log("\n⛓  [Agent] Signing and submitting Algorand payment...");

  const algodClient = new algosdk.Algodv2("", ALGOD_URL, "");

  // Get suggested params (fee, round)
  const params = await algodClient.getTransactionParams().do();

  // Agent pays 0.5 ALGO (500_000 microALGO) — in production this would be
  // calculated from the session total using an exchange rate oracle
  const amountMicroAlgo = 500_000;

  // The session ID goes in the tx note — this is how the server links the
  // payment back to the checkout session
  const note = new TextEncoder().encode(`ucp:${sessionId}`);

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: agentAccount.addr,
    receiver: merchantAddress,
    amount: amountMicroAlgo,
    note,
    suggestedParams: params,
  });

  // Agent signs the transaction with its private key — no human needed
  const signedTxn = txn.signTxn(agentAccount.sk);
  const { txid } = await algodClient.sendRawTransaction(signedTxn).do();

  console.log(`   ✓ Transaction submitted: ${txid}`);
  console.log(`   ✓ Amount: ${amountMicroAlgo / 1_000_000} ALGO`);
  console.log(`   ✓ Note: ucp:${sessionId}`);
  console.log(`   ✓ Explorer: https://testnet.algoexplorer.io/tx/${txid}`);

  // Wait for confirmation
  console.log("\n⏳ [Agent] Waiting for on-chain confirmation (~4 seconds)...");
  await algosdk.waitForConfirmation(algodClient, txid, 5);
  console.log("   ✓ Confirmed on-chain");

  return txid;
}

// ─── Step 4: Complete the checkout ───────────────────────────────────────────

async function completeCheckout(
  sessionId: string,
  txid: string,
  handlerName: string,
): Promise<void> {
  console.log("\n✅ [Agent] Submitting txid to complete checkout...");

  const res = await fetch(`${MERCHANT_SERVER}/ucp/v1/checkout-sessions/${sessionId}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "UCP-Agent": `profile="${MERCHANT_SERVER}/agent-profile"`,
    },
    body: JSON.stringify({ payment_handler: handlerName, txid }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Checkout completion failed ${res.status}: ${err}`);
  }

  const data = (await res.json()) as { session: { status: string; completed_at?: string } };
  console.log(`   ✓ Status: ${data.session.status}`);
  if (data.session.completed_at) {
    console.log(`   ✓ Completed at: ${data.session.completed_at}`);
  }
}

// ─── Main: Agent runs autonomously ───────────────────────────────────────────

async function runAgent(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   UCP Algorand — Autonomous AI Agent Checkout Demo   ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`\nAgent: ${AGENT_PROFILE.name} v${AGENT_PROFILE.version}`);
  console.log(`Merchant server: ${MERCHANT_SERVER}`);

  if (!AGENT_MNEMONIC) {
    console.error("\n❌ AGENT_MNEMONIC env var is required.");
    console.error("   Generate one:");
    console.error(
      "   node --input-type=module -e \"import algosdk from 'algosdk'; const a = algosdk.generateAccount(); console.log(a.addr.toString()); console.log(algosdk.secretKeyToMnemonic(a.sk));\"",
    );
    console.error("   Fund at: https://bank.testnet.algorand.network/");
    process.exit(1);
  }

  // Restore agent wallet from mnemonic
  const agentAccount = algosdk.mnemonicToSecretKey(AGENT_MNEMONIC);
  console.log(`\nAgent wallet: ${agentAccount.addr.toString()}`);
  console.log(
    `Balance check: https://testnet.algoexplorer.io/address/${agentAccount.addr.toString()}`,
  );

  // Check agent has enough ALGO
  const algodClient = new algosdk.Algodv2("", ALGOD_URL, "");
  const accountInfo = await algodClient.accountInformation(agentAccount.addr).do();
  const balanceMicroAlgo = Number(accountInfo.amount);
  console.log(`Agent balance: ${balanceMicroAlgo / 1_000_000} ALGO`);

  if (balanceMicroAlgo < 600_000) {
    console.error(
      "\n❌ Insufficient balance. Need at least 0.6 ALGO (0.5 payment + fees + min balance).",
    );
    console.error("   Fund at: https://bank.testnet.algorand.network/");
    process.exit(1);
  }

  // Run the full autonomous checkout flow
  const { handlerName, merchantAddress } = await discoverMerchant();
  const session = await createCheckout(handlerName);
  const txid = await payWithAlgo(session.id, merchantAddress, agentAccount);
  await completeCheckout(session.id, txid, handlerName);

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   Purchase complete — no human interaction required  ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`\nTransaction: https://testnet.algoexplorer.io/tx/${txid}`);
  console.log("\nThis is what agentic commerce looks like.");
}

runAgent().catch((err: unknown) => {
  console.error("\n❌ Agent error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
