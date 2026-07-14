import {
  CalendarDays,
  Check,
  CreditCard,
  MapPin,
  Search,
  Scissors,
  Store,
  UsersRound,
  X,
  type LucideIcon,
  type LucideProps
} from 'lucide-react'
import type { ComponentType } from 'react'
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

function LegacyWidgetMenu({
  size: _size,
  absoluteStrokeWidth: _absoluteStrokeWidth,
  ...svgProps
}: LucideProps) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...svgProps}
    >
      <g stroke="currentColor" strokeWidth="1.5">
        <path d="M0 1h10" />
        <path d="M0 5h10" />
        <path d="M0 9h10" />
      </g>
    </svg>
  )
}

function LegacyLanguageGlobe(props: LucideProps) {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" {...props}>
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M1 6h10M6 1c1.25 1.37 1.96 3.15 2 5-.04 1.85-.75 3.63-2 5-1.25-1.37-1.96-3.15-2-5 .04-1.85.75-3.63 2-5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LegacySignInCta(props: LucideProps) {
  return (
    <svg viewBox="0 0 73 72" fill="none" aria-hidden="true" {...props}>
      <rect
        x="1"
        y="0.5"
        width="71"
        height="71"
        rx="35.5"
        stroke="currentColor"
        opacity="0.3"
      />
      <path
        d="M35.6 25.7a10.3 10.3 0 1 1-8.6 15.9l-1.4.9A12 12 0 1 0 25.6 29.5l1.4.9a10.3 10.3 0 0 1 8.6-4.7Zm2 9.5H25.5v1.7h12.1L34.5 40l1.2 1.2 4.5-4.6a.85.85 0 0 0 0-1.2l-4.5-4.6-1.2 1.2 3.1 3.2Z"
        fill="currentColor"
      />
    </svg>
  )
}

function LegacyAnyProviderArrows(props: LucideProps) {
  return (
    <svg viewBox="0 0 38 37" fill="none" aria-hidden="true" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M27.3323 12.1707V17.0785L37.8133 8.44574L27.3323 0V5.60303H25.18C19.021 5.60303 15.5431 12.0258 12.4747 17.691C9.71908 22.7855 7.33575 27.5897 3.49288 27.5897H0V34.1575H3.49288C9.65182 34.1575 13.1298 27.3299 16.1982 21.6647C18.9538 16.5702 21.3295 12.1708 25.18 12.1708L27.3323 12.1707ZM9.27833 18.2096C9.53899 17.7323 9.80709 17.2447 10.0752 16.7466C10.7306 15.5431 11.4157 14.2668 12.1605 13.0009C9.95608 10.1061 7.29727 7.96862 3.74498 7.96862H0.252092V14.5364C0.252092 14.5364 1.24263 14.4741 3.74498 14.5364C6.16542 14.609 7.68469 15.9994 9.27856 18.2095L9.27833 18.2096ZM27.5187 24.7982H25.3664C23.0204 24.7982 21.2181 23.1588 19.5426 20.7205C19.3788 21.0317 19.2075 21.343 19.0362 21.6543C18.2989 23.0135 17.5094 24.4765 16.6381 25.9187C18.9021 29.0211 21.6428 31.3661 25.3667 31.3661H27.519V37L38 28.5543L27.519 19.9215L27.5187 24.7982Z"
        fill="currentColor"
      />
    </svg>
  )
}

function LegacyGiftCard(props: LucideProps) {
  return (
    <svg viewBox="0 0 48 30" fill="none" aria-hidden="true" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0 4C0 1.79086 1.79086 0 4 0H16.9998V12.3502C16.6944 11.4779 16.2775 10.485 15.7448 9.66621C14.6917 8.04733 13.4522 7.05282 12.2418 6.64673C11.0305 6.24031 9.80434 6.42463 8.99667 7.24936C8.28857 7.97242 7.93159 8.9292 8.01041 9.9459C8.08878 10.9568 8.59132 11.9678 9.49031 12.8482C9.98873 13.3364 10.724 13.7344 11.471 14.0565C12.2345 14.3857 13.0834 14.6661 13.8664 14.8925C13.995 14.9297 14.1222 14.9655 14.2474 15H0V4ZM16.9998 17H16.8813C16.5983 17.4692 16.2028 17.8752 15.787 18.2186C15.1335 18.7584 14.3449 19.213 13.6054 19.5759C12.8614 19.9409 12.141 20.2255 11.6088 20.4185C11.3419 20.5153 11.1204 20.5897 10.9646 20.6403C10.8866 20.6656 10.8249 20.6849 10.7821 20.6981L10.7321 20.7134L10.7183 20.7175L10.7143 20.7187L10.713 20.7191L10.7126 20.7192C10.7124 20.7193 10.7122 20.7193 10.5 20L10.7122 20.7193C10.315 20.8366 9.89787 20.6095 9.78065 20.2122C9.66347 19.815 9.89038 19.3981 10.2876 19.2807L10.2877 19.2807L10.2878 19.2807L10.2895 19.2801L10.2989 19.2773L10.3395 19.2649C10.3761 19.2536 10.431 19.2364 10.5018 19.2134C10.6436 19.1674 10.8487 19.0986 11.0975 19.0084C11.5965 18.8274 12.2636 18.5633 12.9446 18.2292C13.6301 17.8929 14.304 17.498 14.8318 17.0621C14.8569 17.0413 14.8815 17.0206 14.9056 17H0V26C0 28.2091 1.79086 30 4 30H16.9998V17ZM18.9998 30H44C46.2091 30 48 28.2091 48 26V17H22.7088C22.9535 17.1322 23.1937 17.2691 23.4242 17.4098C24.1185 17.8337 24.7906 18.3312 25.2154 18.8845C25.9818 19.8825 26.3372 20.9541 26.2727 21.966C26.2079 22.9837 25.72 23.8808 24.9173 24.4972C24.0017 25.2002 22.7618 25.2103 21.6196 24.6377C20.6663 24.1598 19.7506 23.2725 18.9998 21.9729V30ZM19.0923 17H19.0063C19.0276 17.1472 19.0517 17.3037 19.0791 17.4671C19.243 18.4461 19.5135 19.6162 19.9356 20.5227C20.6491 22.0552 21.53 22.9148 22.2918 23.2968C23.0528 23.6783 23.651 23.5783 24.0037 23.3074C24.4693 22.9499 24.7389 22.4488 24.7758 21.8706C24.813 21.2865 24.6143 20.5646 24.0257 19.798C23.7731 19.469 23.294 19.0878 22.6425 18.69C22.0064 18.3016 21.2672 17.9337 20.555 17.6135C20.0268 17.376 19.5203 17.1679 19.0923 17ZM18.9998 12.3918V0H44C46.2091 0 48 1.79086 48 4V15H18.9998V14.7669C19.8635 13.4194 21.1149 12.4447 22.2378 11.7819C22.8712 11.4081 23.4496 11.1418 23.8678 10.9698C24.0765 10.8839 24.2443 10.8219 24.3577 10.7821C24.4144 10.7622 24.4574 10.7478 24.4851 10.7388L24.5148 10.7293L24.5203 10.7276L24.5207 10.7275C24.9169 10.6072 25.1407 10.1886 25.0206 9.79234C24.9005 9.39592 24.4818 9.17191 24.0854 9.29201L24.3028 10.0098C24.0854 9.29201 24.0851 9.29208 24.0849 9.29216L24.0843 9.29234L24.0828 9.2928L24.0786 9.2941L24.0653 9.29822L24.0203 9.31263C23.9823 9.32502 23.9285 9.34302 23.8606 9.36687C23.7248 9.41457 23.5324 9.48579 23.2971 9.58258C22.8274 9.77583 22.1826 10.0727 21.4753 10.4902C20.688 10.9549 19.8051 11.5798 18.9998 12.3918ZM15.765 13.3891C15.8191 13.5598 15.8683 13.723 15.9127 13.8758C15.4463 13.7666 14.8795 13.624 14.2831 13.4515C13.533 13.2346 12.7494 12.9743 12.065 12.6791C11.3641 12.3769 10.8362 12.0668 10.5398 11.7766C9.8493 11.1003 9.55116 10.4135 9.50592 9.82996C9.46114 9.2523 9.65764 8.71826 10.0684 8.29888C10.3795 7.98116 10.9577 7.79807 11.7647 8.06883C12.5727 8.33991 13.5657 9.06715 14.4875 10.4842C15.0328 11.3224 15.465 12.4429 15.765 13.3891Z"
        fill="currentColor"
      />
    </svg>
  )
}

const codeNativeIconByName: Readonly<Record<string, ComponentType<LucideProps>>> = {
  ...iconByName,
  'legacy-back-chevron': LegacyBackChevron,
  'legacy-widget-menu': LegacyWidgetMenu,
  'legacy-language-globe': LegacyLanguageGlobe,
  'legacy-sign-in-cta': LegacySignInCta,
  'legacy-any-provider-arrows': LegacyAnyProviderArrows,
  'legacy-gift-card': LegacyGiftCard
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
    const Icon = codeNativeIconByName[asset.name]
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
