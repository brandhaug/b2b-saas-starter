import { emitKeypressEvents } from 'node:readline'
import { initialState, reduceHarness, verdict, type HarnessAction } from './model'

const bold = '\x1b[1m'
const dim = '\x1b[2m'
const reset = '\x1b[0m'
let state = initialState()

const render = () => {
  console.clear()
  const result = verdict(state)
  console.log(`${bold}THROWAWAY: parity verification harness contract${reset}`)
  console.log(`${dim}Manifest-driven capture plan and evidence gate${reset}\n`)
  console.log(`${bold}Capture manifest${reset}`)
  console.log(JSON.stringify(state.manifest, null, 2))
  console.log(`\n${bold}Evidence${reset}`)
  console.log(JSON.stringify(state.evidence, null, 2))
  console.log(`\n${bold}Verdict: ${result.accepted ? 'ACCEPTED' : 'REJECTED'}${reset}`)
  if (!result.accepted)
    result.failures.forEach((failure) => console.log(`- ${failure}`))
  console.log(`\n${bold}Actions${reset}`)
  console.log('[s] scenario  [v] viewport  [l] locale  [m] motion  [d] diff')
  console.log('[1] screenshot  [2] state  [3] interactions  [4] metadata')
  console.log('[5] network  [6] console  [7] rerun  [r] reset evidence  [q] quit')
}

const actions: Record<string, HarnessAction> = {
  s: { type: 'cycle-scenario' },
  v: { type: 'cycle-viewport' },
  l: { type: 'cycle-locale' },
  m: { type: 'cycle-motion' },
  d: { type: 'cycle-diff' },
  '1': { type: 'toggle', field: 'screenshotHashMatches' },
  '2': { type: 'toggle', field: 'canonicalStateHashMatches' },
  '3': { type: 'toggle', field: 'interactionAssertionsPass' },
  '4': { type: 'toggle', field: 'metadataComplete' },
  '5': { type: 'toggle', field: 'undeclaredRequests' },
  '6': { type: 'toggle', field: 'consoleErrors' },
  '7': { type: 'toggle', field: 'secondRunStable' },
  r: { type: 'reset-evidence' }
}

emitKeypressEvents(process.stdin)
if (process.stdin.isTTY) process.stdin.setRawMode(true)
render()

process.stdin.on('keypress', (_input, key) => {
  if (key.name === 'q' || (key.ctrl && key.name === 'c')) process.exit(0)
  const action = actions[key.name ?? '']
  if (action) state = reduceHarness(state, action)
  render()
})
