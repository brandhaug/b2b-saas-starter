/**
 * A promise the test resolves by hand, so a test double can signal the moment
 * the code under test hands it a value instead of the test polling the double.
 */
export function deferred<T>() {
  let complete!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    complete = resolve
  })
  return { promise, resolve: complete }
}
