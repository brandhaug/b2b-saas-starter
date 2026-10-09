/// <reference types="@cloudflare/vitest-plugin/types" />
declare namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS?: Array<import('cloudflare:test').D1Migration>
    }
}
