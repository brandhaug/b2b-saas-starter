import * as stylex from '@stylexjs/stylex'
import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  useReducedMotion,
  type Transition,
  type Variants
} from 'motion/react'
import {
  useEffect,
  useEffectEvent,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode
} from 'react'
import { bookingTheme } from './booking-theme.stylex.ts'

type Gap = 'none' | 'xs' | 'sm' | 'md' | 'lg'
type TextTone = 'default' | 'muted' | 'danger' | 'success'
type TextVariant = 'caption' | 'body' | 'headline' | 'title' | 'largeTitle' | 'price'

const styles = stylex.create({
  viewportFrame: {
    minHeight: '100dvh',
    backgroundColor: bookingTheme.colorCanvas
  },
  viewport: {
    width: '100%',
    maxWidth: bookingTheme.breakpointWidget,
    minHeight: '100dvh',
    marginInline: 'auto',
    overflowX: 'hidden',
    backgroundColor: bookingTheme.colorCanvas,
    color: bookingTheme.colorText,
    fontFamily: bookingTheme.fontText,
    overflowY: 'auto'
  },
  viewportDocumentScroll: { overflowY: 'visible' },
  stack: { display: 'flex', minWidth: 0, flexDirection: 'column' },
  inline: { display: 'flex', minWidth: 0, alignItems: 'center', flexWrap: 'wrap' },
  gapNone: { gap: bookingTheme.space0 },
  gapXs: { gap: bookingTheme.space1 },
  gapSm: { gap: bookingTheme.space2 },
  gapMd: { gap: bookingTheme.space4 },
  gapLg: { gap: bookingTheme.space6 },
  surface: {
    minWidth: 0,
    padding: bookingTheme.space4,
    borderRadius: bookingTheme.radiusLarge,
    backgroundColor: bookingTheme.colorSurface
  },
  divider: { height: 1, border: 0, backgroundColor: bookingTheme.colorBorder },
  text: { margin: 0, overflowWrap: 'anywhere' },
  textCaption: { fontSize: bookingTheme.textCaption },
  textBody: { fontSize: bookingTheme.textBody },
  textHeadline: {
    fontSize: bookingTheme.textHeadline,
    fontWeight: bookingTheme.fontWeightSemibold
  },
  textTitle: {
    fontFamily: bookingTheme.fontDisplay,
    fontSize: bookingTheme.textTitle,
    fontWeight: bookingTheme.fontWeightSemibold
  },
  textLargeTitle: {
    fontFamily: bookingTheme.fontDisplay,
    fontSize: bookingTheme.textLargeTitle,
    fontWeight: bookingTheme.fontWeightSemibold
  },
  textPrice: { fontFamily: bookingTheme.fontPrice, fontSize: bookingTheme.textPrice },
  textMuted: { color: bookingTheme.colorTextMuted },
  textDanger: { color: bookingTheme.colorDanger },
  textSuccess: { color: bookingTheme.colorSuccess },
  button: {
    display: 'inline-flex',
    minHeight: bookingTheme.targetMinimum,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: bookingTheme.space3,
    paddingInline: bookingTheme.space4,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: bookingTheme.colorBorder,
    borderRadius: bookingTheme.radiusMedium,
    backgroundColor: bookingTheme.colorSurface,
    color: bookingTheme.colorText,
    fontWeight: bookingTheme.fontWeightSemibold,
    textAlign: 'center',
    whiteSpace: 'normal',
    ':disabled': { opacity: 0.5, cursor: 'not-allowed' }
  },
  buttonPrimary: {
    borderColor: bookingTheme.colorPrimary,
    backgroundColor: bookingTheme.colorPrimary,
    color: bookingTheme.whiteA100
  },
  buttonDanger: {
    borderColor: bookingTheme.colorDanger,
    color: bookingTheme.colorDanger
  },
  iconButton: {
    width: bookingTheme.targetMinimum,
    paddingInline: 0,
    borderRadius: bookingTheme.radiusRound
  },
  field: { display: 'grid', gap: bookingTheme.space2 },
  label: {
    fontSize: bookingTheme.textFootnote,
    fontWeight: bookingTheme.fontWeightSemibold
  },
  input: {
    width: '100%',
    minHeight: bookingTheme.targetMinimum,
    paddingInline: bookingTheme.space3,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: bookingTheme.colorBorder,
    borderRadius: bookingTheme.radiusMedium,
    backgroundColor: bookingTheme.colorSurface,
    color: bookingTheme.colorText,
    fontSize: bookingTheme.textInput
  },
  inputInvalid: { borderColor: bookingTheme.colorDanger },
  error: {
    margin: 0,
    color: bookingTheme.colorDanger,
    fontSize: bookingTheme.textFootnote
  },
  selectable: { width: '100%', justifyContent: 'flex-start', textAlign: 'left' },
  selected: {
    borderColor: bookingTheme.colorPrimary,
    backgroundColor: bookingTheme.colorPrimaryA10
  },
  skeleton: {
    minHeight: 20,
    borderRadius: bookingTheme.radiusSmall,
    backgroundColor: bookingTheme.blackA10,
    animationName: stylex.keyframes({
      '0%': { opacity: 0.45 },
      '50%': { opacity: 0.8 },
      '100%': { opacity: 0.45 }
    }),
    animationDuration: bookingTheme.motionSkeleton,
    animationIterationCount: 'infinite',
    '@media (prefers-reduced-motion: reduce)': { animationName: 'none' }
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: bookingTheme.layerChrome,
    backgroundColor: bookingTheme.blackA30
  },
  sheet: {
    position: 'fixed',
    top: 'auto',
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: bookingTheme.layerPopupStack,
    width: '100%',
    maxWidth: bookingTheme.breakpointWidget,
    maxHeight: bookingTheme.sheetMaxHeight,
    marginInline: 'auto',
    marginBlock: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding: bookingTheme.space4,
    borderWidth: 0,
    borderTopLeftRadius: bookingTheme.radiusSheet,
    borderTopRightRadius: bookingTheme.radiusSheet,
    backgroundColor: bookingTheme.colorSurface,
    boxShadow: bookingTheme.shadowSheet
  },
  overlayHeading: {
    margin: 0,
    paddingRight: bookingTheme.space12,
    fontSize: bookingTheme.textTitleSmall
  },
  close: {
    position: 'absolute',
    top: bookingTheme.space3,
    right: bookingTheme.space3
  },
  toast: {
    position: 'fixed',
    right: bookingTheme.space4,
    bottom: bookingTheme.space4,
    left: bookingTheme.space4,
    zIndex: bookingTheme.layerToast,
    width: 'calc(100% - 32px)',
    maxWidth: bookingTheme.toastMaxWidth,
    marginInline: 'auto',
    padding: bookingTheme.space4,
    borderRadius: bookingTheme.radiusMedium,
    backgroundColor: bookingTheme.colorText,
    color: bookingTheme.colorSurface
  },
  tooltip: {
    position: 'absolute',
    zIndex: bookingTheme.layerTooltip,
    padding: bookingTheme.space2,
    borderRadius: bookingTheme.radiusSmall,
    backgroundColor: bookingTheme.colorText,
    color: bookingTheme.colorSurface,
    fontSize: bookingTheme.textCaption
  },
  processing: {
    position: 'fixed',
    inset: 0,
    zIndex: bookingTheme.layerProcessing,
    display: 'grid',
    placeItems: 'center',
    backgroundColor: bookingTheme.whiteA90
  },
  fallback: {
    display: 'inline-flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: bookingTheme.space2
  },
  fallbackIndicator: {
    color: bookingTheme.colorTextMuted,
    fontSize: bookingTheme.textCaption
  }
})

const gapStyle = (gap: Gap) =>
  ({
    none: styles.gapNone,
    xs: styles.gapXs,
    sm: styles.gapSm,
    md: styles.gapMd,
    lg: styles.gapLg
  })[gap]

export function BookingViewport({
  children,
  scrollOwner = 'content'
}: {
  readonly children: ReactNode
  readonly scrollOwner?: 'content' | 'document'
}) {
  return (
    <div {...stylex.props(styles.viewportFrame)}>
      <main
        data-scroll-owner={scrollOwner}
        {...stylex.props(
          styles.viewport,
          scrollOwner === 'document' && styles.viewportDocumentScroll
        )}
      >
        {children}
      </main>
    </div>
  )
}

export function BookingStack({
  children,
  gap = 'md'
}: {
  readonly children: ReactNode
  readonly gap?: Gap
}) {
  return <div {...stylex.props(styles.stack, gapStyle(gap))}>{children}</div>
}

export function BookingInline({
  children,
  gap = 'sm'
}: {
  readonly children: ReactNode
  readonly gap?: Gap
}) {
  return <div {...stylex.props(styles.inline, gapStyle(gap))}>{children}</div>
}

export function BookingSurface({ children }: { readonly children: ReactNode }) {
  return <section {...stylex.props(styles.surface)}>{children}</section>
}

export function BookingDivider() {
  return <hr {...stylex.props(styles.divider)} />
}

export function BookingText({
  children,
  variant = 'body',
  tone = 'default'
}: {
  readonly children: ReactNode
  readonly variant?: TextVariant
  readonly tone?: TextTone
}) {
  return (
    <p
      {...stylex.props(
        styles.text,
        variant === 'caption' && styles.textCaption,
        variant === 'body' && styles.textBody,
        variant === 'headline' && styles.textHeadline,
        variant === 'title' && styles.textTitle,
        variant === 'largeTitle' && styles.textLargeTitle,
        variant === 'price' && styles.textPrice,
        tone === 'muted' && styles.textMuted,
        tone === 'danger' && styles.textDanger,
        tone === 'success' && styles.textSuccess
      )}
    >
      {children}
    </p>
  )
}

type BookingButtonProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children' | 'disabled' | 'name' | 'onClick' | 'type'
> & { readonly tone?: 'primary' | 'secondary' | 'danger' }

export function BookingButton({
  tone = 'secondary',
  type = 'button',
  ...props
}: BookingButtonProps) {
  return (
    <button
      type={type}
      {...props}
      {...stylex.props(
        styles.button,
        tone === 'primary' && styles.buttonPrimary,
        tone === 'danger' && styles.buttonDanger
      )}
    />
  )
}

export function BookingIconButton(props: Omit<BookingButtonProps, 'tone'>) {
  return (
    <button
      type="button"
      {...props}
      {...stylex.props(styles.button, styles.iconButton)}
    />
  )
}

type BookingFieldProps = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  | 'autoComplete'
  | 'defaultValue'
  | 'disabled'
  | 'name'
  | 'min'
  | 'max'
  | 'step'
  | 'onChange'
  | 'required'
  | 'type'
  | 'value'
> & {
  readonly label: string
  readonly error?: string
}

export function BookingField({ label, error, ...input }: BookingFieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <label {...stylex.props(styles.field)}>
      <span {...stylex.props(styles.label)}>{label}</span>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        {...input}
        {...stylex.props(styles.input, Boolean(error) && styles.inputInvalid)}
      />
      {error ? (
        <p id={errorId} role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      ) : null}
    </label>
  )
}

export function BookingSelectableCard({
  children,
  selected,
  disabled,
  onClick
}: {
  readonly children: ReactNode
  readonly selected: boolean
  readonly disabled?: boolean
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      {...stylex.props(styles.button, styles.selectable, selected && styles.selected)}
    >
      {children}
    </button>
  )
}

export function BookingSkeleton({ label = 'Loading' }: { readonly label?: string }) {
  return <output aria-label={label} {...stylex.props(styles.skeleton)} />
}

export function BookingToast({ children }: { readonly children: ReactNode }) {
  return <output {...stylex.props(styles.toast)}>{children}</output>
}

export function BookingTooltip({ children }: { readonly children: ReactNode }) {
  return (
    <span role="tooltip" {...stylex.props(styles.tooltip)}>
      {children}
    </span>
  )
}

export function BookingProcessingOverlay({ label }: { readonly label: string }) {
  return (
    <output aria-live="polite" {...stylex.props(styles.processing)}>
      {label}
    </output>
  )
}

const focusableSelector =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function BookingOverlay({
  open,
  title,
  closeLabel = 'Close dialog',
  onClose,
  children
}: {
  readonly open: boolean
  readonly title: string
  readonly closeLabel?: string
  readonly onClose: () => void
  readonly children: ReactNode
}) {
  const titleId = useId()
  const closeOverlay = useEffectEvent(onClose)
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = document.querySelector<HTMLElement>(`[aria-labelledby="${titleId}"]`)
    const focusable = () =>
      dialog ? [...dialog.querySelectorAll<HTMLElement>(focusableSelector)] : []
    focusable()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeOverlay()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      const first = items[0]
      const last = items.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [open, titleId])
  if (!open) return null
  return (
    <div data-layer="popup-stack">
      <div aria-hidden="true" {...stylex.props(styles.backdrop)} />
      <dialog
        open
        aria-modal="true"
        aria-labelledby={titleId}
        data-layer="sheet"
        {...stylex.props(styles.sheet)}
      >
        <h2 id={titleId} {...stylex.props(styles.overlayHeading)}>
          {title}
        </h2>
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          {...stylex.props(styles.button, styles.iconButton, styles.close)}
        >
          ×
        </button>
        {children}
      </dialog>
    </div>
  )
}

type PresenceVariant = 'fade' | 'scale' | 'height' | 'calendar' | 'route'

const interactionTransition: Transition = { duration: 0.15, ease: 'easeInOut' }
const pageTransition: Transition = { duration: 0.3, ease: 'easeInOut' }

const presenceVariants: Record<PresenceVariant, Variants> = {
  fade: {
    hidden: { opacity: 0 },
    shown: { opacity: 1 },
    exit: { opacity: 0 }
  },
  scale: {
    hidden: { opacity: 0, scale: 0.8 },
    shown: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.8 }
  },
  height: {
    hidden: { height: 0, opacity: 0 },
    shown: { height: 'auto', opacity: 1 },
    exit: { height: 0, opacity: 0 }
  },
  calendar: {
    hidden: { opacity: 0, y: -50 },
    shown: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -50 }
  },
  route: {
    hidden: { opacity: 0 },
    shown: { opacity: 1 },
    exit: { opacity: 0 }
  }
}

function MotionContent({
  presenceKey,
  variant,
  children
}: {
  readonly presenceKey: string
  readonly variant: PresenceVariant
  readonly children: ReactNode
}) {
  const reduced = useReducedMotion()
  const transition =
    reduced || variant === 'fade' || variant === 'height'
      ? reduced
        ? { duration: 0 }
        : interactionTransition
      : pageTransition
  return (
    <LazyMotion features={domAnimation} strict>
      <m.div
        key={presenceKey}
        data-motion={reduced ? 'reduced' : 'full'}
        data-presence-variant={variant}
        variants={presenceVariants[variant]}
        initial="hidden"
        animate="shown"
        exit="exit"
        transition={transition}
        layout={variant === 'height' || variant === 'route'}
        {...(variant === 'height' ? { style: { overflow: 'hidden' as const } } : {})}
      >
        {children}
      </m.div>
    </LazyMotion>
  )
}

function Presence({
  visible,
  variant,
  children
}: {
  readonly visible: boolean
  readonly variant: Exclude<PresenceVariant, 'route'>
  readonly children: ReactNode
}) {
  return (
    <AnimatePresence>
      {visible ? (
        <MotionContent presenceKey={variant} variant={variant}>
          {children}
        </MotionContent>
      ) : null}
    </AnimatePresence>
  )
}

export function FadePresence(props: {
  readonly visible: boolean
  readonly children: ReactNode
}) {
  return <Presence {...props} variant="fade" />
}

export function ScalePresence(props: {
  readonly visible: boolean
  readonly children: ReactNode
}) {
  return <Presence {...props} variant="scale" />
}

export function HeightPresence(props: {
  readonly visible: boolean
  readonly children: ReactNode
}) {
  return <Presence {...props} variant="height" />
}

export function CalendarPresence(props: {
  readonly visible: boolean
  readonly children: ReactNode
}) {
  return <Presence {...props} variant="calendar" />
}

export function RoutePresence({
  presenceKey,
  initial = false,
  children
}: {
  readonly presenceKey: string
  readonly initial?: boolean
  readonly children: ReactNode
}) {
  return (
    <AnimatePresence initial={initial} mode="wait">
      <MotionContent key={presenceKey} presenceKey={presenceKey} variant="route">
        {children}
      </MotionContent>
    </AnimatePresence>
  )
}

export function BookingMerchantContent({
  text,
  language,
  fallbackIndicator
}: {
  readonly text: string
  readonly language: string
  readonly fallbackIndicator?: string
}) {
  return (
    <span {...stylex.props(styles.fallback)}>
      <span lang={language}>{text}</span>
      {fallbackIndicator ? (
        <span role="note" {...stylex.props(styles.fallbackIndicator)}>
          {fallbackIndicator}
        </span>
      ) : null}
    </span>
  )
}
