# Contributing to UCP Algorand

Thanks for helping improve the UCP Algorand payment handler.

## Development Setup

1. Install Node.js 22+
2. Install dependencies:

```bash
npm ci
```

3. Create local environment file:

```bash
cp .env.example .env
```

4. Run development server:

```bash
npm run dev
```

## Validation Commands

Run these before opening a PR:

```bash
npm run typecheck
npm test
npm run build
```

## Pull Request Guidelines

- Keep PRs focused on a single concern.
- Add or update tests for behavior changes.
- Update README and `.env.example` when config changes.
- Prefer backward-compatible API changes.
- Include migration notes when changing profile schema or route behavior.

## Adding New Accepted ASAs

Accepted assets are defined in `src/algorand/assets.ts`.

When adding an ASA:

1. Add it to the correct network list with `id`, `symbol`, `name`, and `decimals`.
2. Verify the asset ID from Algorand explorer/indexer.
3. Add or update tests that assert instrument availability and amount conversion.
4. Document any merchant-facing impact in README.

## Deploying New Escrow Contract Versions

If escrow app behavior changes:

1. Deploy the new app and obtain the new app ID.
2. Set `ALGORAND_ESCROW_APP_ID` for each environment.
3. Roll out behind staged traffic when possible.
4. Validate payment verification and completion flow on testnet first.
5. Communicate version changes to integrators if request/response behavior changes.

## Security Expectations

- Never log secrets or private keys.
- Keep webhook signing enabled (`WEBHOOK_SECRET`) whenever webhook delivery is used.
- Treat all inbound payment credentials as untrusted until on-chain verification succeeds.
