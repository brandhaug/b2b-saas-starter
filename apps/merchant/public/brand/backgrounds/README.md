# Merchant atmosphere backgrounds

BeeSolo ambient textures generated for the desktop merchant shell.

- `ambient-day-v2.webp` — quiet daylight haze with sparse honey light motes.
- `ambient-night-v2.webp` — near-black navy atmosphere with sparse stars and honey glints.

## Poke prototype assets

`poke/` contains the four sky images, four matching beach images, and 100px
noise tile from Poke's authenticated production bundle. The merchant prototype
selects them by browser-local time using Poke's 05:00, 11:00, 17:00, and 20:00
boundaries.

These files remain Poke assets and are included only because their exact use was
requested for this prototype. They must not ship in a production release unless
their licensing and redistribution rights are confirmed.

The active images are 1568 × 1003, compressed for runtime delivery, and composed
with low-contrast perimeter detail and a crop-safe center. The generated PNG
sources remain available in the Codex generated-images directory and are
intentionally excluded from the public application bundle.

The older `morning-clouds.webp` and `twilight-clouds.webp` files are retained as
unused visual studies.
