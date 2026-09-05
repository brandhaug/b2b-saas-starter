import { type RefObject, useEffect, useRef, useState } from 'react'

/** What `useOverflowFade` hands a horizontally scrollable pane. */
type OverflowFade<T extends HTMLElement> = {
  /** Pass to the element whose right-edge overflow the mask tracks. */
  readonly ref: RefObject<T | null>
  /** True only while content hides past the right edge of the pane. */
  readonly fadeRight: boolean
}

/**
 * A right-edge fade for horizontally scrollable panes: the mask is on only
 * while content hides past the right edge, so a pane that fits (or one
 * panned to its end) shows its last character instead of a permanent fade.
 * The overflow reads as scrollable before the reader finds it by touch.
 *
 * Measured on mount, on scroll, and through a ResizeObserver on the element
 * itself — the content is static, so the element's own resize covers every
 * viewport change that can move the overflow.
 */
export function useOverflowFade<T extends HTMLElement>(): OverflowFade<T> {
  const ref = useRef<T | null>(null)
  const [fadeRight, setFadeRight] = useState(false)

  useEffect(() => {
    // Re-reads `ref.current` rather than closing over the narrowed const:
    // a hoisted `function` (this repo's `func-style`) does not carry the
    // effect body's null check, and the observer may fire after remounts.
    function measure() {
      const pane = ref.current
      if (pane === null) {
        return
      }
      setFadeRight(
        pane.scrollWidth - pane.clientWidth > 1 &&
          pane.scrollLeft + pane.clientWidth < pane.scrollWidth - 1
      )
    }

    measure()
    const el = ref.current
    if (el === null) {
      return
    }
    el.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [])

  return { ref, fadeRight }
}
