import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  BadgeCheck,
  CalendarClock,
  ChevronRight,
  Code2,
  CreditCard,
  LogOut,
  Palette,
  Scissors,
  UserRound,
  UsersRound
} from 'lucide-react'
import { MerchantAvatar } from '@/components/merchant-avatar.tsx'
import { MerchantAdvancedSettings } from '@/components/merchant-advanced-settings.tsx'
import { useDesktopSecondaryDialog } from '@/components/merchant-shell/desktop/desktop-secondary-dialog-context.ts'
import { MerchantThemeControl } from '@/components/merchant-theme-control.tsx'
import { merchantOverlayNavigationState } from '@/lib/merchant-home-route.ts'
import type { MerchantViewer } from '@/lib/merchant-viewer.ts'

type SignOutState = {
  readonly error: string | null
  readonly pending: boolean
  readonly signOut: () => void
}

type SettingsDestination =
  | '/availability'
  | '/customers'
  | '/providers'
  | '/services'
  | '/settings/advanced'
  | '/settings/appearance'
  | '/settings/subscription'

export function MerchantSettingsPanel({
  appointmentDate,
  signOut,
  viewer
}: {
  readonly appointmentDate: string | undefined
  readonly signOut: SignOutState
  readonly viewer: MerchantViewer | undefined
}) {
  const desktopSecondaryDialog = useDesktopSecondaryDialog()

  return (
    <div data-merchant-settings-panel="true" className="mx-auto w-full max-w-md">
      <section
        data-merchant-settings-profile="true"
        className="flex min-h-[9.375rem] w-full flex-col items-center gap-4 pt-4 text-center"
      >
        <MerchantAvatar size="profile" viewer={viewer} />
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <div className="flex max-w-full items-center justify-center gap-1.5">
            <p className="truncate text-xl leading-6 font-medium tracking-[-0.025em] text-foreground">
              {viewer?.name ?? 'Merchant member'}
            </p>
            {viewer?.emailVerified ? (
              <span aria-label="Verified account" title="Verified account">
                <BadgeCheck
                  aria-hidden
                  className="size-5 fill-muted-foreground text-background"
                  strokeWidth={2.5}
                />
              </span>
            ) : null}
          </div>
          {viewer?.email ? (
            <p className="max-w-full truncate text-sm leading-5 font-medium text-muted-foreground">
              {viewer.email}
            </p>
          ) : null}
        </div>
      </section>

      <div className="flex flex-col gap-9 py-6">
        <SettingsGroup>
          <SettingsLink
            appointmentDate={appointmentDate}
            icon={<UsersRound />}
            label="Customers"
            to="/customers"
          />
          <SettingsLink
            appointmentDate={appointmentDate}
            icon={<Scissors />}
            label="Services"
            to="/services"
          />
          <SettingsLink
            appointmentDate={appointmentDate}
            icon={<UserRound />}
            label="Providers"
            to="/providers"
          />
          <SettingsLink
            appointmentDate={appointmentDate}
            icon={<CalendarClock />}
            label="Availability"
            to="/availability"
          />
        </SettingsGroup>

        <SettingsGroup>
          <SettingsLink
            appointmentDate={appointmentDate}
            icon={<CreditCard />}
            label="Subscription"
            to="/settings/subscription"
          />
          {desktopSecondaryDialog ? (
            <SettingsLink
              appointmentDate={appointmentDate}
              icon={<Palette />}
              label="Appearance"
              to="/settings/appearance"
            />
          ) : (
            <SettingsDisclosure icon={<Palette />} label="Appearance">
              <div className="[&>fieldset]:mt-0">
                <MerchantThemeControl />
              </div>
            </SettingsDisclosure>
          )}
          {desktopSecondaryDialog ? (
            <SettingsLink
              appointmentDate={appointmentDate}
              icon={<Code2 />}
              label="Advanced"
              to="/settings/advanced"
            />
          ) : (
            <SettingsDisclosure icon={<Code2 />} label="Advanced">
              <MerchantAdvancedSettings />
            </SettingsDisclosure>
          )}
          <button
            type="button"
            data-merchant-settings-row="true"
            disabled={signOut.pending}
            className="group flex min-h-[3.3125rem] w-full items-center justify-between px-4 text-left transition-colors active:bg-muted/80 disabled:opacity-60 md:hover:bg-muted/60"
            onClick={signOut.signOut}
          >
            <SettingsRowLabel
              icon={<LogOut />}
              label={signOut.pending ? 'Logging out…' : 'Log out'}
            />
            <ChevronRight
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
          </button>
        </SettingsGroup>
        {signOut.error ? (
          <p role="alert" className="-mt-6 px-4 text-sm text-destructive">
            {signOut.error}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function SettingsGroup({ children }: { readonly children: ReactNode }) {
  return (
    <div
      data-merchant-settings-group="true"
      className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-muted/30"
    >
      {children}
    </div>
  )
}

function SettingsLink({
  appointmentDate,
  icon,
  label,
  to
}: {
  readonly appointmentDate: string | undefined
  readonly icon: ReactNode
  readonly label: string
  readonly to: SettingsDestination
}) {
  return (
    <Link
      to={to}
      search={appointmentDate ? { date: appointmentDate } : {}}
      state={(previous) => merchantOverlayNavigationState(previous, appointmentDate)}
      viewTransition={false}
      data-merchant-settings-row="true"
      className="group flex min-h-[3.3125rem] items-center justify-between px-4 transition-colors active:bg-muted/80 md:hover:bg-muted/60"
    >
      <SettingsRowLabel icon={icon} label={label} />
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

function SettingsDisclosure({
  children,
  icon,
  label
}: {
  readonly children: ReactNode
  readonly icon: ReactNode
  readonly label: string
}) {
  return (
    <details className="group/disclosure">
      <summary
        data-merchant-settings-row="true"
        className="flex min-h-[3.3125rem] cursor-pointer list-none items-center justify-between px-4 transition-colors active:bg-muted/80 md:hover:bg-muted/60 [&::-webkit-details-marker]:hidden"
      >
        <SettingsRowLabel icon={icon} label={label} />
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open/disclosure:rotate-90"
        />
      </summary>
      <div className="border-t border-border bg-background/60 p-4">{children}</div>
    </details>
  )
}

function SettingsRowLabel({
  icon,
  label
}: {
  readonly icon: ReactNode
  readonly label: string
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <span className="grid size-5 shrink-0 place-items-center text-muted-foreground [&>svg]:size-5 [&>svg]:stroke-[1.8]">
        {icon}
      </span>
      <span className="truncate text-sm font-medium text-foreground">{label}</span>
    </span>
  )
}
