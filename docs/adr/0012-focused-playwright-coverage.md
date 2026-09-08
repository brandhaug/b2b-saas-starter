# Focused Playwright coverage

Playwright covers user journeys that cross rendering, navigation, authentication, and persistence boundaries. Authenticated tests use migrated, seeded local D1; provider behavior belongs in narrower tests unless the environment supplies the provider. This keeps browser failures attributable to application integration rather than third-party availability.
