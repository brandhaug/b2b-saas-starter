export function deferred<T>() {
  let complete!: (value: T) => void
  // oxlint-disable-next-line effect/noNewPromise -- controlled browser request completion for behavioral tests
  const promise = new Promise<T>((resolve) => {
    complete = resolve
  })
  return { promise, resolve: complete }
}
