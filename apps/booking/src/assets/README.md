# Booking visual assets

Booking defaults to code-native symbols, native password masking, and accessible text.
Do not copy assets from the legacy application into this directory.

A shipping font, SVG, raster image, or animation must be added to
`visual-asset-manifest.ts`. Product-owned files live under `shipping/`; pinned package
assets use their `node_modules/` path so the gate verifies the exact installed bytes.
Each row records source and permission, original and derived SHA-256 identities,
transformation recipe, observable parity contract, reviewer, and replacement trigger.
Provider marks additionally require a current official-kit record whose provider and
approved role match the enabled integration.

Run `bun run assets:check`. The check rejects unmanifested binaries, known legacy font
hashes, bundled font-package imports, unauthorized build output, and stale generated
notices.
