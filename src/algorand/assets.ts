/**
 * Algorand asset registry.
 *
 * Canonical list of accepted ASAs per network, with human-readable metadata.
 * This is the single source of truth for which assets the handler accepts.
 *
 * Adding a new asset:
 *   1. Add it to the appropriate network array below.
 *   2. The UCP profile, checkout totals, and payment verifier will automatically
 *      include it — no other code changes required.
 */

export interface AssetInfo {
  /** ASA ID. Use 0 for native ALGO. */
  id: number;
  symbol: string;
  name: string;
  /** Number of decimal places (e.g. 6 for ALGO = amounts in microALGO) */
  decimals: number;
  /** CoinGecko API ID — used for exchange rate lookups */
  coingeckoId?: string;
  /** Whether this asset is a fiat-pegged stablecoin */
  isStablecoin?: boolean;
}

// ─── Mainnet assets ───────────────────────────────────────────────────────────
// ASA IDs verified on https://algoexplorer.io/

export const MAINNET_ASSETS: AssetInfo[] = [
  {
    id: 0,
    symbol: "ALGO",
    name: "Algorand",
    decimals: 6,
    coingeckoId: "algorand",
  },
  {
    id: 31566704,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    coingeckoId: "usd-coin",
    isStablecoin: true,
  },
  {
    id: 312769,
    symbol: "USDt",
    name: "Tether USD",
    decimals: 6,
    coingeckoId: "tether",
    isStablecoin: true,
  },
  {
    id: 386192725,
    symbol: "goBTC",
    name: "GoAlgo Bitcoin",
    decimals: 8,
    coingeckoId: "bitcoin",
  },
  {
    id: 386195940,
    symbol: "goETH",
    name: "GoAlgo Ethereum",
    decimals: 8,
    coingeckoId: "ethereum",
  },
];

// ─── TestNet assets ───────────────────────────────────────────────────────────

export const TESTNET_ASSETS: AssetInfo[] = [
  {
    id: 0,
    symbol: "ALGO",
    name: "Algorand (TestNet)",
    decimals: 6,
    coingeckoId: "algorand",
  },
  {
    id: 10458941,
    symbol: "USDC",
    name: "USD Coin (TestNet)",
    decimals: 6,
    isStablecoin: true,
  },
];

// ─── BetaNet assets ───────────────────────────────────────────────────────────

export const BETANET_ASSETS: AssetInfo[] = [
  {
    id: 0,
    symbol: "ALGO",
    name: "Algorand (BetaNet)",
    decimals: 6,
  },
];

// ─── Lookup helpers ───────────────────────────────────────────────────────────

export type AlgorandNetwork = "mainnet" | "testnet" | "betanet";

export function assetsForNetwork(network: AlgorandNetwork): AssetInfo[] {
  switch (network) {
    case "mainnet":
      return MAINNET_ASSETS;
    case "testnet":
      return TESTNET_ASSETS;
    case "betanet":
      return BETANET_ASSETS;
  }
}

export function findAsset(network: AlgorandNetwork, assetId: number): AssetInfo | undefined {
  return assetsForNetwork(network).find((a) => a.id === assetId);
}

/**
 * Convert a human-readable amount to the asset's base (minor) units.
 * e.g. 1.5 ALGO → 1_500_000 microALGO
 */
export function toBaseUnits(amount: number, asset: AssetInfo): bigint {
  return BigInt(Math.round(amount * 10 ** asset.decimals));
}

/**
 * Convert base units back to a human-readable amount.
 * e.g. 1_500_000 → 1.5 (ALGO)
 */
export function fromBaseUnits(baseUnits: bigint, asset: AssetInfo): number {
  return Number(baseUnits) / 10 ** asset.decimals;
}
