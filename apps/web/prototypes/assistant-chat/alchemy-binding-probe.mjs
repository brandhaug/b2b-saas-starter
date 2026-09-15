// PROTOTYPE: exercise installed Alchemy's async Worker binding lowering, no deployment.
import { Effect } from 'effect'
import { DurableObject } from '../../../../node_modules/alchemy/lib/Cloudflare/Workers/DurableObject.js'
import { bindWorkerAsyncBindings } from '../../../../node_modules/alchemy/lib/Cloudflare/Workers/WorkerAsyncBindings.js'
import { writeFile } from 'node:fs/promises'
const observed = []
const localResource = {
  Mode: 'local',
  bind:
    (strings, ...values) =>
    (data) =>
      Effect.sync(() => {
        observed.push({ key: values.join(''), ...data })
      })
}
await Effect.runPromise(
  bindWorkerAsyncBindings(localResource, {
    env: { AssistantPrototype: DurableObject('AssistantPrototype') }
  })
)
await writeFile(
  'alchemy-binding-observation.json',
  JSON.stringify(observed, null, 2) + '\n'
)
console.log(JSON.stringify(observed))
