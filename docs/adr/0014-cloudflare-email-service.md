# Cloudflare Email Service

The starter uses Cloudflare Email Service for outbound transactional email instead of Resend, matching the Cloudflare-first architecture. React Email remains the template and preview layer, while production sending goes through Cloudflare Workers email bindings or the Email Service REST API, with local development able to render or log emails when Cloudflare email configuration is absent. Inbound email handling is intentionally out of scope and should not be included in product docs.
