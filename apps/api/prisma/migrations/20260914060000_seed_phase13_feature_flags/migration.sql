-- Phase 13G: seed one feature flag per Phase 13 capability group so each can be independently
-- killed or narrowed to specific organizations from the platform console without a code change.
-- See apps/api/src/platform/phase13-feature-flags.ts for the keys and apps/api/src/platform/
-- feature-flag.guard.ts for how a route is gated. Seeded ACTIVE + default-enabled, matching the
-- "internal synthetic data" rollout stage this environment is at; an operator narrows this later
-- (add an ORGANIZATION-scope rule, or flip default_enabled) without a migration.
INSERT INTO "feature_flags" ("key", "name", "description", "default_enabled", "status")
VALUES
  (
    'phase13.report_drilldown',
    'Report drill-down & explain a number',
    'Deterministic report row drill-down and "explain a number", plus the optional AI narrative over it.',
    true,
    'ACTIVE'
  ),
  (
    'phase13.document_extraction',
    'Secure document/receipt extraction',
    'Malware-scanned, OCR-based receipt/bill extraction, review, and keyword search over Expense and Bill attachments.',
    true,
    'ACTIVE'
  ),
  (
    'phase13.ai_suggestions',
    'Categorization suggestions & variance insights',
    'Deterministic expense categorization suggestions, draft notes, and month-over-month spend variance insights.',
    true,
    'ACTIVE'
  ),
  (
    'phase13.approval_automation',
    'Bank match, close checklist, discrepancies, approval briefings',
    'Bank transaction match proposals, month-end close checklist, document/entry discrepancy flags, and approval briefings.',
    true,
    'ACTIVE'
  ),
  (
    'phase13.advisory_insights',
    'Cash flow, collections, inventory, project margin & policy Q&A advisers',
    'Deterministic cash-flow scenarios, collections prioritization, inventory purchasing, project margin, country-pack policy Q&A, and audit evidence pack advisers.',
    true,
    'ACTIVE'
  )
ON CONFLICT ("key") DO NOTHING;
