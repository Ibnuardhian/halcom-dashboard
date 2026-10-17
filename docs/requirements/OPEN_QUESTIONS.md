# Open Questions

The business decisions in [PROJECT_BRIEF_TICKETING_PROJECT_TRACKER.md §17](../../PROJECT_BRIEF_TICKETING_PROJECT_TRACKER.md)
remain open and are not repeated here: SOA/Purchasing completion, SLA targets and calendars,
visibility rules, Finance fields, email mode and distribution lists, export permissions, and so on.
This file tracks the additional technical questions raised while setting up the foundation.
Record each answer in [DECISIONS.md](../decisions/DECISIONS.md) and remove it here.

| ID | Question | Why it matters / what it blocks | Owner | Status |
|---|---|---|---|---|
| T-1 | Which authentication approach is approved? Options include Microsoft Entra ID SSO (fits the Microsoft 365 / Outlook usage), Auth.js v5 (still beta as of 2026-10-17), Better Auth, or an existing internal identity provider. | Users, roles and session schema; server-side authorization; blocks Phase 1 (brief §15). | TBD | Open |
| T-2 | What is the production deployment target? Self-hosted Docker host (VPS) or managed services; managed PostgreSQL or the bundled container; image registry; domain and TLS reverse proxy. | Final shape of `compose.prod.yaml`, secrets handling, CI/CD. | TBD | Open |
| T-3 | What is the backup policy? Frequency, retention, off-site copy, restore drills, and who owns them. | Required before production data exists (AGENTS.md §4). | TBD | Open |
| T-4 | Where are attachments stored? Private object storage (S3-compatible) or a controlled private file store. | Adds a storage service to Compose; affects the attachment and BOQ-file design (brief §13). | TBD | Open |
| T-5 | Which CI platform runs the Docker-based quality gates (lint, type check, unit, integration, E2E, build)? | Automated enforcement of the testing rules in AGENTS.md §6. | TBD | Open |
| T-6 | When should the project move to Node.js 26 LTS (LTS from late October 2026)? Node 24 is supported until April 2028. | Runtime image pin (D-002). | TBD | Open |
