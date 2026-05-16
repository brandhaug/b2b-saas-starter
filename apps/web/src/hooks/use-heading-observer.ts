import { type RefObject, useEffect, useRef, useState } from 'react'

interface Heading {
  readonly id: string
  readonly text: string
  readonly level: number
}

export function useHeadingObserver({
  containerRef
}: {
  readonly containerRef: RefObject<HTMLElement | null>
}) {
  const [headings, setHeadings] = useState<Array<Heading>>([])
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set())
  const visibleIds = useRef(new Set<string>())
  const rafId = useRef(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const visible = visibleIds.current
    let intersectionObserver: IntersectionObserver | null = null

    function sync(target: HTMLElement) {
      intersectionObserver?.disconnect()
      cancelAnimationFrame(rafId.current)
      visible.clear()

      const elements = target.querySelectorAll<HTMLElement>('h2[id], h3[id]')
      const extracted = [...elements].map((el) => ({
        id: el.id,
        text: el.textContent ?? '',
        level: Number(el.tagName[1])
      }))
      setHeadings(extracted)
      setActiveIds(new Set())

      if (extracted.length === 0) return

      intersectionObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.add(entry.target.id)
          } else {
            visible.delete(entry.target.id)
          }
        }
        cancelAnimationFrame(rafId.current)
        rafId.current = requestAnimationFrame(() => {
          setActiveIds(new Set(visible))
        })
      })

      for (const el of elements) {
        intersectionObserver.observe(el)
      }
    }

    sync(container)

    let debounceId = 0
    const mutationObserver = new MutationObserver(() => {
      window.clearTimeout(debounceId)
      debounceId = window.setTimeout(() => sync(container), 50)
    })
    mutationObserver.observe(container, { childList: true, subtree: true })

    return () => {
      intersectionObserver?.disconnect()
      mutationObserver.disconnect()
      window.clearTimeout(debounceId)
      cancelAnimationFrame(rafId.current)
      visible.clear()
    }
  }, [containerRef])

  return { headings, activeIds }
}
