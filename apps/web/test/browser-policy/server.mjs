// oxlint-disable effect/noNodeBuiltinImport -- this standalone fixture exercises native server process ownership, not application I/O
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
// The production Playwright webServer owner must terminate this process.
const server = createServer((request, response) => response.end('owned server'))
server.listen(Number(process.env.POLICY_PORT), '127.0.0.1', () => {
  writeFileSync(process.env.POLICY_PID, String(process.pid))
})
