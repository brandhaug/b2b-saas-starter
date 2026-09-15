// PROTOTYPE: run 'start', restart Wrangler with the same scratch state, then run 'inspect'.
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
const base = 'http://127.0.0.1:8797',
  headers = {
    Authorization: 'Bearer prototype-member-alice',
    'Content-Type': 'application/json'
  }
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function request(name, action, body) {
  return (
    await fetch(
      base + '/c/' + name + '/' + action,
      body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers }
    )
  ).json()
}
if (process.argv[2] === 'start') {
  const stamp = Date.now().toString(36),
    names = ['restart-mid-' + stamp, 'restart-early-' + stamp]
  await request(names[0], 'send', {
    key: 'original',
    question: 'Interrupted during output',
    mode: 'normal',
    chunks: 200,
    delay: 100
  })
  await pause(1500)
  await request(names[1], 'send', {
    key: 'original',
    question: 'Interrupted before output',
    mode: 'normal',
    chunks: 200,
    delay: 5000
  })
  await pause(200)
  const before = await Promise.all(names.map((name) => request(name, 'snapshot')))
  await writeFile(
    'restart-pending.json',
    JSON.stringify({ names, before }, null, 2) + '\n'
  )
  console.log(
    JSON.stringify({
      names,
      phase: 'ready-to-stop-local-worker',
      states: before.map((s) => s.runs[0].status)
    })
  )
  if (process.argv[3] === '--kill-local-runtime') {
    const matches = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
      .split('\n')
      .filter(
        (line) =>
          line.includes(process.cwd() + '/node_modules/') &&
          line.includes('/bin/workerd serve ') &&
          line.includes('--inspector-addr=')
      )
    if (matches.length !== 1)
      throw new Error(
        'Expected exactly one workerd process under this scratch directory'
      )
    process.kill(Number(matches[0].trim().split(/\s+/)[0]), 'SIGKILL')
    console.log('Killed selected scratch workerd process')
  }
} else {
  const { names } = JSON.parse(await readFile('restart-pending.json', 'utf8'))
  const results = []
  for (const name of names) {
    await request(name, 'snapshot')
    await pause(1500)
    const recovered = await request(name, 'snapshot')
    const recovery = {
      state: recovered.runs[0].status,
      modelStarts: recovered.events.filter((e) => e.kind === 'model-start').length,
      recoveryEvents: recovered.events.filter((e) => e.kind === 'sdk-recovery'),
      savedPartial: recovered.messages
        .filter((m) => m.role === 'assistant')
        .flatMap((m) => m.parts.filter((p) => p.type === 'text').map((p) => p.text))
        .join('')
    }
    await request(name, 'send', {
      key: 'manual-retry',
      question: 'Retry explicitly',
      mode: 'normal',
      chunks: 3,
      delay: 20
    })
    await pause(400)
    const retried = await request(name, 'snapshot')
    results.push({
      name,
      recovery,
      afterExplicitRetry: {
        states: retried.runs.map((r) => r.status),
        modelStarts: retried.events.filter((e) => e.kind === 'model-start').length
      }
    })
  }
  await writeFile('restart-observations.json', JSON.stringify(results, null, 2) + '\n')
  console.log(JSON.stringify(results))
}
