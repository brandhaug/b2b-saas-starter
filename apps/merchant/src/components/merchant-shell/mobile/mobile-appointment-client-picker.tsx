import type { CustomerDirectory } from '@b2b-saas-starter/capabilities/booking'
import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Info,
  Plus,
  X
} from 'lucide-react'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode
} from 'react'
import { customerInitials } from '@/features/customers/mobile-customer-contact-model.ts'
import { MobileSheetScrollport } from './mobile-sheet-scrollport.tsx'
import { MobileSearchField } from './mobile-search-field.tsx'
import { useMobileCollapsingSheetTitle } from './use-mobile-collapsing-sheet-title.ts'
import {
  appointmentClientFromDirectory,
  groupAppointmentClients,
  makeDraftAppointmentClient,
  type AppointmentClient
} from './mobile-appointment-client-model.ts'

const alphabet = [...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'), '#'] as const

const formValue = (data: FormData, key: string) => {
  const value = data.get(key)
  return typeof value === 'string' ? value : ''
}

const useAppointmentStepEntrance = (enabled: boolean) => {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (
      !element ||
      !enabled ||
      typeof element.animate !== 'function' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    )
      return
    const animation = element.animate(
      [
        { opacity: 0.72, transform: 'translate3d(1.5rem, 0, 0)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' }
      ],
      {
        duration: 220,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'both'
      }
    )
    return () => animation.cancel()
  }, [enabled])
  return ref
}

export function MobileAppointmentClientPicker({
  directory,
  loading,
  error,
  selectedClient,
  onBack,
  onAddClient,
  onConfirm,
  desktop = false
}: {
  readonly directory: CustomerDirectory | null
  readonly loading: boolean
  readonly error: boolean
  readonly selectedClient: AppointmentClient | null
  readonly onBack: () => void
  readonly onAddClient: () => void
  readonly onConfirm: (client: AppointmentClient) => void
  readonly desktop?: boolean
}) {
  const [query, setQuery] = useState('')
  const [pendingClient, setPendingClient] = useState(selectedClient)
  const searchId = useId()
  const sectionPrefix = useId().replace(/:/g, '')
  const entranceRef = useAppointmentStepEntrance(!desktop)
  const groups = useMemo(
    () => groupAppointmentClients(directory?.entries ?? [], query),
    [directory?.entries, query]
  )
  const availableLetters = useMemo(
    () => new Set(groups.map((group) => group.letter)),
    [groups]
  )

  return (
    <div
      ref={entranceRef}
      data-mobile-client-picker="true"
      className="flex h-full min-h-0 flex-col"
    >
      <ClientStepHeader title="Select a client" onBack={onBack} desktop={desktop} />
      <div data-mobile-client-search-region="true" className="shrink-0 px-4 pt-3 pb-2">
        <MobileSearchField
          id={searchId}
          label="Search clients"
          placeholder="Search clients"
          value={query}
          clearLabel="Clear client search"
          inputDataAttribute="data-mobile-client-search"
          onValueChange={setQuery}
        />
      </div>

      <MobileSheetScrollport className="px-4">
        <div
          data-mobile-client-results="true"
          className="relative min-h-full pr-5 pb-[max(9rem,calc(env(safe-area-inset-bottom)+7.5rem))]"
        >
          <button
            type="button"
            data-mobile-add-client="true"
            onClick={onAddClient}
            className="mt-2 flex min-h-16 w-full items-center gap-4 border-b border-border/70 text-left text-info active:opacity-70"
          >
            <Plus aria-hidden className="size-6 text-foreground" strokeWidth={2.6} />
            <span className="flex-1 text-[1.0625rem] font-semibold">Add a client</span>
            <ChevronRight
              aria-hidden
              className="size-5 text-muted-foreground"
              strokeWidth={1.7}
            />
          </button>

          {loading ? (
            <ClientListMessage>Loading clients…</ClientListMessage>
          ) : error ? (
            <ClientListMessage>
              Clients could not be loaded. Close and try again.
            </ClientListMessage>
          ) : groups.length === 0 ? (
            <ClientListMessage>
              {query ? 'No clients match that search.' : 'No clients yet.'}
            </ClientListMessage>
          ) : (
            <div className="pb-4">
              {groups.map((group) => (
                <section
                  key={group.letter}
                  id={`${sectionPrefix}-${group.letter}`}
                  data-mobile-client-group={group.letter}
                  className="scroll-mt-2"
                >
                  <h2 className="pb-2 pt-5 text-[1.75rem] leading-none font-bold">
                    {group.letter}
                  </h2>
                  <div className="divide-y divide-border/70">
                    {group.entries.map((entry) => {
                      const selected = pendingClient?.id === entry.appointmentId
                      return (
                        <button
                          key={entry.appointmentId}
                          type="button"
                          data-mobile-client-option={entry.appointmentId}
                          aria-pressed={selected}
                          onClick={() =>
                            setPendingClient(appointmentClientFromDirectory(entry))
                          }
                          className="flex min-h-14 w-full items-center gap-3 text-left active:opacity-70"
                        >
                          <span className="min-w-0 flex-1 truncate text-[1.0625rem] font-medium">
                            {entry.name}
                          </span>
                          <span
                            aria-hidden
                            className={`grid size-9 shrink-0 place-items-center rounded-lg text-sm font-semibold transition-colors ${
                              selected
                                ? 'bg-info text-info-foreground'
                                : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {selected ? (
                              <Check className="size-6" strokeWidth={2.2} />
                            ) : (
                              customerInitials(entry.name).slice(0, 1)
                            )}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}

          <nav
            aria-label="Client index"
            className="fixed right-1 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center"
          >
            {alphabet.map((letter) => (
              <button
                key={letter}
                type="button"
                disabled={!availableLetters.has(letter)}
                aria-label={`Clients beginning with ${letter}`}
                onClick={() =>
                  document
                    .getElementById(`${sectionPrefix}-${letter}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
                className="h-[0.9rem] min-w-5 text-center text-[0.625rem] leading-none font-semibold text-info disabled:text-muted-foreground/45"
              >
                {letter}
              </button>
            ))}
          </nav>
        </div>
      </MobileSheetScrollport>

      {pendingClient ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-30 flex justify-center">
          <button
            type="button"
            aria-label={`Choose ${pendingClient.name}`}
            data-mobile-client-confirm="true"
            onClick={() => onConfirm(pendingClient)}
            className="pointer-events-auto grid size-[4.75rem] place-items-center rounded-[1.65rem] bg-info text-info-foreground shadow-xl shadow-black/20 transition-transform active:scale-95"
          >
            <Check aria-hidden className="size-9" strokeWidth={2.15} />
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function MobileAppointmentAddClient({
  onBack,
  onSave,
  desktop = false
}: {
  readonly onBack: () => void
  readonly onSave: (client: AppointmentClient) => void
  readonly desktop?: boolean
}) {
  const [blockBooking, setBlockBooking] = useState(false)
  const [prepaidOnly, setPrepaidOnly] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [valid, setValid] = useState(false)
  const entranceRef = useAppointmentStepEntrance(!desktop)
  const {
    collapsed: compactHeader,
    handleScroll: handleTitleScroll,
    largeTitleRef
  } = useMobileCollapsingSheetTitle<HTMLHeadingElement>()

  const updateValidity = (form: HTMLFormElement) => {
    const data = new FormData(form)
    const hasName = Boolean(
      `${formValue(data, 'firstName')}${formValue(data, 'lastName')}`.trim()
    )
    const hasContact = Boolean(
      `${formValue(data, 'email')}${formValue(data, 'phone')}`.trim()
    )
    setValid(hasName && hasContact)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const phone = formValue(data, 'phone').trim()
    const countryCode = formValue(data, 'countryCode')
    onSave(
      makeDraftAppointmentClient({
        firstName: formValue(data, 'firstName'),
        lastName: formValue(data, 'lastName'),
        email: formValue(data, 'email'),
        phone: phone.startsWith('+')
          ? phone
          : [countryCode, phone].filter(Boolean).join(' '),
        birthday: formValue(data, 'birthday'),
        blockBooking,
        prepaidOnly,
        notes: formValue(data, 'notes')
      })
    )
  }

  return (
    <div
      ref={entranceRef}
      data-mobile-add-client-form="true"
      className="flex h-full min-h-0 flex-col"
    >
      <ClientStepHeader
        title="Add a new client"
        onBack={onBack}
        compact
        collapsible={!desktop}
        titleVisible={desktop || compactHeader}
        desktop={desktop}
      />
      <MobileSheetScrollport
        className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        onScroll={desktop ? undefined : handleTitleScroll}
      >
        <form
          className="relative flex min-h-full flex-col"
          onInput={(event) => updateValidity(event.currentTarget)}
          onSubmit={handleSubmit}
        >
          <h1
            ref={largeTitleRef}
            aria-hidden={compactHeader}
            data-mobile-add-client-large-title="true"
            data-visible={compactHeader ? 'false' : 'true'}
            className={`max-w-64 pb-7 pt-5 text-[2.25rem] leading-[1.05] font-bold tracking-[-0.035em] ${
              compactHeader ? 'invisible opacity-0' : 'visible opacity-100'
            }`}
          >
            Add a new client
          </h1>

          <div className="space-y-4 border-y border-border/70 py-5">
            <ClientInput
              label="First name"
              name="firstName"
              placeholder="Enter first name"
            />
            <ClientInput
              label="Last name"
              name="lastName"
              placeholder="Enter last name"
            />
            <ClientInput
              label="Email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="Enter client email"
            />
            <ClientPhoneInput />
            <ClientInput label="Birthday" name="birthday" type="date" />
          </div>

          <div className="divide-y divide-border/70">
            <ClientSetting
              icon={<Ban />}
              label="Block booking ability"
              detail="When this is on, the client cannot book an appointment, but you can still add appointments for them."
              checked={blockBooking}
              onChange={setBlockBooking}
            />
            <ClientSetting
              icon={<CircleDollarSign />}
              label="Prepaid only"
              detail="Require this client to prepay when booking an appointment."
              checked={prepaidOnly}
              onChange={setPrepaidOnly}
            />
            <button
              type="button"
              onClick={() => setNotesOpen((current) => !current)}
              className="flex min-h-16 w-full items-center gap-4 text-left text-info"
            >
              <Info aria-hidden className="size-5 text-muted-foreground" />
              <span className="flex-1 text-[1.0625rem] font-medium">
                Add client notes
              </span>
              <ChevronRight
                aria-hidden
                className={`size-5 text-muted-foreground transition-transform ${
                  notesOpen ? 'rotate-90' : ''
                }`}
              />
            </button>
          </div>
          {notesOpen ? (
            <textarea
              name="notes"
              aria-label="Client notes"
              rows={4}
              placeholder="Notes visible to your team"
              className="mt-3 resize-none rounded-xl bg-muted p-3 text-base outline-none placeholder:text-muted-foreground"
            />
          ) : null}

          <button
            type="submit"
            disabled={!valid}
            data-mobile-add-client-save="true"
            className="mt-7 flex h-14 w-full items-center justify-center rounded-xl bg-info text-[1.0625rem] font-semibold text-info-foreground transition-[opacity,transform] active:scale-[0.99] disabled:bg-muted disabled:text-muted-foreground disabled:opacity-55"
          >
            Add client
          </button>
        </form>
      </MobileSheetScrollport>
    </div>
  )
}

function ClientStepHeader({
  title,
  onBack,
  compact = false,
  collapsible = false,
  titleVisible = true,
  desktop = false
}: {
  readonly title: string
  readonly onBack: () => void
  readonly compact?: boolean
  readonly collapsible?: boolean
  readonly titleVisible?: boolean
  readonly desktop?: boolean
}) {
  const showTitle = !collapsible || titleVisible
  return (
    <header
      data-mobile-add-client-compact-header={collapsible ? 'true' : undefined}
      data-visible={collapsible ? (showTitle ? 'true' : 'false') : undefined}
      className={`relative z-20 flex shrink-0 items-center gap-2 bg-background px-2 transition-colors duration-150 ${
        compact ? 'h-14' : 'h-16'
      } ${
        collapsible && !showTitle
          ? 'border-b-0 border-transparent'
          : 'border-b border-border/70'
      }`}
    >
      <button
        type="button"
        aria-label={
          desktop
            ? `Back from ${title.toLocaleLowerCase()}`
            : `Close ${title.toLocaleLowerCase()}`
        }
        onClick={onBack}
        className="grid size-11 place-items-center rounded-full text-muted-foreground active:bg-muted"
      >
        {desktop ? (
          <ChevronLeft aria-hidden className="size-6" strokeWidth={2} />
        ) : (
          <X aria-hidden className="size-7" strokeWidth={1.5} />
        )}
      </button>
      <h1
        aria-hidden={!showTitle}
        data-mobile-add-client-compact-title={collapsible ? 'true' : undefined}
        className={`truncate text-[1.0625rem] font-semibold ${
          showTitle ? 'visible opacity-100' : 'invisible opacity-0'
        }`}
      >
        {title}
      </h1>
    </header>
  )
}

function ClientListMessage({ children }: { readonly children: ReactNode }) {
  return (
    <div className="grid min-h-40 place-items-center px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function ClientInput({
  label,
  icon,
  ...input
}: {
  readonly label: string
  readonly icon?: ReactNode
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>) {
  const id = useId()
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-[0.6875rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="flex h-13 items-center rounded-lg bg-muted px-3">
        <input
          {...input}
          id={id}
          className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        {icon ? (
          <span className="ml-2 text-muted-foreground [&_svg]:size-5">{icon}</span>
        ) : null}
      </span>
    </label>
  )
}

function ClientPhoneInput() {
  const id = useId()
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-[0.6875rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
        Phone
      </span>
      <span className="flex h-13 items-center rounded-lg bg-muted px-3">
        <select
          name="countryCode"
          aria-label="Country code"
          defaultValue="+40"
          className="mr-2 max-w-[6.5rem] shrink-0 appearance-none bg-transparent text-base font-medium text-foreground outline-none"
        >
          <option value="+40">🇷🇴 +40</option>
          <option value="+1">🇺🇸 +1</option>
          <option value="+44">🇬🇧 +44</option>
        </select>
        <input
          id={id}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="712 345 678"
          className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/70"
        />
      </span>
    </label>
  )
}

function ClientSetting({
  icon,
  label,
  detail,
  checked,
  onChange
}: {
  readonly icon: ReactNode
  readonly label: string
  readonly detail: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex gap-4 py-5">
      <span className="pt-0.5 text-muted-foreground [&_svg]:size-5">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[1.0625rem] font-medium">{label}</p>
        <p className="mt-1 max-w-[17rem] text-sm leading-5 text-muted-foreground">
          {detail}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-8 w-[3.25rem] shrink-0 rounded-full transition-colors ${
          checked ? 'bg-info' : 'bg-muted-foreground/35'
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-1 left-0 size-6 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}
