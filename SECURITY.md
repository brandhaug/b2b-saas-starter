# Security Policy

## Reporting a Vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private vulnerability reporting:
<https://github.com/brandhaug/b2b-saas-starter/security/advisories/new>

Or email **martin@brandhaug.net** with `[SECURITY]` in the subject.

Include:

- A description of the issue and the impact you observed
- Steps to reproduce, or a proof of concept
- The affected commit SHA or release
- Your name / handle if you'd like to be credited

You should receive an acknowledgement within **5 business days**. We aim to ship a fix or mitigation within **30 days** for confirmed issues.

## Supported Versions

This is a starter template. Security fixes are applied to the default branch (`master`) only. Forks and downstream projects are expected to track upstream.

## Scope

In scope:

- Code in this repository (apps, packages, infra, CI)
- Default configurations that would put adopters at risk if copied verbatim

Out of scope:

- Vulnerabilities in upstream dependencies (report those to the upstream project)
- Vulnerabilities in Cloudflare, GitHub, or other third-party platforms
- Issues that require an attacker to already have administrative access to a deployment
