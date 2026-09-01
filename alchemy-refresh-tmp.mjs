// Refreshes the local alchemy Cloudflare OAuth credential if expired and
// emits the access token + account id as shell exports (never printed).
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as OAuthClient from './node_modules/alchemy/lib/Cloudflare/Auth/OAuthClient.js'
import { Effect } from 'effect'

const file = join(homedir(), '.alchemy/credentials/default/cloudflare.json')
const creds = JSON.parse(readFileSync(file, 'utf8'))
const fresh =
  creds.expires > Date.now() + 10_000
    ? creds
    : await Effect.runPromise(OAuthClient.refresh(creds))
if (fresh !== creds) {
  writeFileSync(file, JSON.stringify(fresh, null, 2))
}
process.stdout.write(`CLOUDFLARE_API_TOKEN=${fresh.access}\n`)
