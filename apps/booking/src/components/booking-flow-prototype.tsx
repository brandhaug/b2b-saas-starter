import * as stylex from '@stylexjs/stylex'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  CreditCard,
  MapPin,
  Menu,
  Scissors,
  ShieldCheck,
  UserRound,
  UsersRound,
  X
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  additionalServices,
  formatPrice,
  getBookingDuration,
  getBookingTotal,
  getPrototypePath,
  initialBookingState,
  providers,
  services,
  slots,
  stages,
  type BookingPrototypeState,
  type BookingStage,
  type CheckoutChoice,
  type ScenarioKey
} from '../lib/prototype-data'
import { styles } from './booking-flow.styles'

interface BookingFlowPrototypeProps {
  readonly merchantSlug: string
  readonly scenario: ScenarioKey
  readonly onScenarioChange: (scenario: ScenarioKey) => void
}

interface StepProps {
  readonly state: BookingPrototypeState
  readonly scenario: ScenarioKey
  readonly onServiceSelect: (serviceId: string) => void
  readonly onServiceClear: () => void
  readonly onAdditionalServiceToggle: (serviceId: string) => void
  readonly onSlotSelect: (slotId: string) => void
  readonly onCustomerChange: (
    field: keyof BookingPrototypeState['customer'],
    value: string
  ) => void
  readonly onCheckoutSelect: (choice: CheckoutChoice) => void
  readonly onScenarioChange: (scenario: ScenarioKey) => void
  readonly onReset: () => void
}

const stageTitles: Record<BookingStage, string> = {
  provider: 'Choose a professional',
  service: 'What can we do for you?',
  schedule: 'Choose your appointment',
  details: 'Checkout',
  checkout: 'Checkout',
  confirmation: 'Appointment confirmed'
}

export function BookingFlowPrototype({
  merchantSlug,
  scenario,
  onScenarioChange
}: BookingFlowPrototypeProps) {
  const initial = getScenarioInitialState(scenario)
  const [stage, setStage] = useState<BookingStage>(initial.stage)
  const [state, setState] = useState<BookingPrototypeState>(initial.state)
  const [orderOpen, setOrderOpen] = useState(false)
  const stageIndex = stages.indexOf(stage)
  const canContinue = canContinueFrom(stage, state, scenario)

  function goNext() {
    if (!canContinue) return
    if (stage === 'checkout') {
      setState((current) => ({ ...current, confirmed: true }))
    }
    const next = stages[stageIndex + 1]
    if (next) setStage(next)
  }

  function goBack() {
    const previous = stages[stageIndex - 1]
    if (previous) setStage(previous)
  }

  function selectProvider(providerId: string) {
    setState((current) => ({
      ...current,
      providerPreference: providerId,
      primaryServiceId: null,
      additionalServiceIds: [],
      slotId: null,
      confirmed: false
    }))
    setStage('service')
  }

  function selectService(serviceId: string) {
    setState((current) => ({
      ...current,
      primaryServiceId: serviceId,
      additionalServiceIds: [],
      slotId: null,
      confirmed: false
    }))
  }

  function clearService() {
    setState((current) => ({
      ...current,
      primaryServiceId: null,
      additionalServiceIds: [],
      slotId: null,
      confirmed: false
    }))
  }

  function toggleAdditionalService(serviceId: string) {
    setState((current) => ({
      ...current,
      additionalServiceIds: current.additionalServiceIds.includes(serviceId)
        ? current.additionalServiceIds.filter((id) => id !== serviceId)
        : [...current.additionalServiceIds, serviceId],
      slotId: null,
      confirmed: false
    }))
  }

  function selectSlot(slotId: string) {
    setState((current) => ({ ...current, slotId, confirmed: false }))
  }

  function changeCustomer(
    field: keyof BookingPrototypeState['customer'],
    value: string
  ) {
    setState((current) => ({
      ...current,
      customer: { ...current.customer, [field]: value },
      confirmed: false
    }))
  }

  function selectCheckout(choice: CheckoutChoice) {
    setState((current) => ({
      ...current,
      checkoutChoice: choice,
      confirmed: false
    }))
  }

  function reset() {
    setState(initialBookingState)
    setStage('provider')
    onScenarioChange('ready')
  }

  const showOrderBar =
    state.primaryServiceId !== null && (stage === 'service' || stage === 'schedule')
  const showInlineActions = stage === 'details' || stage === 'checkout'
  const firstName = state.customer.name.trim().split(' ')[0] || 'Demo'
  const title =
    stage === 'confirmation'
      ? `${firstName}, your appointment is confirmed!`
      : stageTitles[stage]

  const stepProps: StepProps = {
    state,
    scenario,
    onServiceSelect: selectService,
    onServiceClear: clearService,
    onAdditionalServiceToggle: toggleAdditionalService,
    onSlotSelect: selectSlot,
    onCustomerChange: changeCustomer,
    onCheckoutSelect: selectCheckout,
    onScenarioChange,
    onReset: reset
  }

  return (
    <div {...stylex.props(styles.app)}>
      <div {...stylex.props(styles.widget)}>
        <header {...stylex.props(styles.header)}>
          <button
            type="button"
            onClick={goBack}
            disabled={stageIndex === 0 || stage === 'confirmation'}
            aria-label="Back"
            {...stylex.props(
              styles.iconButton,
              styles.backButton,
              (stageIndex === 0 || stage === 'confirmation') && styles.hidden
            )}
          >
            <ArrowLeft {...stylex.props(styles.icon16)} />
          </button>
          <h1 {...stylex.props(styles.title)}>{title}</h1>
          {stage !== 'confirmation' ? (
            <button
              type="button"
              aria-label="Booking menu"
              {...stylex.props(styles.iconButton)}
            >
              <Menu {...stylex.props(styles.icon16)} />
            </button>
          ) : null}
        </header>

        <main
          {...stylex.props(styles.main, showInlineActions && styles.checkoutSurface)}
        >
          {stage === 'provider' ? (
            <ProviderStep onSelect={selectProvider} />
          ) : (
            <BookingStep stage={stage} {...stepProps} />
          )}

          {showInlineActions ? (
            <div {...stylex.props(styles.inlineActions)}>
              <button
                type="button"
                onClick={goBack}
                {...stylex.props(styles.textButton)}
              >
                Back
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={!canContinue}
                {...stylex.props(styles.primaryButton)}
              >
                {stage === 'checkout' ? 'Confirm booking' : 'Continue'}
                <ArrowRight {...stylex.props(styles.icon16)} />
              </button>
            </div>
          ) : null}
        </main>
      </div>

      {showOrderBar ? (
        <button
          type="button"
          onClick={() => setOrderOpen(true)}
          {...stylex.props(styles.orderBar)}
        >
          <span>
            {stage === 'schedule' && state.slotId ? 'Go to checkout' : 'View order'}
          </span>
          <span {...stylex.props(styles.mono)}>
            {formatPrice(getBookingTotal(state))}
          </span>
        </button>
      ) : null}

      {orderOpen ? (
        <OrderDrawer
          state={state}
          stage={stage}
          canContinue={canContinue}
          onClose={() => setOrderOpen(false)}
          onContinue={() => {
            setOrderOpen(false)
            goNext()
          }}
        />
      ) : null}

      {import.meta.env.DEV ? (
        <div {...stylex.props(styles.devState)}>
          {getPrototypePath(merchantSlug, stage, state)} · {scenario}
        </div>
      ) : null}
    </div>
  )
}

function BookingStep({
  stage,
  ...props
}: StepProps & { readonly stage: BookingStage }) {
  if (stage === 'service') return <ServiceStep {...props} />
  if (stage === 'schedule') return <ScheduleStep {...props} />
  if (stage === 'details') return <DetailsStep {...props} />
  if (stage === 'checkout') return <CheckoutStep {...props} />
  return <ConfirmationStep {...props} />
}

function ProviderStep({
  onSelect
}: {
  readonly onSelect: (providerId: string) => void
}) {
  return (
    <div {...stylex.props(styles.gridTwo)}>
      {providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          onClick={() => onSelect(provider.id)}
          {...stylex.props(styles.providerCard)}
        >
          <span {...stylex.props(styles.avatar)}>
            {provider.id === 'any' ? (
              <UsersRound {...stylex.props(styles.icon24)} />
            ) : (
              provider.initials
            )}
          </span>
          <span {...stylex.props(styles.providerName)}>{provider.name}</span>
          <span {...stylex.props(styles.mutedSmall)}>
            {provider.id === 'any' ? provider.role : provider.next}
          </span>
        </button>
      ))}
    </div>
  )
}

function ServiceStep({
  state,
  scenario,
  onServiceSelect,
  onServiceClear,
  onAdditionalServiceToggle,
  onScenarioChange
}: StepProps) {
  if (scenario === 'no-services') {
    return (
      <EmptyState
        icon={<Scissors {...stylex.props(styles.icon20)} />}
        title="No services are bookable"
        description="This professional has no active bookable services. No booking session should advance from this state."
        action="Restore ready fixture"
        onAction={() => onScenarioChange('ready')}
      />
    )
  }

  const selectedService = services.find(
    (service) => service.id === state.primaryServiceId
  )
  const selectedAdditionalIds = new Set(state.additionalServiceIds)

  if (selectedService) {
    return (
      <div>
        <button
          type="button"
          onClick={onServiceClear}
          aria-label={`Remove ${selectedService.name}`}
          {...stylex.props(styles.serviceCard, styles.selectedService)}
        >
          <span {...stylex.props(styles.serviceName)}>{selectedService.name}</span>
          <span
            {...stylex.props(styles.serviceDuration, styles.selectedServiceDuration)}
          >
            {selectedService.durationMinutes} min
          </span>
          <span {...stylex.props(styles.pricePill, styles.selectedPricePill)}>
            {formatPrice(selectedService.amountMinor)}
          </span>
          <span {...stylex.props(styles.selectionMark)}>
            <Check {...stylex.props(styles.icon16)} />
          </span>
        </button>

        <h2 {...stylex.props(styles.sectionTitle)}>Anything you wish to add?</h2>
        <div {...stylex.props(styles.serviceGrid)}>
          {additionalServices.map((service) => {
            const selected = selectedAdditionalIds.has(service.id)
            return (
              <button
                key={service.id}
                type="button"
                onClick={() => onAdditionalServiceToggle(service.id)}
                {...stylex.props(styles.serviceCard, selected && styles.selectedAddon)}
              >
                <span {...stylex.props(styles.serviceName)}>{service.name}</span>
                <span {...stylex.props(styles.serviceDuration)}>
                  {service.durationMinutes} min
                </span>
                <span {...stylex.props(styles.pricePill)}>
                  {formatPrice(service.amountMinor)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div>
      <button type="button" {...stylex.props(styles.categoryButton)}>
        <span>All categories</span>
        <span aria-hidden="true">⌄</span>
      </button>
      <div {...stylex.props(styles.serviceGrid)}>
        {services.map((service) => (
          <button
            key={service.id}
            type="button"
            onClick={() => onServiceSelect(service.id)}
            {...stylex.props(styles.serviceCard)}
          >
            <span {...stylex.props(styles.serviceName)}>{service.name}</span>
            <span {...stylex.props(styles.serviceDuration)}>
              {service.durationMinutes} min
            </span>
            <span {...stylex.props(styles.pricePill)}>
              {formatPrice(service.amountMinor)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ScheduleStep({ state, scenario, onSlotSelect, onScenarioChange }: StepProps) {
  if (scenario === 'no-times') {
    return (
      <EmptyState
        icon={<CalendarDays {...stylex.props(styles.icon20)} />}
        title="No times in the next 14 days"
        description="Keep the professional and service selection intact while the customer chooses what to change."
        action="Show available times"
        onAction={() => onScenarioChange('ready')}
      />
    )
  }

  return (
    <div>
      {scenario === 'slot-lost' && state.slotId === null ? (
        <div {...stylex.props(styles.alert)}>
          <p {...stylex.props(styles.alertTitle)}>That time was just booked</p>
          <p {...stylex.props(styles.alertCopy)}>
            Your service choices are still saved.
          </p>
        </div>
      ) : null}
      <p {...stylex.props(styles.month)}>July 2026</p>
      <div {...stylex.props(styles.dateGrid)}>
        {[
          ['9', 'Thu'],
          ['10', 'Fri'],
          ['11', 'Sat'],
          ['12', 'Sun'],
          ['13', 'Mon'],
          ['14', 'Tue']
        ].map(([date, day]) => (
          <div key={date} {...stylex.props(styles.dateCell)}>
            <span
              {...stylex.props(styles.dateCircle, date === '10' && styles.activeDate)}
            >
              {date}
            </span>
            <span {...stylex.props(styles.dayLabel)}>{day}</span>
          </div>
        ))}
      </div>
      <p {...stylex.props(styles.dayHeading)}>Friday, July 10</p>
      <div {...stylex.props(styles.timeGrid)}>
        {slots.map((slot) => (
          <button
            key={slot.id}
            type="button"
            onClick={() => onSlotSelect(slot.id)}
            {...stylex.props(
              styles.timeButton,
              state.slotId === slot.id && styles.selectedTime
            )}
          >
            {slot.time}
          </button>
        ))}
      </div>
    </div>
  )
}

function DetailsStep({ state, onCustomerChange }: StepProps) {
  return (
    <div {...stylex.props(styles.fieldGrid)}>
      <TextField
        label="Full name"
        value={state.customer.name}
        onChange={(value) => onCustomerChange('name', value)}
        autoComplete="name"
      />
      <TextField
        label="Email"
        value={state.customer.email}
        onChange={(value) => onCustomerChange('email', value)}
        autoComplete="email"
        type="email"
      />
      <TextField
        label="Phone (optional)"
        value={state.customer.phone}
        onChange={(value) => onCustomerChange('phone', value)}
        autoComplete="tel"
        type="tel"
      />
      <p {...stylex.props(styles.privacy)}>
        <ShieldCheck {...stylex.props(styles.icon16)} />
        No customer account is created. These details become part of the confirmed
        appointment.
      </p>
    </div>
  )
}

function CheckoutStep({ state, onCheckoutSelect }: StepProps) {
  const choices: ReadonlyArray<{
    readonly id: CheckoutChoice
    readonly title: string
    readonly description: string
    readonly icon: ReactNode
  }> = [
    {
      id: 'pay-in-person',
      title: 'Pay in person',
      description: 'Nothing due today. Pay after your appointment.',
      icon: <UserRound {...stylex.props(styles.icon20)} />
    },
    {
      id: 'pay-now',
      title: `Pay ${formatPrice(getBookingTotal(state))} now`,
      description:
        'Payment collection is intentionally stubbed in this migration spike.',
      icon: <CreditCard {...stylex.props(styles.icon20)} />
    }
  ]

  return (
    <div {...stylex.props(styles.checkoutChoices)}>
      {choices.map((choice) => {
        const selected = state.checkoutChoice === choice.id
        return (
          <button
            key={choice.id}
            type="button"
            onClick={() => onCheckoutSelect(choice.id)}
            {...stylex.props(styles.checkoutChoice, selected && styles.selectedChoice)}
          >
            <span
              {...stylex.props(
                styles.choiceIcon,
                selected && styles.selectedChoiceIcon
              )}
            >
              {choice.icon}
            </span>
            <span {...stylex.props(styles.choiceCopy)}>
              <span {...stylex.props(styles.choiceTitleRow)}>
                <span>{choice.title}</span>
                {selected ? <CheckCircle2 {...stylex.props(styles.icon16)} /> : null}
              </span>
              <span {...stylex.props(styles.choiceDescription)}>
                {choice.description}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function ConfirmationStep({ state, onReset }: StepProps) {
  const chosenProvider = providers.find((item) => item.id === state.providerPreference)
  const provider = chosenProvider?.id === 'any' ? providers[1] : chosenProvider
  const service = services.find((item) => item.id === state.primaryServiceId)
  const slot = slots.find((item) => item.id === state.slotId)

  return (
    <div {...stylex.props(styles.confirmation)}>
      <div {...stylex.props(styles.receipt)}>
        <div {...stylex.props(styles.receiptHeader)}>
          <span {...stylex.props(styles.receiptAvatar)}>
            {provider?.initials ?? 'AS'}
          </span>
          <span {...stylex.props(styles.receiptIdentity)}>
            <span {...stylex.props(styles.receiptName)}>
              {provider?.name ?? 'Ava S.'}
            </span>
            <span {...stylex.props(styles.receiptMeta)}>{service?.name}</span>
          </span>
          <span {...stylex.props(styles.receiptPrice, styles.mono)}>
            <span {...stylex.props(styles.receiptName)}>
              {formatPrice(getBookingTotal(state))}
            </span>
            <span {...stylex.props(styles.receiptMeta)}>
              {formatPrice(service?.amountMinor ?? 0)}
            </span>
          </span>
        </div>

        <div {...stylex.props(styles.receiptRows)}>
          <ReceiptRow label="Confirmation code" value="DEMO123" mono />
          <ReceiptRow label="Duration" value={`${getBookingDuration(state)} min`} />
          <ReceiptRow label="Time" value={`${slot?.date} at ${slot?.time}`} primary />
        </div>

        <p {...stylex.props(styles.calendarLabel)}>Add to calendar</p>
        <div {...stylex.props(styles.calendarGrid)}>
          {['Apple', 'Google', 'Yahoo'].map((calendar) => (
            <button
              key={calendar}
              type="button"
              aria-label={`Add to ${calendar} calendar`}
              {...stylex.props(styles.calendarButton)}
            >
              {calendar.slice(0, 1)}
            </button>
          ))}
        </div>

        <div {...stylex.props(styles.totalRow)}>
          <span>Total price</span>
          <span {...stylex.props(styles.mono)}>
            {formatPrice(getBookingTotal(state))}
          </span>
        </div>
        <p {...stylex.props(styles.taxCopy)}>Incl. taxes and fees</p>
      </div>

      <div {...stylex.props(styles.merchantBlock)}>
        <span {...stylex.props(styles.mapIcon)}>
          <MapPin {...stylex.props(styles.icon20)} />
        </span>
        <span>
          <span {...stylex.props(styles.receiptName)}>SQUIRE Demo Barbershop</span>
          <span {...stylex.props(styles.address)}>
            21 Mercer Street, New York, NY 10013
          </span>
          <span {...stylex.props(styles.directions)}>Get directions</span>
        </span>
      </div>

      <div {...stylex.props(styles.paymentRow)}>
        <span {...stylex.props(styles.mono)}>
          {state.checkoutChoice === 'pay-now' ? 'VISA ···· 4242' : 'Pay in person'}
        </span>
        <span {...stylex.props(styles.badge)}>
          {state.checkoutChoice === 'pay-now' ? 'Paid' : 'Pending payment'}
        </span>
      </div>

      <p {...stylex.props(styles.explanation)}>
        Confirmation is derived from the committed Appointment. Email delivery is
        asynchronous and never blocks this view.
      </p>
      <button type="button" onClick={onReset} {...stylex.props(styles.secondaryButton)}>
        Restart prototype
      </button>
    </div>
  )
}

function ReceiptRow({
  label,
  value,
  mono = false,
  primary = false
}: {
  readonly label: string
  readonly value: string
  readonly mono?: boolean
  readonly primary?: boolean
}) {
  return (
    <div {...stylex.props(styles.receiptRow)}>
      <span {...stylex.props(styles.receiptLabel)}>{label}</span>
      <span {...stylex.props(mono && styles.mono, primary && styles.primaryText)}>
        {value}
      </span>
    </div>
  )
}

function OrderDrawer({
  state,
  stage,
  canContinue,
  onClose,
  onContinue
}: {
  readonly state: BookingPrototypeState
  readonly stage: BookingStage
  readonly canContinue: boolean
  readonly onClose: () => void
  readonly onContinue: () => void
}) {
  const provider = providers.find((item) => item.id === state.providerPreference)
  const service = services.find((item) => item.id === state.primaryServiceId)
  const selectedIds = new Set(state.additionalServiceIds)
  const additions = additionalServices.filter((item) => selectedIds.has(item.id))
  const slot = slots.find((item) => item.id === state.slotId)

  return (
    <div {...stylex.props(styles.drawer)}>
      <div {...stylex.props(styles.drawerHeader)}>
        <div>
          <h2 {...stylex.props(styles.drawerTitle)}>Your order</h2>
          <p {...stylex.props(styles.drawerSubtitle)}>SQUIRE Demo Barbershop</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close order"
          {...stylex.props(styles.iconButton, styles.darkIconButton)}
        >
          <X {...stylex.props(styles.icon16)} />
        </button>
      </div>

      <div {...stylex.props(styles.orderCard)}>
        <div {...stylex.props(styles.rowBetween)}>
          <div>
            <p {...stylex.props(styles.orderProvider)}>
              {getProviderSummary(provider?.id, provider?.name)}
            </p>
            <p {...stylex.props(styles.orderMuted)}>{service?.name}</p>
          </div>
          <strong {...stylex.props(styles.mono)}>
            {formatPrice(getBookingTotal(state))}
          </strong>
        </div>
        {additions.map((addition) => (
          <div key={addition.id} {...stylex.props(styles.orderLine)}>
            <span>+ {addition.name}</span>
            <span {...stylex.props(styles.mono)}>
              {formatPrice(addition.amountMinor)}
            </span>
          </div>
        ))}
        {slot ? (
          <div {...stylex.props(styles.orderLine)}>
            <span>Time</span>
            <span>
              {slot.date} · {slot.time}
            </span>
          </div>
        ) : null}
      </div>

      <div {...stylex.props(styles.drawerFooter)}>
        <div {...stylex.props(styles.subtotal)}>
          <span>Subtotal</span>
          <span {...stylex.props(styles.mono)}>
            {formatPrice(getBookingTotal(state))}
          </span>
        </div>
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          {...stylex.props(styles.primaryButton, styles.drawerButton)}
        >
          {stage === 'service' ? 'Choose a time' : 'Continue to checkout'}
        </button>
      </div>
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  autoComplete,
  type = 'text'
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly autoComplete: string
  readonly type?: string
}) {
  return (
    <label {...stylex.props(styles.label)}>
      <span {...stylex.props(styles.labelText)}>{label}</span>
      <input
        value={value}
        type={type}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        {...stylex.props(styles.input)}
      />
    </label>
  )
}

function EmptyState({
  icon,
  title,
  description,
  action,
  onAction
}: {
  readonly icon: ReactNode
  readonly title: string
  readonly description: string
  readonly action: string
  readonly onAction: () => void
}) {
  return (
    <div {...stylex.props(styles.empty)}>
      <div>
        <span {...stylex.props(styles.emptyIcon)}>{icon}</span>
        <h2 {...stylex.props(styles.emptyTitle)}>{title}</h2>
        <p {...stylex.props(styles.emptyCopy)}>{description}</p>
        <button
          type="button"
          onClick={onAction}
          {...stylex.props(styles.secondaryButton)}
        >
          {action}
        </button>
      </div>
    </div>
  )
}

function canContinueFrom(
  stage: BookingStage,
  state: BookingPrototypeState,
  scenario: ScenarioKey
): boolean {
  if (stage === 'provider') return state.providerPreference !== null
  if (stage === 'service') {
    return scenario !== 'no-services' && state.primaryServiceId !== null
  }
  if (stage === 'schedule') return scenario !== 'no-times' && state.slotId !== null
  if (stage === 'details') {
    return state.customer.name.trim() !== '' && state.customer.email.includes('@')
  }
  if (stage === 'checkout') return state.checkoutChoice !== null
  return false
}

function getProviderSummary(providerId?: string, providerName?: string): string {
  if (providerId === 'any') return 'Any Professional'
  return providerName ?? 'Not chosen'
}

function getScenarioInitialState(scenario: ScenarioKey): {
  readonly stage: BookingStage
  readonly state: BookingPrototypeState
} {
  if (scenario === 'no-services') {
    return {
      stage: 'service',
      state: { ...initialBookingState, providerPreference: 'any' }
    }
  }
  if (scenario === 'no-times' || scenario === 'slot-lost') {
    return {
      stage: 'schedule',
      state: {
        ...initialBookingState,
        providerPreference: 'any',
        primaryServiceId: 'svc_signature'
      }
    }
  }
  return { stage: 'provider', state: initialBookingState }
}
