// Long disconnect walkthrough: no client requests for 146 seconds.
import WebSocket from 'ws'
import { writeFile } from 'node:fs/promises'
const base = 'http://127.0.0.1:8797',
  name = 'long-' + Date.now().toString(36)
const headers = {
  Authorization: 'Bearer prototype-member-alice',
  'Content-Type': 'application/json'
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function connect() {
  const frames = []
  const socket = new WebSocket(
    base.replace('http', 'ws') + '/c/' + name + '/connect?_id=' + crypto.randomUUID(),
    { headers }
  )
  socket.on('message', (data) => {
    const f = JSON.parse(data.toString())
    frames.push(f)
    if (f.type === 'cf_agent_stream_resuming')
      socket.send(JSON.stringify({ type: 'cf_agent_stream_resume_ack', id: f.id }))
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
const original = await connect()
await fetch(base + '/c/' + name + '/send', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    key: 'long-one',
    question: 'Stay alive without the browser',
    mode: 'normal',
    chunks: 180,
    delay: 1000
  })
})
await pause(6500)
const beforeDisconnect = original.frames.length
original.socket.close()
console.log(
  JSON.stringify({
    phase: 'disconnected',
    name,
    framesBeforeDisconnect: beforeDisconnect,
    at: new Date().toISOString()
  })
)
const disconnectedAt = Date.now()
await pause(146000)
const returned = await connect()
const disconnectedMs = Date.now() - disconnectedAt
console.log(JSON.stringify({ phase: 'reconnected', name, disconnectedMs }))
let snapshot
for (let i = 0; i < 45; i++) {
  snapshot = await (await fetch(base + '/c/' + name + '/snapshot', { headers })).json()
  if (snapshot.runs[0].status === 'completed') break
  await pause(1000)
}
returned.socket.close()
const answer = snapshot.messages.find((m) => m.role === 'assistant')
const text = answer?.parts
  .filter((p) => p.type === 'text')
  .map((p) => p.text)
  .join('')
const result = {
  name,
  disconnectedMs,
  state: snapshot.runs[0].status,
  modelStarts: snapshot.events.filter((e) => e.kind === 'model-start').length,
  recoveryCalls: snapshot.events.filter((e) => e.kind === 'sdk-recovery').length,
  replayFrames: returned.frames.filter((f) => f.replay).length,
  textLength: text?.length,
  containsLastChunk: text?.includes('[180/180; context=1]'),
  messages: snapshot.messages.length
}
await writeFile('disconnect-observation.json', JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
