import {
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

function LegacyBackChevron({
  size: _size,
  absoluteStrokeWidth: _absoluteStrokeWidth,
  ...svgProps
}: LucideProps) {
  return (
    <svg
      width="9"
      height="16"
      viewBox="0 0 9 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...svgProps}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.07552 15.8411C8.54948 15.8411 8.91406 15.4766 8.91406 15.0026C8.91406 14.7747 8.8138 14.5651 8.66797 14.4102L2.04167 7.92057L8.66797 1.43099C8.8138 1.27604 8.91406 1.05729 8.91406 0.838542C8.91406 0.364583 8.54948 0 8.07552 0C7.84766 0 7.63802 0.0911458 7.48307 0.255208L0.264323 7.3099C0.0911465 7.46484 0 7.68359 0 7.92057C0 8.14844 0.0911465 8.35807 0.264323 8.53125L7.48307 15.5951C7.64714 15.75 7.84766 15.8411 8.07552 15.8411Z"
        fill="currentColor"
      />
    </svg>
  )
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
    if (asset.name === 'legacy-back-chevron') {
      return <LegacyBackChevron {...iconProps} />
    }
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
