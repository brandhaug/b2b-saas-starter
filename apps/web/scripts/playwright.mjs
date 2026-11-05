// Playwright's runner drains tests and its owned webServer on SIGINT. Run the CLI
// in this process so CI's SIGTERM can use that same cleanup path without an
// intermediary child or a second owner for the server process tree.
process.on('SIGTERM', () => {
  if (!process.emit('SIGINT')) {
    process.exit(143)
  }
})

// oxlint-disable-next-line effect/noDynamicImports -- install signal forwarding before the CLI entrypoint executes for its side effects
await import('@playwright/test/cli')
