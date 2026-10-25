import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Schema } from 'effect'

import { HealthResponse } from '../../packages/api/src/health.ts'
import {
  DEPLOYMENT_COMMIT_HEADER,
  DEPLOYMENT_VERSION_HEADER,
  deploymentIdentity,
  type DeploymentIdentity
} from '../../packages/env/src/deployment.ts'
import { requiredEnv } from '../../scripts/lib/env.ts'

type Outcome = 'passed' | 'failed' | 'unknown'
type Observation = {
  name: string
  url: string
  observedAt: string
  outcome: Outcome
  reason: string
  status: number | null
  observed: DeploymentIdentity
}
type Attempt = { observedAt: string; observations: Array<Observation> }
type Evidence = {
  startedAt: string
  completedAt: string
  expected: DeploymentIdentity
  outcome: Outcome
  reason: string
  attempts: Array<Attempt>
}
type Options = {
  evidencePath?: string
  deadlineMs?: number
  requestTimeoutMs?: number
  retryDelayMs?: number
}

function outcomeOf(observations: Array<{ outcome: Outcome }>): Outcome {
  if (observations.some((item) => item.outcome === 'failed')) {
    return 'failed'
  }
  return observations.length > 0 &&
    observations.every((item) => item.outcome === 'passed')
    ? 'passed'
    : 'unknown'
}

function deploymentUrl(value: string): string {
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('deployment URL must be an HTTP origin without credentials')
  }
  return url.origin
}

// Fetch and body consumption share the same timeout. No raw response bodies or
// exception messages are retained: an upstream login/error page can contain secrets.
async function observe(
  name: string,
  url: string,
  timeout: number,
  expected: DeploymentIdentity | null,
  validate: (body: string, contentType: string) => boolean,
  canonicalRedirect?: string
): Promise<{ observation: Observation; body: string }> {
  const observation: Observation = {
    name,
    url,
    observedAt: new Date().toISOString(),
    outcome: 'unknown',
    reason: 'request unavailable',
    status: null,
    observed: { commit: null, version: null }
  }
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeout))),
      cache: 'no-store',
      headers: { 'cache-control': 'no-cache' }
    })
    observation.status = response.status
    observation.observed = deploymentIdentity(
      response.headers.get(DEPLOYMENT_COMMIT_HEADER),
      response.headers.get(DEPLOYMENT_VERSION_HEADER)
    )
    const isCanonicalRedirect =
      canonicalRedirect !== undefined &&
      response.status === 307 &&
      response.headers.get('location') === canonicalRedirect
    if (response.status !== 200 && !isCanonicalRedirect) {
      await response.body?.cancel()
      return {
        observation: {
          ...observation,
          outcome: 'failed',
          reason: `HTTP ${response.status}`
        },
        body: ''
      }
    }
    const body = await response.text()
    if (
      !isCanonicalRedirect &&
      !validate(body, response.headers.get('content-type') ?? '')
    ) {
      return {
        observation: {
          ...observation,
          outcome: 'failed',
          reason: 'response contract mismatch'
        },
        body: ''
      }
    }
    if (
      expected !== null &&
      (observation.observed.commit === null || observation.observed.version === null)
    ) {
      return {
        observation: { ...observation, reason: 'deployment identity unavailable' },
        body: ''
      }
    }
    if (
      expected !== null &&
      (observation.observed.commit !== expected.commit ||
        observation.observed.version !== expected.version)
    ) {
      return {
        observation: {
          ...observation,
          outcome: 'failed',
          reason: 'deployment identity mismatch'
        },
        body: ''
      }
    }
    return {
      observation: { ...observation, outcome: 'passed', reason: 'verified' },
      body
    }
  } catch {
    return { observation, body: '' }
  }
}

const decodeHealth = Schema.decodeUnknownSync(HealthResponse)

function validHealth(body: string, contentType: string): boolean {
  if (!contentType.startsWith('application/json')) {
    return false
  }
  try {
    decodeHealth(JSON.parse(body))
    return true
  } catch {
    return false
  }
}

function stylesheetUrl(html: string, origin: string): string | null {
  // Only a stylesheet actually referenced by this document counts. Never send
  // probes to arbitrary origins discovered in an unexpected response.
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel="stylesheet"/i.test(match[0])) {
      continue
    }
    const href = /\bhref="([^"]+)"/i.exec(match[0])?.[1]
    if (href === undefined) {
      continue
    }
    const url = URL.parse(href, origin)
    if (
      url?.origin === origin &&
      url.pathname.startsWith('/assets/') &&
      url.pathname.endsWith('.css') &&
      !url.search &&
      !url.hash
    ) {
      return url.href
    }
  }
  return null
}

function validHome(body: string, contentType: string): boolean {
  return (
    contentType.startsWith('text/html') &&
    /<meta\b[^>]*name="deployment-page"[^>]*content="public-home"[^>]*>/.test(body)
  )
}

export async function main(
  env: NodeJS.ProcessEnv = process.env,
  options: Options = {}
): Promise<void> {
  const evidence: Evidence = {
    startedAt: new Date().toISOString(),
    completedAt: '',
    expected: deploymentIdentity(env.GIT_COMMIT_SHA, env.SERVICE_VERSION),
    outcome: 'unknown',
    reason: 'configuration unavailable',
    attempts: []
  }
  const evidencePath = options.evidencePath ?? 'artifacts/deployment-smoke.json'
  const deadlineMs = options.deadlineMs ?? 90_000
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000
  const retryDelayMs = options.retryDelayMs ?? 3000
  const deadline = performance.now() + deadlineMs
  try {
    const api = deploymentUrl(requiredEnv('API_URL', env))
    const web = deploymentUrl(requiredEnv('WEB_URL', env))
    if (evidence.expected.commit === null || evidence.expected.version === null) {
      throw new Error('identity unavailable')
    }
    while (performance.now() < deadline) {
      function timeout() {
        return Math.min(requestTimeoutMs, deadline - performance.now())
      }
      // oxlint-disable-next-line no-await-in-loop, effect/noNewPromise -- the Node CI boundary probes independent origins concurrently within each retry round
      const [apiResult, rootResult] = await Promise.all([
        observe('api', `${api}/health`, timeout(), evidence.expected, validHealth),
        observe('web', `${web}/`, timeout(), evidence.expected, validHome, '/en')
      ])
      const observations = [apiResult.observation, rootResult.observation]
      let webResult = rootResult
      if (
        rootResult.observation.status === 307 &&
        rootResult.observation.outcome === 'passed' &&
        performance.now() < deadline
      ) {
        // oxlint-disable-next-line no-await-in-loop -- only the explicitly verified canonical locale redirect is followed
        webResult = await observe(
          'web-home',
          `${web}/en`,
          timeout(),
          evidence.expected,
          validHome
        )
        observations.push(webResult.observation)
      }
      const asset = stylesheetUrl(webResult.body, web)
      if (asset !== null && performance.now() < deadline) {
        // oxlint-disable-next-line no-await-in-loop -- the asset must come from this round's verified HTML
        const result = await observe(
          'web-asset',
          asset,
          timeout(),
          null,
          (body, type) =>
            type.startsWith('text/css') && body.trim().length > 0 && !/^\s*</.test(body)
        )
        observations.push(result.observation)
      } else {
        observations.push({
          name: 'web-asset',
          url: web,
          observedAt: new Date().toISOString(),
          observed: { commit: null, version: null },
          status: null,
          outcome: webResult.observation.outcome === 'passed' ? 'failed' : 'unknown',
          reason: 'required stylesheet unavailable'
        })
      }
      evidence.attempts.push({ observedAt: new Date().toISOString(), observations })
      evidence.outcome = outcomeOf(observations)
      evidence.reason =
        evidence.outcome === 'passed'
          ? 'complete deployment verified'
          : 'propagation deadline exhausted'
      if (evidence.outcome === 'passed') {
        break
      }
      const remaining = deadline - performance.now()
      if (remaining > 0) {
        // oxlint-disable-next-line no-await-in-loop -- bounded propagation retry
        await delay(Math.min(retryDelayMs, remaining))
      }
    }
  } catch {
    evidence.outcome = 'unknown'
  } finally {
    if (evidence.outcome !== 'passed') {
      evidence.outcome = evidence.attempts.some((attempt) =>
        attempt.observations.some((item) => item.outcome === 'failed')
      )
        ? 'failed'
        : 'unknown'
    }
    evidence.completedAt = new Date().toISOString()
    await mkdir(dirname(evidencePath), { recursive: true })
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  }
  if (evidence.outcome !== 'passed') {
    throw new Error(
      `deployment smoke ${evidence.outcome}: ${evidence.reason}; see ${evidencePath}`
    )
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error('deployment smoke test failed', error)
    process.exitCode = 1
  })
}
