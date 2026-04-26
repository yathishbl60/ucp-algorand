/**
 * Server entry point.
 *
 * Wires together config → dependencies → app → listen.
 * Handles graceful shutdown on SIGTERM / SIGINT.
 */

import { AlgorandVerifier } from "../algorand/verifier.js";
import { config } from "../config.js";
import { InMemoryCheckoutStore } from "../store/checkout.js";
import { buildApp } from "./app.js";

async function start(): Promise<void> {
  const store = new InMemoryCheckoutStore();
  const verifier = new AlgorandVerifier(config);
  const app = await buildApp(config, store, verifier);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Received shutdown signal");
    try {
      await app.close();
      app.log.info("Server closed gracefully");
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Unhandled rejection guard
  process.on("unhandledRejection", (reason) => {
    app.log.error({ reason }, "Unhandled promise rejection");
    process.exit(1);
  });

  try {
    const address = await app.listen({
      port: config.port,
      host: config.host,
    });
    app.log.info(
      {
        address,
        network: config.algorandNetwork,
        merchant: config.algorandMerchantAddress,
        env: config.nodeEnv,
      },
      "UCP Algorand server started",
    );
  } catch (err) {
    app.log.error({ err }, "Failed to start server");
    process.exit(1);
  }
}

void start();
