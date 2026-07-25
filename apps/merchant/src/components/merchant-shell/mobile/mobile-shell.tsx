import type { ReactNode } from 'react'
import type { MerchantDestination, MerchantShellSection } from '../navigation.tsx'
import { MobileHomeLayout } from './mobile-home-layout.tsx'
import { MobileRouteSheet } from './mobile-route-sheet.tsx'

type MobileShellProps = {
  readonly section: MerchantShellSection
  readonly destinations: readonly MerchantDestination[]
  readonly children: ReactNode
} & (
  | {
      readonly layout: 'sheet' | 'task'
      readonly title: string
      readonly description: string
      readonly onRequestBack?: (() => void) | undefined
      readonly onRequestClose?: (() => void) | undefined
    }
  | {
      readonly layout: 'home'
      readonly date: string
      readonly timezone: string
    }
)

export function MobileShell(props: MobileShellProps) {
  if (props.layout === 'home') {
    return (
      <MobileHomeLayout appointmentDate={props.date} timezone={props.timezone}>
        {props.children}
      </MobileHomeLayout>
    )
  }

  return (
    <MobileRouteSheet
      layout={props.layout}
      title={props.title}
      onRequestBack={props.onRequestBack}
      onRequestClose={props.onRequestClose}
    >
      {props.children}
    </MobileRouteSheet>
  )
}
