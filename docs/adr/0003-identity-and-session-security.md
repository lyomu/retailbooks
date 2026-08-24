# ADR 0003: Identity and session security

- Status: Accepted
- Date: 2026-08-16

## Context

Phase 1 requires secure email/password identity, verified email, recovery, visible sessions, and a clean path to later OAuth/SSO and MFA. The system must remain portable across self-hosted and managed PostgreSQL/Redis infrastructure.

## Decision

- Prisma is the persistence boundary for identity data, backed by PostgreSQL migrations.
- Email addresses use PostgreSQL `CITEXT` uniqueness and are normalized at the API boundary.
- Password authentication is stored separately from users in `auth_methods`, allowing future providers without changing the user identity model.
- Passwords use Argon2id with explicit memory, time, and parallelism settings.
- Browser sessions use random opaque tokens in an `HttpOnly`, `SameSite=Lax` cookie. Only SHA-256 token hashes are stored. Sessions expire, rotate, can be individually revoked, and are capped per user.
- Email verification and password recovery use purpose-bound, expiring, one-time opaque tokens. Only hashes are stored, and issuing a new token consumes previous unused tokens for that purpose.
- Authentication rate limits use Redis with a bounded process-local fallback for development resilience.
- Password recovery and verification resend responses do not reveal whether an account exists.
- Security events retain hashed network identifiers and material outcomes without storing raw session or action tokens.
- Mail delivery uses SMTP through a provider boundary; local development points to Mailpit.
- MFA remains visibly planned but disabled until a later security milestone implements enrollment and recovery.

## Consequences

The API requires PostgreSQL extensions `citext` and `pgcrypto`. Production must provide a strong `SECURITY_PEPPER`, TLS, a secure SMTP provider, and HTTPS so cookies receive the `Secure` flag. Changing a password revokes all active sessions. Automated expiry, replay, rotation, and rate-limit tests remain a release requirement.
