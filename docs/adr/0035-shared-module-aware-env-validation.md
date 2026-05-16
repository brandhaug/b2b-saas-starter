# Shared module-aware env validation

The starter includes a shared environment validation package that understands baseline Cloudflare configuration and optional provider module configuration. It should expose redacted configuration status so starter module readiness can explain missing setup without leaking secrets in UI, logs, reports, or errors.
