# Sensitive surface rate limiting

The starter includes simple rate limiting for sensitive surfaces, implemented with Cloudflare Workers Rate Limiting bindings: the API worker carries buckets for REST reads, REST writes, invitations, assistant calls, and MCP access, and the web worker carries auth read/write buckets for Better Auth routes. This is a security baseline rather than a full product quota system; stronger Cloudflare controls such as Turnstile or WAF rules can be layered on later.
