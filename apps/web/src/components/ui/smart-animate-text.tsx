'use client'

import { AnimatePresence, m, useReducedMotion, type Variants } from 'motion/react'
import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

type AnimationDirection = 'dynamic' | 'up' | 'down'

type SmartAnimateTextProps = {
  value: string
  gap?: number
  className?: string
  digitClassName?: string
  staggerDelay?: number
  enterStiffness?: number
  enterDamping?: number
  direction?: AnimationDirection
  enterY?: number
  enterBlur?: number
  enterScale?: number
  animateOnMount?: boolean
}

type CharacterMotion = {
  delay: number
  damping: number
  enterBlur: number
  enterScale: number
  enterY: number
  sign: 1 | -1
  stiffness: number
}

const animatedCharacterPattern = /^[a-zA-Z0-9]$/

const characterVariants = {
  enter: ({
    delay,
    damping,
    enterBlur,
    enterScale,
    enterY,
    sign,
    stiffness
  }: CharacterMotion) => ({
    opacity: 0,
    y: sign * enterY,
    scale: enterScale,
    filter: `blur(${enterBlur}px)`,
    transition: { type: 'spring', stiffness, damping, delay }
  }),
  center: ({ delay, damping, stiffness }: CharacterMotion) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: { type: 'spring', stiffness, damping, delay }
  }),
  exit: ({
    delay,
    damping,
    enterBlur,
    enterScale,
    enterY,
    sign,
    stiffness
  }: CharacterMotion) => ({
    opacity: 0,
    y: sign * -enterY,
    scale: enterScale,
    filter: `blur(${enterBlur}px)`,
    transition: { type: 'spring', stiffness, damping, delay }
  })
} satisfies Variants

function readNumericValue(value: string) {
  const match = value.replaceAll(',', '').match(/-?(?:\d+\.?\d*|\.\d+)/)
  if (!match) return undefined

  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : undefined
}

function resolveDirection(
  direction: AnimationDirection,
  previousValue: string,
  value: string
): 1 | -1 {
  if (direction === 'up') return 1
  if (direction === 'down') return -1

  const previousNumber = readNumericValue(previousValue)
  const nextNumber = readNumericValue(value)

  return previousNumber !== undefined &&
    nextNumber !== undefined &&
    nextNumber < previousNumber
    ? -1
    : 1
}

function staticCharacterKey(characters: string[], index: number) {
  const character = characters[index]
  let occurrenceFromEnd = 0

  for (let cursor = characters.length - 1; cursor >= index; cursor -= 1) {
    if (characters[cursor] === character) occurrenceFromEnd += 1
  }

  return `static:${character}:${occurrenceFromEnd}`
}

function SmartAnimateText({
  value,
  gap = 2,
  className,
  digitClassName,
  staggerDelay = 0.04,
  enterStiffness = 170,
  enterDamping = 10,
  direction = 'dynamic',
  enterY = 32,
  enterBlur = 52,
  enterScale = 0.7,
  animateOnMount = false
}: SmartAnimateTextProps) {
  const previousValueRef = useRef(value)
  const hasMountedRef = useRef(false)
  const prefersReducedMotion = useReducedMotion()
  const previousValue = previousValueRef.current
  const isInitialRender = !hasMountedRef.current
  const characters = Array.from(value)
  const previousCharacters = Array.from(previousValue)
  const sign = resolveDirection(direction, previousValue, value)
  let changedCharacterIndex = 0

  useEffect(() => {
    previousValueRef.current = value
    hasMountedRef.current = true
  }, [value])

  return (
    <span
      aria-label={value}
      className={cn('inline-flex items-baseline', className)}
      data-slot="smart-animate-text"
      style={{ gap }}
    >
      {characters.map((character, index) => {
        const reverseIndex = characters.length - index - 1

        if (!animatedCharacterPattern.test(character)) {
          return (
            <span
              aria-hidden="true"
              data-character-kind="static"
              key={staticCharacterKey(characters, index)}
            >
              {character}
            </span>
          )
        }

        const previousCharacter =
          previousCharacters[previousCharacters.length - reverseIndex - 1]
        const changed = isInitialRender
          ? animateOnMount
          : previousCharacter !== character
        const delay =
          changed && !prefersReducedMotion ? changedCharacterIndex * staggerDelay : 0
        if (changed) changedCharacterIndex += 1

        const motion: CharacterMotion = {
          delay,
          damping: enterDamping,
          enterBlur: prefersReducedMotion ? 0 : enterBlur,
          enterScale: prefersReducedMotion ? 1 : enterScale,
          enterY: prefersReducedMotion ? 0 : enterY,
          sign,
          stiffness: enterStiffness
        }

        return (
          <span
            aria-hidden="true"
            className={cn('inline-grid overflow-hidden align-baseline', digitClassName)}
            data-character-kind="animated"
            key={`animated:${reverseIndex}`}
          >
            <AnimatePresence
              custom={motion}
              initial={isInitialRender ? animateOnMount && !prefersReducedMotion : true}
            >
              <m.span
                animate="center"
                custom={motion}
                exit="exit"
                initial="enter"
                key={character}
                style={{ gridColumn: 1, gridRow: 1 }}
                variants={characterVariants}
              >
                {character}
              </m.span>
            </AnimatePresence>
          </span>
        )
      })}
    </span>
  )
}

export { SmartAnimateText, type AnimationDirection, type SmartAnimateTextProps }
