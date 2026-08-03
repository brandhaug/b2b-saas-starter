import { useCallback, useRef, useState, type UIEventHandler } from 'react'

export function useMobileCollapsingSheetTitle<
  LargeTitleElement extends HTMLElement = HTMLElement
>() {
  const largeTitleRef = useRef<LargeTitleElement>(null)
  const [collapsed, setCollapsed] = useState(false)

  const handleScroll = useCallback<UIEventHandler<HTMLElement>>((event) => {
    const largeTitle = largeTitleRef.current
    if (!largeTitle) return

    const largeTitleEnd = largeTitle.offsetTop + largeTitle.offsetHeight
    if (largeTitleEnd <= 0) return

    setCollapsed((current) => {
      const next = event.currentTarget.scrollTop >= largeTitleEnd
      return current === next ? current : next
    })
  }, [])

  return { collapsed, handleScroll, largeTitleRef }
}
