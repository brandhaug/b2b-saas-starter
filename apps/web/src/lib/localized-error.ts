/** Trusted copy created in this browser. Never construct this from a server message. */
export class LocalizedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalizedError'
  }
}
