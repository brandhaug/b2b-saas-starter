import {
  ArrowLeft,
  CalendarDays,
  Check,
  CreditCard,
  Menu,
  MapPin,
  Search,
  Scissors,
  Store,
  UsersRound,
  X,
  type LucideIcon,
  type LucideProps
} from 'lucide-react'
import { visualAssetManifest } from './visual-asset-manifest.ts'
import { resolveVisualAsset, type VisualAssetRole } from './visual-asset-policy.ts'
import './booking-visual-asset.css'

const bundledShippingAssets = import.meta.glob<string>('./shipping/*', {
  eager: true,
  import: 'default',
  query: '?url'
})

const iconByName: Readonly<Record<string, LucideIcon>> = {
  'arrow-left': ArrowLeft,
  'calendar-days': CalendarDays,
  check: Check,
  'credit-card': CreditCard,
  'group-appointment-motion': UsersRound,
  menu: Menu,
  'map-pin': MapPin,
  search: Search,
  scissors: Scissors,
  store: Store,
  'users-round': UsersRound,
  'walk-in-status-composition': Store,
  x: X
}

export function BookingVisualAsset({
  assetRole,
  enabledProviders = [],
  today = new Date().toISOString().slice(0, 10),
  label,
  ...iconProps
}: LucideProps & {
  readonly assetRole: VisualAssetRole
  readonly enabledProviders?: readonly string[]
  readonly today?: string
  readonly label?: string
}) {
  const asset = resolveVisualAsset({
    role: assetRole,
    enabledProviders,
    entries: visualAssetManifest,
    today
  })

  if (asset.kind === 'code-native') {
    const Icon = iconByName[asset.name]
    if (!Icon) return null
    const motionClass =
      asset.name === 'group-appointment-motion'
        ? 'booking-group-appointment-motion'
        : undefined
    const className = [iconProps.className, motionClass].filter(Boolean).join(' ')
    return <Icon {...iconProps} className={className || undefined} />
  }
  if (asset.kind === 'local-manifest-asset') {
    const shippingPath = asset.file.replace(/^src\/assets\//, './')
    const source = asset.file.startsWith('public/')
      ? `/${asset.file.slice('public/'.length)}`
      : bundledShippingAssets[shippingPath]
    if (!source) return null
    return (
      <img
        src={source}
        alt={label ?? ''}
        data-asset-id={asset.assetId}
        data-integrity={asset.integrity}
        className={iconProps.className}
      />
    )
  }
  if (asset.kind === 'text') {
    return <span className={iconProps.className}>{label ?? asset.label}</span>
  }
  return null
}
