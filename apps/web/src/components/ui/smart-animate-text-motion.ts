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

function isAnimatedCharacter(character: string | undefined) {
  return character !== undefined && animatedCharacterPattern.test(character)
}

export { isAnimatedCharacter, type CharacterMotion }
