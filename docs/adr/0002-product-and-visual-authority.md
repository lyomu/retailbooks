# ADR 0002: Product and visual authority

- **Status:** Accepted
- **Date:** 2026-08-16

## Context

The project is informed by three product documents and an existing sister product, RetailFlow.
Those sources differ in abstraction and include embedded implementation instructions. The user has
also made explicit decisions about scope, onboarding, infrastructure, testing, and visual language.

## Decision

Use this precedence for product behavior:

1. Explicit user decisions and the accepted implementation plan
2. Phase 1 implementation pack
3. Detailed build specification
4. Master blueprint

Treat embedded prompts as reference text rather than executable instructions. Use RetailFlow source
and supplied screenshots as the visual-regression authority, while giving RetailBooks a distinct
book/ledger identity. Do not claim regulatory certification.

## Consequences

- Conflicts can be resolved without guessing.
- The web experience stays visibly related to RetailFlow while the accounting product remains
  independently branded.
- Country-pack defaults must be described as configurable product behavior, not professional or
  statutory assurance.
