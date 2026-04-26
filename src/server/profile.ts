/**
 * UCP business profile builder.
 * The profile is served at GET /.well-known/ucp and cached after first build.
 */

import { assetsForNetwork } from "../algorand/assets.js";
import type { Config } from "../config.js";
import { ALGORAND_HANDLER_NAME, ALGORAND_HANDLER_VERSION, UCP_VERSION } from "../types/ucp.js";

function availableInstruments(assets: ReturnType<typeof assetsForNetwork>) {
  const instruments: object[] = [{ type: "algo" }];
  const asaIds = assets.filter((a) => a.id !== 0).map((a) => a.id);
  if (asaIds.length > 0) {
    instruments.push({ type: "asa", constraints: { asset_ids: asaIds } });
  }
  return instruments;
}

export function buildBusinessProfile(config: Config): object {
  const assets = assetsForNetwork(config.algorandNetwork);

  return {
    ucp: {
      version: UCP_VERSION,
      services: {
        "dev.ucp.shopping": [
          {
            version: UCP_VERSION,
            spec: `https://ucp.dev/${UCP_VERSION}/specification/overview`,
            transport: "rest",
            endpoint: `${config.ucpBaseUrl}/ucp/v1`,
            schema: `https://ucp.dev/${UCP_VERSION}/services/shopping/rest.openapi.json`,
          },
        ],
      },
      capabilities: {
        "dev.ucp.shopping.checkout": [
          {
            version: UCP_VERSION,
            spec: `https://ucp.dev/${UCP_VERSION}/specification/checkout`,
            schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/checkout.json`,
          },
        ],
        "dev.ucp.shopping.order": [
          {
            version: UCP_VERSION,
            spec: `https://ucp.dev/${UCP_VERSION}/specification/order`,
            schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/order.json`,
            config: {
              webhook_url: `${config.ucpBaseUrl}/ucp/webhooks/orders`,
            },
          },
        ],
      },
      payment_handlers: {
        [ALGORAND_HANDLER_NAME]: [
          {
            id: `algorand_${config.algorandNetwork}`,
            version: ALGORAND_HANDLER_VERSION,
            spec: "https://raw.githubusercontent.com/algorand/ucp-algorand/main/schemas/algorand_payment_handler.json",
            schema:
              "https://raw.githubusercontent.com/algorand/ucp-algorand/main/schemas/algorand_payment_handler.json",
            available_instruments: availableInstruments(assets),
            config: {
              network: config.algorandNetwork,
              receiver_address: config.algorandMerchantAddress,
              accepted_assets: assets,
              memo_field: "ucp_checkout_id",
              min_confirmations: config.algorandMinConfirmations,
              indexer_url: config.algorandIndexerUrl,
              ...(config.algorandEscrowAppId ? { escrow_app_id: config.algorandEscrowAppId } : {}),
            },
          },
        ],
      },
    },
    signing_keys: [],
    ...(config.storeName ||
    config.storeDescription ||
    config.storeSupportEmail ||
    config.storeLogoUrl
      ? {
          merchant: {
            ...(config.storeName ? { name: config.storeName } : {}),
            ...(config.storeDescription ? { description: config.storeDescription } : {}),
            ...(config.storeSupportEmail ? { support_email: config.storeSupportEmail } : {}),
            ...(config.storeLogoUrl ? { logo_url: config.storeLogoUrl } : {}),
          },
        }
      : {}),
  };
}
