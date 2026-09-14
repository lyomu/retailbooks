-- Phase 13 hosted DeepSeek mode: seed the second, independent kill switch that must be explicitly
-- flipped per-organization (an ORGANIZATION-scope FeatureFlagRule) before AI_MODE=hosted_limited
-- can ever send a real request to DeepSeek's hosted API. Deliberately seeded default_enabled=false,
-- unlike every other Phase 13 flag: this one must stay off until the 13A privacy/contractual/egress
-- review has passed. See apps/api/src/platform/phase13-feature-flags.ts and AiModelGateway#explain.
INSERT INTO "feature_flags" ("key", "name", "description", "default_enabled", "status")
VALUES
  (
    'phase13.hosted_ai_egress',
    'Hosted DeepSeek egress (13A-gated)',
    'Allows organization-scoped opt-in to the hosted DeepSeek API (AI_MODE=hosted_limited) once the 13A privacy/contractual/egress review has passed for that tenant and data class. Off by default; do not enable globally.',
    false,
    'ACTIVE'
  )
ON CONFLICT ("key") DO NOTHING;
