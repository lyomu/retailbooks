/**
 * Feature flag keys gating the Phase 13 secure AI/RAG capabilities, one per capability group so
 * each can be independently killed or rolled out per-organization from the platform console. Seeded
 * as ACTIVE + default-enabled (see the `add_phase13g_feature_flags` migration) for the current
 * internal/synthetic-data rollout stage; an operator narrows or disables any of these later without
 * a code change. See `RequireFeatureFlag`/`FeatureFlagGuard` for how a route is gated.
 */
export const PHASE13_FEATURE_FLAGS = {
  /** 13C: report drill-down and "explain a number". */
  REPORT_DRILLDOWN: 'phase13.report_drilldown',
  /** 13D: secure attachment scanning, OCR, receipt/bill extraction, and keyword search over it. */
  DOCUMENT_EXTRACTION: 'phase13.document_extraction',
  /** 13E: categorization suggestions, draft notes, and variance insights. */
  AI_SUGGESTIONS: 'phase13.ai_suggestions',
  /** 13F P1: bank match proposals, close checklist, document discrepancies, approval briefings. */
  APPROVAL_AUTOMATION: 'phase13.approval_automation',
  /** 13F P2: one independent flag per advisory capability, so each can be rolled out, narrowed to a
   * pilot organization, or killed without affecting the others. Replaces the single shared
   * `phase13.advisory_insights` flag (now archived — see the `split_phase13_advisory_insights_flags`
   * migration). */
  ADVISORY_CASH_FLOW: 'phase13.advisory_insights.cash_flow',
  ADVISORY_COLLECTIONS: 'phase13.advisory_insights.collections',
  ADVISORY_INVENTORY: 'phase13.advisory_insights.inventory',
  ADVISORY_PROJECT_MARGIN: 'phase13.advisory_insights.project_margin',
  ADVISORY_POLICY_QA: 'phase13.advisory_insights.policy_qa',
  ADVISORY_EVIDENCE_PACKS: 'phase13.advisory_insights.evidence_packs',
  /**
   * Hosted DeepSeek egress (AI_MODE=hosted_limited). Unlike every other flag in this file, this one
   * is seeded `default_enabled: false` and MUST stay off until the 13A privacy/contractual/egress
   * review has passed for a given tenant and data class. Flipping AI_MODE alone can never enable
   * real hosted egress — this flag is the second, independent gate; see AiModelGateway#explain.
   */
  HOSTED_AI_EGRESS: 'phase13.hosted_ai_egress',
} as const;
