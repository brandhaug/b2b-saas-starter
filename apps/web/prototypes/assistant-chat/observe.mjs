// Runnable walkthrough against the real local prototype; records observations.
import WebSocket from 'ws'
import { writeFile } from 'node:fs/promises'
const origin = 'http://127.0.0.1:8797'
const headers = {
  Authorization: 'Bearer prototype-member-alice',
  'Content-Type': 'application/json'
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const observations = []
const note = (scenario, value) => {
  const result = { scenario, ...value }
  observations.push(result)
  console.log(JSON.stringify(result))
}
async function call(name, action, body, token = 'prototype-member-alice') {
  const response = await fetch(`${origin}/c/${name}/${action}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...headers, Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  const text = await response.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return { status: response.status, data }
}
async function connect(name, token = 'prototype-member-alice') {
  const frames = []
  const socket = new WebSocket(
    `${origin.replace('http', 'ws')}/c/${name}/connect?_id=${crypto.randomUUID()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  socket.on('message', (data) => {
    let frame
    try {
      frame = JSON.parse(data.toString())
    } catch {
      return
    }
    frames.push(frame)
    if (frame.type === 'cf_agent_stream_resuming')
      socket.send(JSON.stringify({ type: 'cf_agent_stream_resume_ack', id: frame.id }))
  })
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  socket.send(
    JSON.stringify({
      type: 'cf_agent_stream_resume_request',
      probeId: crypto.randomUUID()
    })
  )
  return { socket, frames }
}
async function terminal(name, timeout = 15000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const s = await call(name, 'snapshot')
    if (!s.data.runs.some((r) => ['accepted', 'streaming'].includes(r.status)))
      return s.data
    await pause(100)
  }
  return (await call(name, 'snapshot')).data
}
const textOf = (s) =>
  s.messages
    .filter((m) => m.role === 'assistant')
    .map((m) =>
      m.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('')
    )
const starts = (s) => s.events.filter((e) => e.kind === 'model-start').length
const runId = Date.now().toString(36)
const first = `probe-${runId}`
const a = await connect(first)
const send = {
  key: 'send-one',
  question: 'Explain an investigation',
  mode: 'normal',
  chunks: 35,
  delay: 120
}
const accepted = await call(first, 'send', send)
const duplicate = await call(first, 'send', send)
const conflict = await call(first, 'send', { ...send, key: 'different-send' })
a.socket.close()
await pause(850)
const b = await connect(first)
const done = await terminal(first)
await pause(100)
note('disconnect-before-first-token-and-reconnect', {
  conversation: first,
  accepted: accepted.status,
  duplicate: duplicate.data.joined,
  competingSend: conflict.status,
  modelStarts: starts(done),
  terminal: done.runs[0].status,
  persistedAnswers: textOf(done).length,
  tail: textOf(done)[0]?.slice(-50),
  replayFrames: b.frames.filter((f) => f.replay).length,
  metadata: done.messages.at(-1).metadata
})
b.socket.send(JSON.stringify({ type: 'cf_agent_chat_clear' }))
b.socket.send(
  JSON.stringify({
    type: 'cf_agent_chat_messages',
    messages: [
      { id: 'forged', role: 'assistant', parts: [{ type: 'text', text: 'forged' }] }
    ]
  })
)
await pause(150)
const denialSnapshot = await call(first, 'snapshot')
note('built-in-mutation-denial', {
  deniedFrames: b.frames.filter((f) => f.type === 'prototype_denied').length,
  historyMessages: denialSnapshot.data.messages.length
})
const second = await call(first, 'send', {
  ...send,
  key: 'followup',
  question: 'What did I ask before?',
  chunks: 4
})
const followup = await terminal(first)
note('multi-turn-context', {
  accepted: second.status,
  modelStarts: starts(followup),
  text: textOf(followup).at(-1)
})
b.socket.close()
const failureName = `failure-${runId}`
await call(failureName, 'send', {
  ...send,
  key: 'failed',
  mode: 'fail',
  chunks: 12,
  delay: 70
})
const failed = await terminal(failureName)
note('typed-failure', {
  state: failed.runs[0].status,
  starts: starts(failed),
  savedPartial: textOf(failed)[0],
  events: failed.events.map((e) => e.kind)
})
await call(failureName, 'send', {
  ...send,
  key: 'explicit-retry',
  chunks: 4,
  delay: 70
})
const retried = await terminal(failureName)
note('explicit-retry', {
  starts: starts(retried),
  states: retried.runs.map((r) => r.status),
  savedAnswers: textOf(retried).length
})
const stopName = `stop-${runId}`
await call(stopName, 'send', { ...send, key: 'stop-one', chunks: 70, delay: 80 })
await pause(420)
await call(stopName, 'stop', {})
await pause(250)
const stopped = (await call(stopName, 'snapshot')).data
note('stop', {
  state: stopped.runs[0].status,
  starts: starts(stopped),
  savedPartial: textOf(stopped)[0],
  events: stopped.events.map((e) => e.kind)
})
const privateName = `private-${runId}`
const owner = await connect(privateName)
const closed = new Promise((resolve) =>
  owner.socket.once('close', (code) => resolve(code))
)
await call(privateName, 'send', { ...send, key: 'private-one', chunks: 70, delay: 80 })
await pause(200)
const bobHistory = await call(
  privateName,
  'get-messages',
  undefined,
  'prototype-member-bob'
)
const machineHistory = await call(
  privateName,
  'get-messages',
  undefined,
  'prototype-workspace-token'
)
await call(privateName, 'authority', { revoked: true })
const revokedHistory = await call(privateName, 'get-messages')
const revokedSend = await call(privateName, 'send', {
  ...send,
  key: 'after-revocation'
})
note('private-access-and-revocation', {
  otherMember: bobHistory.status,
  workspaceToken: machineHistory.status,
  revokedHistory: revokedHistory.status,
  revokedSend: revokedSend.status,
  socketCloseCode: await closed
})
await writeFile('observations.json', JSON.stringify(observations, null, 2) + '\n')
console.log(
  'Observations saved to observations.json. These are local protocol results, not production OAuth evidence.'
)
