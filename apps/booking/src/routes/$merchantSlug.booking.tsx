import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { BookingFlowPrototype } from '../components/booking-flow-prototype'
import { ScenarioToolbar } from '../components/scenario-toolbar'
import type { ScenarioKey } from '../lib/prototype-data'

interface PrototypeSearch {
  readonly scenario: ScenarioKey
}

export const Route = createFileRoute('/$merchantSlug/booking')({
  validateSearch: (search: Record<string, unknown>): PrototypeSearch => ({
    scenario:
      search.scenario === 'no-services' ||
      search.scenario === 'no-times' ||
      search.scenario === 'slot-lost'
        ? search.scenario
        : 'ready'
  }),
  component: BookingPrototypeRoute
})

function BookingPrototypeRoute() {
  const { merchantSlug } = Route.useParams()
  const { scenario } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  function onScenarioChange(nextScenario: ScenarioKey) {
    void navigate({
      search: (current) => ({ ...current, scenario: nextScenario }),
      replace: true,
      resetScroll: true
    })
  }

  return (
    <>
      <BookingFlowPrototype
        key={scenario}
        merchantSlug={merchantSlug}
        scenario={scenario}
        onScenarioChange={onScenarioChange}
      />
      <ScenarioToolbar currentScenario={scenario} onScenarioChange={onScenarioChange} />
    </>
  )
}
