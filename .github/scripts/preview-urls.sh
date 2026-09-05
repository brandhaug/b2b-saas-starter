#!/usr/bin/env bash
# Resolves the account's workers.dev subdomain and exports the preview stage's
# three Worker URLs to later steps ($GITHUB_ENV). The names follow
# `stageResourceNames` in infra/bindings.ts: b2b-saas-starter-<stage>-<app>.
# alchemy.run.ts derives BETTER_AUTH_URL from the same subdomain, so the URL in
# the deployment status is the one the web Worker was deployed with.
set -euo pipefail

: "${ALCHEMY_STAGE:?set ALCHEMY_STAGE, e.g. pr-42}"
: "${CLOUDFLARE_API_TOKEN:?missing repository secret CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?missing repository secret CLOUDFLARE_ACCOUNT_ID}"

subdomain="$(
  curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" |
    jq -er '.result.subdomain'
)"

prefix="b2b-saas-starter-$ALCHEMY_STAGE"
{
  echo "CLOUDFLARE_WORKERS_SUBDOMAIN=$subdomain"
  echo "WEB_URL=https://$prefix-web.$subdomain.workers.dev"
  echo "API_URL=https://$prefix-api.$subdomain.workers.dev"
  echo "BACKGROUND_URL=https://$prefix-background.$subdomain.workers.dev"
} >> "${GITHUB_ENV:-/dev/stdout}"
