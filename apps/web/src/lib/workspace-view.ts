/** Shareable presentation state; never an authorization or mutation input. */
export type WorkspaceView = {
  readonly tab?: string | undefined
  readonly action?: string | undefined
  readonly query?: string | undefined
  readonly filter?: string | undefined
  readonly sort?: string | undefined
  readonly page?: string | undefined
  readonly record?: string | undefined
  readonly invitationQuery?: string | undefined
  readonly tableViews?: string | undefined
  readonly view?: string | undefined
  readonly failureView?: string | undefined
  readonly failureCursor?: string | undefined
}
