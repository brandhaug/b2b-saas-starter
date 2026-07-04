# Focused Playwright coverage

The starter includes Playwright with a focused smoke suite: homepage rendering, docs rendering, the unauthenticated redirect to sign-in, and a seeded demo sign-in through to the workspace dashboard. The sign-in path requires the persisted local D1 (see [persisted local D1](./0049-persisted-local-d1-in-dev-and-e2e.md)) and skips with an explanatory message when migrated local state is missing. Provider-heavy flows such as billing, OAuth, and external integrations should use mocks or narrower tests until real environment configuration is available.
