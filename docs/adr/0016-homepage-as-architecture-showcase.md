# Homepage as architecture showcase

The public homepage helps builders inspect the repository and its working capabilities. Its examples and calls to action should demonstrate the starter rather than invent a SaaS business around the reference application.

`/demo` offers a browsable preview of the Reference Application with synthetic
data and shared page components. Visitors can inspect workspace sections, forms,
and dialogs without an account. Actions explain that the preview does not execute
them; authenticated routes retain their normal permission and verification gates.

The preview has no simulated business state or persistence. This makes the
interface available for evaluation without maintaining a second implementation
of invitations, billing, tokens, or other capability behavior. Preview data must
remain independent of live privileged records, even when the visitor has an
authenticated session.
