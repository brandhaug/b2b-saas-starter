import * as stylex from '@stylexjs/stylex'
import { scenarios, type ScenarioKey } from '../lib/prototype-data'
import { styles } from './booking-flow.styles'

export function ScenarioToolbar({
  currentScenario,
  onScenarioChange
}: {
  readonly currentScenario: ScenarioKey
  readonly onScenarioChange: (scenario: ScenarioKey) => void
}) {
  if (!import.meta.env.DEV) return null

  return (
    <label {...stylex.props(styles.toolbar)}>
      <span {...stylex.props(styles.toolbarLabel)}>Scenario</span>
      <select
        value={currentScenario}
        onChange={(event) => onScenarioChange(event.target.value as ScenarioKey)}
        aria-label="Prototype scenario"
        {...stylex.props(styles.select)}
      >
        {scenarios.map((scenario) => (
          <option key={scenario.key} value={scenario.key}>
            {scenario.name}
          </option>
        ))}
      </select>
    </label>
  )
}
