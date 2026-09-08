# Optional social sign-in providers

Social providers exist only when their complete configuration is present. The sign-in UI derives available choices from that resolver, preserving a usable local auth path with no external provider.

Account linking requires both the provider email and the existing local mailbox to be verified; an unverified local mailbox refuses linking. Account lifecycle hooks provide user/provider identity for link and unlink audits because redirect responses cannot reliably attribute them. Audit failure does not fail the auth exchange. The last-login-method cookie supplies a cosmetic hint; it grants no authority and needs no database column.
