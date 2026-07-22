'use client'

import {
  AnimatePresence,
  m,
  usePresenceData,
  useReducedMotion,
  type Variants
} from 'motion/react'
import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'
import {
  createRemovedCharacterMotion,
  isAnimatedCharacter,
  type CharacterMotion
} from './smart-animate-text-motion'

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

const removedCharacterVariants = {
  exit: characterVariants.exit
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

function AnimatedCharacter({
  character,
  digitClassName,
  initial,
  motion,
  reverseIndex
}: {
  character: string
  digitClassName: string | undefined
  initial: boolean
  motion: CharacterMotion
  reverseIndex: number
}) {
  const removedCharacterMotion = usePresenceData() as
    | Record<number, CharacterMotion>
    | undefined

  return (
    <m.span
      aria-hidden="true"
      className={cn('inline-grid overflow-hidden align-baseline', digitClassName)}
      custom={removedCharacterMotion?.[reverseIndex] ?? motion}
      data-character-kind="animated"
      exit="exit"
      variants={removedCharacterVariants}
    >
      <AnimatePresence custom={motion} initial={initial}>
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
    </m.span>
  )
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
  const baseMotion = {
    damping: enterDamping,
    enterBlur: prefersReducedMotion ? 0 : enterBlur,
    enterScale: prefersReducedMotion ? 1 : enterScale,
    enterY: prefersReducedMotion ? 0 : enterY,
    sign,
    stiffness: enterStiffness
  }
  const { count: removedCharacterCount, motion: removedCharacterMotion } =
    createRemovedCharacterMotion({
      baseMotion,
      characters,
      prefersReducedMotion: prefersReducedMotion === true,
      previousCharacters,
      staggerDelay
    })

  let changedCharacterIndex = removedCharacterCount

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
      <AnimatePresence custom={removedCharacterMotion} initial={false}>
        {characters.map((character, index) => {
          const reverseIndex = characters.length - index - 1

          if (!isAnimatedCharacter(character)) {
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

          const motion: CharacterMotion = { ...baseMotion, delay }

          return (
            <AnimatedCharacter
              character={character}
              digitClassName={digitClassName}
              initial={isInitialRender ? animateOnMount && !prefersReducedMotion : true}
              key={`animated:${reverseIndex}`}
              motion={motion}
              reverseIndex={reverseIndex}
            />
          )
        })}
      </AnimatePresence>
    </span>
  )
}

export { SmartAnimateText, type AnimationDirection, type SmartAnimateTextProps }
