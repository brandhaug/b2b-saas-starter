# Sensitive surface rate limiting

The starter includes simple rate limiting for sensitive surfaces such as auth-adjacent routes, REST and MCP API token access, billing webhooks where applicable, and AI assistant calls. This is a security baseline rather than a full product quota system; stronger Cloudflare controls such as Turnstile or WAF rules can be layered on later.
