# Terms of Use — "Tahqiq" (Investigation)

**Date:** 2026-10-24 — **Task:** P6-015 — **Signature:** Engineering lead under owner mandate. Subject to independent legal review (P7-008).

## Permitted use

The tool is intended for lawful investigations: security, defensive, criminal within your legal authority, or professional verification with a legitimate interest. It must not be used to stalk people without legal basis, to impersonate identities, or to circumvent source systems (CAPTCHA/rate limits) — the egress gateway enforces rate limits and fetch ethics centrally (ADR-08).

## Your responsibility

- The license is AGPL-3.0-or-later (ADR-10) — the code is open source and any redistribution is bound by its terms.
- **You** are responsible for the legality of your investigation and for your processing of personal data under your own laws (PDPL/GDPR) — the tool provides the documented purpose, the natural-person gate and the audit trail to help you, not to substitute for you legally.
- The OSINT provider keys you place in the vault are **your secrets** — they stay on your machine and travel only to their pinned host's header (D-031/P2-016).

## External sources

Fetching from public sources is governed by those sources' own terms — the documented limits per source live in docs/security/licenses.md (external sources table). The tool is not liable for sources changing their terms or becoming unavailable.

## No warranty

The tool is provided "as is" without warranty of any kind, within the limits declared in docs/DECLARED_LIMITS.md (no built-in OCSP, no antivirus, no immediate memory scrubbing, and more). Its security is documented by a tested threat model (docs/security/threat-model.md), not by promises.

## Legal review

These terms are signed engineering-wise; independent legal approval is P7-008 — no final version counts until after it.
