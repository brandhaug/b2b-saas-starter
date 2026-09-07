# No initial i18n

Superseded by [ADR 0074](./0074-account-locales-and-shared-message-catalogs.md).

The starter ships in English without a full internationalization framework in the initial scaffold. UI text and formatting should remain reasonable to refactor later, but locale routing, translated MDX content, and message catalogs are deferred because they would add build and content complexity without strengthening the starter's core SaaS foundation.
