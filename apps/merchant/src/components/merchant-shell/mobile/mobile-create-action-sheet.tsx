import { useLayoutEffect, useRef, useState } from 'react'
import {
  animateMobileSheetSpring,
  scheduleAfterNextPaint
} from './mobile-sheet-motion.ts'
import { useMobileSurfaceChrome } from './use-mobile-surface-chrome.ts'
import './mobile-create-action-sheet.css'

export type MobileCreateIntent = 'appointment' | 'block-time'

type CreateActionSheetState = 'entering' | 'open' | 'closing'

export function MobileCreateActionSheet({
  open,
  onRequestClose,
  onSelect
}: {
  readonly open: boolean
  readonly onRequestClose: () => void
  readonly onSelect: (intent: MobileCreateIntent) => void
}) {
  if (!open) return null
  return (
    <MobileCreateActionSheetDialog
      onRequestClose={onRequestClose}
      onSelect={onSelect}
    />
  )
}

function MobileCreateActionSheetDialog({
  onRequestClose,
  onSelect
}: {
  readonly onRequestClose: () => void
  readonly onSelect: (intent: MobileCreateIntent) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const initialFocusRef = useRef<HTMLButtonElement>(null)
  const animationRef = useRef<(() => void) | null>(null)
  const afterCloseRef = useRef<(() => void) | null>(null)
  const closeFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finishedRef = useRef(false)
  const [state, setState] = useState<CreateActionSheetState>('entering')
  useMobileSurfaceChrome(state !== 'closing')

  const sheetDistance = () => {
    const panelHeight = panelRef.current?.getBoundingClientRect().height ?? 0
    return Math.min(window.innerHeight, Math.max(240, panelHeight + 32))
  }

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    const panel = panelRef.current
    if (!dialog || !panel) return
    const distance = sheetDistance()
    panel.style.setProperty('--merchant-create-sheet-y', `${distance}px`)
    initialFocusRef.current?.focus({ preventScroll: true })
    animationRef.current = animateMobileSheetSpring({
      from: distance,
      max: window.innerHeight,
      to: 0,
      onUpdate: (position) =>
        panel.style.setProperty('--merchant-create-sheet-y', `${position}px`),
      onComplete: () => {
        animationRef.current = null
        setState('open')
      }
    })
    return () => {
      animationRef.current?.()
      if (closeFallbackRef.current !== null) {
        clearTimeout(closeFallbackRef.current)
      }
    }
  }, [])

  const finishClose = () => {
    if (finishedRef.current) return
    finishedRef.current = true
    if (closeFallbackRef.current !== null) {
      clearTimeout(closeFallbackRef.current)
      closeFallbackRef.current = null
    }
    const dialog = dialogRef.current
    if (dialog?.open) dialog.close()
    const afterClose = afterCloseRef.current
    afterCloseRef.current = null
    onRequestClose()
    afterClose?.()
  }

  const requestClose = () => {
    if (state === 'closing') return
    const dialog = dialogRef.current
    const panel = panelRef.current
    if (!dialog || !panel) return
    dialog.dataset.mobileCreateActionSheetState = 'closing'
    setState('closing')
    animationRef.current?.()
    closeFallbackRef.current = setTimeout(finishClose, 500)
    animationRef.current = scheduleAfterNextPaint(() => {
      animationRef.current = null
      const distance = sheetDistance()
      const currentOffset = Number.parseFloat(
        panel.style.getPropertyValue('--merchant-create-sheet-y')
      )
      animationRef.current = animateMobileSheetSpring({
        from: Number.isFinite(currentOffset) ? currentOffset : 0,
        max: window.innerHeight,
        to: distance,
        onUpdate: (position) =>
          panel.style.setProperty('--merchant-create-sheet-y', `${position}px`),
        onComplete: finishClose
      })
    })
  }

  const choose = (intent: MobileCreateIntent) => {
    afterCloseRef.current = () => onSelect(intent)
    requestClose()
  }

  return (
    <dialog
      open
      ref={dialogRef}
      aria-label="Add to schedule"
      aria-modal="true"
      data-mobile-create-action-sheet="true"
      data-mobile-create-action-sheet-state={state}
      className="merchant-create-action-dialog m-0 max-h-none max-w-none border-0 bg-transparent p-0 text-foreground"
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
    >
      <button
        type="button"
        aria-label="Close add menu"
        className="merchant-create-action-backdrop fixed inset-0 border-0"
        onClick={requestClose}
      />
      <div
        ref={panelRef}
        className="merchant-create-action-panel grid gap-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <section
          aria-label="Create"
          className="overflow-hidden rounded-[1.4rem] border border-border/60 bg-background shadow-2xl"
        >
          <button
            ref={initialFocusRef}
            type="button"
            className="flex h-16 w-full items-center justify-center text-[1.0625rem] font-semibold text-info transition-colors active:bg-muted"
            onClick={() => choose('appointment')}
          >
            Appointment
          </button>
          <button
            type="button"
            className="flex h-16 w-full items-center justify-center border-t border-black/10 text-[1.0625rem] font-semibold text-info transition-colors active:bg-muted dark:border-white/10"
            onClick={() => choose('block-time')}
          >
            Block time
          </button>
        </section>

        <button
          type="button"
          className="flex h-16 w-full items-center justify-center rounded-[1.4rem] border border-border/60 bg-background text-[1.0625rem] font-bold text-info shadow-2xl transition-colors active:bg-muted"
          onClick={requestClose}
        >
          Cancel
        </button>
      </div>
    </dialog>
  )
}
