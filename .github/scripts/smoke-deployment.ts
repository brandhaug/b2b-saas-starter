import { setTimeout as delay } from 'node:timers/promises'
import { requiredEnv } from '../../scripts/internal/env.ts'

type FetchLike = (input: string) => Promise<Response>
type Sleep = (milliseconds: number) => Promise<void>

const RETRIES = 5
const RETRY_DELAY_MS = 3000
const RESPONSE_PREVIEW_LENGTH = 4000

function responseIsSuccessful(response: Response): boolean {
  return response.status >= 200 && response.status < 400
}

export async function probe(
  name: string,
  url: string,
  fetchImpl: FetchLike = fetch,
  sleep: Sleep = delay
): Promise<void> {
  let lastFailure = 'no response'
  let lastBody = ''

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    console.log(`Probing ${name} (${url}), attempt ${attempt + 1}/${RETRIES + 1}`)
    try {
      // oxlint-disable-next-line no-await-in-loop -- retries must wait in sequence
      const response = await fetchImpl(url)
      // oxlint-disable-next-line no-await-in-loop -- the response belongs to this attempt
      lastBody = await response.text()
      if (responseIsSuccessful(response)) {
        return
      }
      lastFailure = `HTTP ${response.status}`
    } catch (error) {
      console.error(`smoke probe request failed for ${name}`, error)
      lastFailure = 'request failed'
    }

    if (attempt < RETRIES) {
      // oxlint-disable-next-line no-await-in-loop -- retries must wait in sequence
      await sleep(RETRY_DELAY_MS)
    }
  }

  throw new Error(
    `smoke probe failed for ${name} (${lastFailure})\nResponse body:\n${lastBody.slice(0, RESPONSE_PREVIEW_LENGTH)}`
  )
}

export async function main(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
  sleep: Sleep = delay
): Promise<void> {
  await probe('api', `${requiredEnv(env, 'API_URL')}/health`, fetchImpl, sleep)
  await probe('web', `${requiredEnv(env, 'WEB_URL')}/`, fetchImpl, sleep)
}

if (process.argv[1] === import.meta.filename) {
  main().catch((error: unknown) => {
    console.error('deployment smoke test failed', error)
    process.exitCode = 1
  })
}
