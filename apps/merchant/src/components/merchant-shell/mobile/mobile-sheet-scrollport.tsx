import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEventHandler
} from 'react'

type MobileSheetScrollState = {
  readonly atBottom: boolean
  readonly atTop: boolean
  readonly overflowing: boolean
}

const initialScrollState: MobileSheetScrollState = {
  atBottom: true,
  atTop: true,
  overflowing: false
}

export function MobileSheetScrollport({
  children,
  className = '',
  contentSized = false,
  onScroll
}: {
  readonly children: ReactNode
  readonly className?: string | undefined
  readonly contentSized?: boolean | undefined
  readonly onScroll?: UIEventHandler<HTMLDivElement> | undefined
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState(initialScrollState)

  const updateScrollState = useCallback(() => {
    const scrollport = scrollRef.current
    if (!scrollport) return
    const remaining =
      scrollport.scrollHeight - scrollport.clientHeight - scrollport.scrollTop
    const next = {
      atBottom: remaining <= 1,
      atTop: scrollport.scrollTop <= 1,
      overflowing: scrollport.scrollHeight > scrollport.clientHeight + 1
    }
    setState((current) =>
      current.atBottom === next.atBottom &&
      current.atTop === next.atTop &&
      current.overflowing === next.overflowing
        ? current
        : next
    )
  }, [])

  useLayoutEffect(() => {
    const scrollport = scrollRef.current
    if (!scrollport) return
    updateScrollState()
    scrollport.addEventListener('scroll', updateScrollState, { passive: true })

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(updateScrollState)
    resizeObserver?.observe(scrollport)
    if (scrollport.firstElementChild) {
      resizeObserver?.observe(scrollport.firstElementChild)
    }

    const mutationObserver =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(updateScrollState)
    mutationObserver?.observe(scrollport, { childList: true, subtree: true })

    return () => {
      scrollport.removeEventListener('scroll', updateScrollState)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    }
  }, [updateScrollState])

  const showTopFade = state.overflowing && !state.atTop
  const showBottomFade = state.overflowing && !state.atBottom
  const frameClassName = contentSized
    ? 'relative min-h-0 flex-[0_1_auto] overflow-hidden'
    : 'relative min-h-0 flex-1 overflow-hidden'
  const scrollClassName = contentSized
    ? 'merchant-sheet-scrollport relative max-h-full overflow-x-hidden overflow-y-auto overscroll-contain'
    : 'merchant-sheet-scrollport absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-contain'

  return (
    <div className={frameClassName}>
      <div
        aria-hidden
        data-mobile-sheet-scroll-fade="top"
        className={`pointer-events-none absolute inset-x-0 top-0 z-20 h-8 transition-opacity duration-150 ${showTopFade ? 'opacity-100' : 'opacity-0'}`}
        style={{
          background: 'linear-gradient(to bottom, var(--background), transparent)'
        }}
      />
      <div
        aria-hidden
        data-mobile-sheet-scroll-fade="bottom"
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 h-8 transition-opacity duration-150 ${showBottomFade ? 'opacity-100' : 'opacity-0'}`}
        style={{
          background: 'linear-gradient(to top, var(--background), transparent)'
        }}
      />
      <div
        ref={scrollRef}
        data-mobile-sheet-scroll="true"
        data-mobile-sheet-scroll-at-top={state.atTop ? 'true' : 'false'}
        data-mobile-sheet-scroll-at-bottom={state.atBottom ? 'true' : 'false'}
        data-mobile-sheet-scroll-sizing={contentSized ? 'content' : 'fill'}
        className={`${scrollClassName} ${className}`}
        onScroll={onScroll}
      >
        <div className={contentSized ? undefined : 'h-full'}>{children}</div>
      </div>
    </div>
  )
}
