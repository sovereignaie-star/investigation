# Privacy Policy — "Tahqiq" (Investigation)

**Date:** 2026-10-24 — **Task:** P6-015 — **Signature:** Engineering lead under owner mandate. This policy undergoes independent legal review in P7-008 before general release (gate G-47).

## What we process

"Tahqiq" is an OSINT investigation tool that runs **on your machine**. It processes the investigation data you create: case titles and purposes, evidence you fetch from public sources (which may contain natural-person data), extracted entities (names, organizations, relationships), notes and reports, and a tamper-evident audit trail of every sensitive action. There are no user accounts, no passwords, no telemetry, and no external analytics (ADR-23).

## Where your data stays

On your machine only, by default: every case is a locally encrypted directory (AES-256-GCM with an Argon2id-derived key) on your disk. The AI layer runs on a local provider (Ollama) with no external network; a cloud provider — if you ever enable one — is explicitly refused without a documented per-case consent. Full case deletion is available to you (secure deletion with no cross-case contamination — P6-008).

## Who can reach your data

- **You alone** in the local mode: the session is a local cookie with a random key that vanishes on restart.
- **Public OSINT source providers:** when you fetch from an OSINT source (urlscan, AbuseIPDB and others) the provider sees your public query by the nature of the service — declared as a residual risk in the privacy impact assessment (docs/security/dpia.md — DP-002).
- **No other third party:** no cloud, no tracking, no data sharing with anyone.

## Your rights

As the operator you are in control: you open the case, choose its sources, and delete it at will (secure deletion). If natural persons' data appears in your investigation, its processing is subject to your own laws (PDPL/GDPR) — the engine's natural-person gate refuses processing it without a documented purpose (P2-013), and the audit trail proves every access. For the data subjects themselves: the contact channel is below.

## Contact

Reports and inquiries via the public project repository: https://github.com/sovereignaie-star/investigation (Issues for public matters, Security Advisories for private ones). The abuse-report channel is detailed in docs/legal/abuse-report.en.md.

> **Review notice:** this policy is signed engineering-wise and is subject to independent legal review (P7-008) before final approval.
