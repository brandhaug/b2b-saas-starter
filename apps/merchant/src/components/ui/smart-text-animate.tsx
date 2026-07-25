'use client'

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { m, useSpring, useTransform } from 'motion/react'

import { cn } from '@/lib/utils'

const DEFAULT_STAGGER_DELAY = 0.04

interface SmartAnimateTextProps {
  value: string
  gap?: number
  className?: string
  digitClassName?: string
  staggerDelay?: number
  enterStiffness?: number
  enterDamping?: number
  direction?: 'dynamic' | 'up' | 'down'
  enterY?: number
  enterBlur?: number
  enterScale?: number
}

interface CharacterItem {
  key: string
  char: string
  isAnimatable: boolean
  kind: 'digit' | 'letter' | 'symbol'
}

function getCharacterItems(
  value: string,
  previousItems: readonly CharacterItem[] = [],
  version = ''
): CharacterItem[] {
  let digitPlace = 0

  const items: CharacterItem[] = value
    .split('')
    .map((char, index) => ({
      char,
      index,
      isDigit: /\d/.test(char),
      isLetter: /\p{L}/u.test(char)
    }))
    .reverse()
    .map(({ char, index, isDigit, isLetter }): CharacterItem => {
      if (isDigit) {
        const key = `digit-${digitPlace}`
        digitPlace += 1

        return {
          key,
          char,
          isAnimatable: true,
          kind: 'digit'
        }
      }

      if (isLetter) {
        return {
          key: `letter-${version}-${index}`,
          char,
          isAnimatable: true,
          kind: 'letter'
        }
      }

      return {
        key: `symbol-${char}-${index}`,
        char,
        isAnimatable: false,
        kind: 'symbol'
      }
    })
    .reverse()

  let prefixLength = 0
  while (
    prefixLength < items.length &&
    prefixLength < previousItems.length &&
    items[prefixLength]?.char === previousItems[prefixLength]?.char
  ) {
    prefixLength += 1
  }

  let suffixLength = 0
  while (
    suffixLength < items.length - prefixLength &&
    suffixLength < previousItems.length - prefixLength &&
    items[items.length - suffixLength - 1]?.char ===
      previousItems[previousItems.length - suffixLength - 1]?.char
  ) {
    suffixLength += 1
  }

  for (let index = 0; index < prefixLength; index += 1) {
    const item = items[index]
    const previousItem = previousItems[index]
    if (item?.kind === 'letter' && previousItem?.kind === 'letter') {
      item.key = previousItem.key
    }
  }

  for (let offset = 1; offset <= suffixLength; offset += 1) {
    const item = items[items.length - offset]
    const previousItem = previousItems[previousItems.length - offset]
    if (item?.kind === 'letter' && previousItem?.kind === 'letter') {
      item.key = previousItem.key
    }
  }

  return items
}

function DigitCell({
  char,
  isAnimatable,
  animateOnMount,
  enterDirection,
  animationDelay,
  className,
  enterStiffness = 170,
  enterDamping = 10,
  enterY = 32,
  enterBlur = 52,
  enterScale = 0.7
}: {
  char: string
  isAnimatable: boolean
  animateOnMount: boolean
  enterDirection: 'up' | 'down'
  animationDelay: number
  className?: string | undefined
  enterStiffness?: number | undefined
  enterDamping?: number | undefined
  enterY?: number | undefined
  enterBlur?: number | undefined
  enterScale?: number | undefined
}) {
  const prevCharRef = useRef(char)
  const isFirstRender = useRef(true)

  const springConfig = { stiffness: enterStiffness, damping: enterDamping }
  const y = useSpring(0, springConfig)
  const opacity = useSpring(1, springConfig)
  const scale = useSpring(1, springConfig)
  const blur = useSpring(0, springConfig)
  const filter = useTransform(blur, (v) => `blur(${Math.max(0, v)}px)`)

  useLayoutEffect(() => {
    if (!isAnimatable) return

    const prev = prevCharRef.current
    prevCharRef.current = char

    const animateIn = () => {
      y.set(0)
      opacity.set(1)
      scale.set(1)
      blur.set(0)
    }
    let timeout: ReturnType<typeof setTimeout> | undefined

    if (isFirstRender.current) {
      isFirstRender.current = false
      if (animateOnMount) {
        y.jump(enterDirection === 'up' ? enterY : -enterY)
        opacity.jump(0)
        scale.jump(enterScale)
        blur.jump(enterBlur)

        if (animationDelay <= 0) animateIn()
        else timeout = setTimeout(animateIn, animationDelay * 1000)
      }
    } else if (char === prev) {
      animateIn()
    } else {
      y.jump(enterDirection === 'up' ? enterY : -enterY)
      opacity.jump(0)
      scale.jump(enterScale)
      blur.jump(enterBlur)

      if (animationDelay <= 0) animateIn()
      else timeout = setTimeout(animateIn, animationDelay * 1000)
    }
    return () => {
      if (timeout) clearTimeout(timeout)
    }
  }, [
    char,
    isAnimatable,
    animationDelay,
    enterY,
    enterBlur,
    enterScale,
    y,
    opacity,
    scale,
    blur,
    animateOnMount,
    enterDirection
  ])

  if (!isAnimatable) {
    return (
      <m.span
        layout
        className={className}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      >
        {char}
      </m.span>
    )
  }

  return (
    <m.div
      layout
      className={cn(
        'relative grid place-items-center [&>*]:col-start-1 [&>*]:row-start-1',
        className
      )}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
    >
      <m.span style={{ opacity, scale, filter, y }}>{char}</m.span>
    </m.div>
  )
}

function SmartAnimateText({
  value,
  gap = 2,
  className,
  digitClassName,
  staggerDelay = DEFAULT_STAGGER_DELAY,
  enterStiffness,
  enterDamping,
  direction,
  enterY,
  enterBlur,
  enterScale
}: SmartAnimateTextProps) {
  const hasMounted = useRef(false)
  const previousValue = useRef(value)
  const previousCharacters = useRef<readonly CharacterItem[]>([])
  const characters = useMemo(() => {
    return getCharacterItems(value, previousCharacters.current, value)
  }, [value])
  const { animatedCharacterIndexes, dynamicDirection } = useMemo(() => {
    const previousCharacterMap = new Map(
      previousCharacters.current.map((character) => [character.key, character])
    )
    const indexes = new Map<string, number>()
    let animatedCharacterCount = 0

    for (const character of characters) {
      const previousCharacter = previousCharacterMap.get(character.key)
      const shouldAnimate =
        hasMounted.current &&
        character.isAnimatable &&
        previousCharacter?.char !== character.char

      if (!shouldAnimate) continue

      indexes.set(character.key, animatedCharacterCount)
      animatedCharacterCount += 1
    }

    const numericValue = Number(value)
    const previousNumericValue = Number(previousValue.current)
    const resolvedDirection: 'up' | 'down' =
      Number.isFinite(numericValue) && Number.isFinite(previousNumericValue)
        ? numericValue < previousNumericValue
          ? 'down'
          : 'up'
        : 'up'

    return {
      animatedCharacterIndexes: indexes,
      dynamicDirection: resolvedDirection
    }
  }, [characters, value])
  const enterDirection =
    direction === 'up' || direction === 'down' ? direction : dynamicDirection

  useEffect(() => {
    hasMounted.current = true
    previousValue.current = value
    previousCharacters.current = characters
  }, [characters, value])

  return (
    <m.div
      layout
      className={cn('flex items-center tabular-nums', className)}
      style={{ gap }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
    >
      {characters.map(({ key, char, isAnimatable }) => (
        <DigitCell
          key={key}
          char={char}
          isAnimatable={isAnimatable}
          animateOnMount={hasMounted.current}
          enterDirection={enterDirection}
          animationDelay={(animatedCharacterIndexes.get(key) ?? 0) * staggerDelay}
          className={digitClassName}
          enterStiffness={enterStiffness}
          enterDamping={enterDamping}
          enterY={enterY}
          enterBlur={enterBlur}
          enterScale={enterScale}
        />
      ))}
    </m.div>
  )
}

export { SmartAnimateText, type SmartAnimateTextProps }
