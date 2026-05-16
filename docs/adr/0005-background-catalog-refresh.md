# Background catalog refresh

The starter includes catalog refresh as real recurring operational work, not only a local script. Production-style refreshes should run through Cloudflare background infrastructure, while dependency catalog update automation remains available through GitHub Actions so the repository demonstrates both application background work and maintenance automation.
