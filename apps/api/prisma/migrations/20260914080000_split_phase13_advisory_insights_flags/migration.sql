-- Phase 13F-P2: split the single shared `phase13.advisory_insights` flag into six independent
-- per-capability flags, so each advisory capability can be rolled out, narrowed to a pilot
-- organization, or killed without affecting the others. See
-- apps/api/src/platform/phase13-feature-flags.ts for the keys and
-- apps/api/src/insights/insights.controller.ts for the routes each one now gates.
--
-- The old flag is archived, not deleted: any existing FeatureFlagRule rows that reference it
-- become inert (a non-ACTIVE flag fails closed in EntitlementsService#isFlagEnabled) without a
-- data migration, and the audit/preview history for it is preserved.
INSERT INTO "feature_flags" ("key", "name", "description", "default_enabled", "status")
VALUES
  (
    'phase13.advisory_insights.cash_flow',
    'Cash-flow scenario adviser',
    'Deterministic cash-flow scenario projections.',
    true,
    'ACTIVE'
  ),
  (
    'phase13.advisory_insights.collections',
    'Collections prioritizer',
    'Deterministic overdue-invoice collections prioritization.',
    true,
    'ACTIVE'
  ),
  (
    'phase13.advisory_insights.inventory',
    'Inventory purchasing adviser',
    'Deterministic inventory purchasing/reorder advice.',
    true,
    'ACTIVE'
  ),
  (
    'phase13.advisory_insights.project_margin',
    'Project margin adviser',
    'Deterministic project margin analysis.',
    true,
    'ACTIVE'
  ),
  (
    'phase13.advisory_insights.policy_qa',
    'Country pack policy Q&A',
    'Deterministic keyword search over country/tax pack policy content.',
    true,
    'ACTIVE'
  ),
  (
    'phase13.advisory_insights.evidence_packs',
    'Audit evidence packs',
    'Deterministic audit evidence pack assembly.',
    true,
    'ACTIVE'
  )
ON CONFLICT ("key") DO NOTHING;

UPDATE "feature_flags" SET "status" = 'ARCHIVED' WHERE "key" = 'phase13.advisory_insights';
