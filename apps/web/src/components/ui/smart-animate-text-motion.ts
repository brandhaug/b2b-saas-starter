type CharacterMotion = {
  delay: number
  damping: number
  enterBlur: number
  enterScale: number
  enterY: number
  sign: 1 | -1
  stiffness: number
}

type RemovedCharacterMotionOptions = {
  baseMotion: Omit<CharacterMotion, 'delay'>
  characters: string[]
  prefersReducedMotion: boolean
  previousCharacters: string[]
  staggerDelay: number
}

const animatedCharacterPattern = /^[a-zA-Z0-9]$/

function isAnimatedCharacter(character: string | undefined) {
  return character !== undefined && animatedCharacterPattern.test(character)
}

function createRemovedCharacterMotion({
  baseMotion,
  characters,
  prefersReducedMotion,
  previousCharacters,
  staggerDelay
}: RemovedCharacterMotionOptions) {
  const motion: Record<number, CharacterMotion> = {}
  let count = 0

  previousCharacters.forEach((character, index) => {
    if (!isAnimatedCharacter(character)) return

    const reverseIndex = previousCharacters.length - index - 1
    const currentCharacter = characters[characters.length - reverseIndex - 1]
    if (isAnimatedCharacter(currentCharacter)) return

    motion[reverseIndex] = {
      ...baseMotion,
      delay: prefersReducedMotion ? 0 : count * staggerDelay
    }
    count += 1
  })

  return { count, motion }
}

export {
  createRemovedCharacterMotion,
  isAnimatedCharacter,
  type CharacterMotion,
  type RemovedCharacterMotionOptions
}
