import type { Variants } from 'motion/react'

export const calendarSlideVariants = {
  enter: (direction: -1 | 1) => ({ x: `${direction * 120}%` }),
  center: { x: 0 },
  exit: (direction: -1 | 1) => ({ x: `${direction * -120}%` })
} satisfies Variants
