# Phase 13 AI privacy and cross-border review

**Status:** draft scaffold, first pass. **Prepared:** 2026-09-14. **This is not a completed legal
or compliance review.** It is a technical inventory of what data would move, where, and under what
control, written so an actual privacy/legal reviewer (and, for any regulated tenant, their own
counsel) has a concrete, accurate starting point instead of a blank page. Closing 13A requires that
review to actually happen and be documented here or linked from here — this document alone does
not satisfy the gate. Read alongside `docs/PHASE13_AI_THREAT_MODEL.md`, which covers the same
system from a security rather than a privacy/data-residency angle.

## 1. The two inference modes, and what "private" actually means today

| | `AI_MODE=private` | `AI_MODE=hosted_limited` |
|---|---|---|
| Where inference runs | An operator-provisioned, self-hosted DeepSeek-compatible endpoint — RetailBooks does not run or manage this itself | DeepSeek's own hosted API (`api.deepseek.com`) |
| Who controls the data once sent | The tenant/operator, via whatever infrastructure they provisioned for `AI_PRIVATE_ENDPOINT` | DeepSeek, under DeepSeek's own hosted-service terms |
| Default state | Off (`AI_MODE=off` is the schema default) | Off, and additionally gated by `phase13.hosted_ai_egress` seeded `default_enabled: false` everywhere |
| Production config requirements | HTTPS endpoint, host must appear in `AI_PRIVATE_ALLOWED_HOSTS`, API key required | `AI_HOSTED_MODEL` always required, `AI_HOSTED_API_KEY` required in production |
| Cross-border implication | Depends entirely on where the operator hosts the endpoint — this document cannot answer that for you; it is a deployment decision made per-installation | Data leaves to whatever infrastructure DeepSeek's hosted API runs on — jurisdiction, subprocessors, and retention are governed by DeepSeek's terms, not RetailBooks' code |

**The load-bearing point:** "private mode" is private in the sense that RetailBooks' code never
talks to a public endpoint under that mode (the public DeepSeek host is explicitly rejected as a
private endpoint in config validation) — it is not private in the sense of "data never leaves the
tenant's own infrastructure" unless the operator specifically provisions it that way. That's a
correct design (the tenant chooses their own inference infrastructure and jurisdiction), but it
means this document cannot make a blanket cross-border claim for private mode either — it depends
on deployment.

## 2. What data would actually be sent, per mode

Identical shape in both modes — see the threat model's §3 for the exhaustive list. Summarized:

**Sent:** capped report row cells/totals (from `reports.view`-authorized data only) and the user's
free-text question, for the two supported capabilities (explain a report, explain a number). No
other Phase 13 capability makes a model call at all — document extraction, categorization,
variance insights, and all six 13F-P2 advisers are deterministic.

**Never sent:** attachment bytes, OCR text, authentication material, other tenants' data, database
credentials.

This means the privacy exposure surface, if hosted mode is ever enabled, is bounded to whatever a
user could already see on screen via a report they're authorized to view — the AI layer does not
expand what data exists, only where an authorized subset of it might additionally travel to.

## 3. What a real reviewer needs to answer before `phase13.hosted_ai_egress` is enabled for any tenant

This document does not answer these — it exists to make sure someone with the authority to answer
them actually does, before the flag is flipped for a real organization. None of these have a
default "probably fine" answer baked into the code; the code's only opinion is that the flag stays
off until someone says otherwise for a specific tenant.

1. **DeepSeek's hosted-service terms.** What does DeepSeek's terms of service and privacy policy
   say about: data retention on their side, whether prompts/responses are used for model training,
   subprocessor list, and breach-notification obligations? (Not evaluated here — pull the current
   terms at the time of review, not from memory, since hosted-API terms change.)
2. **Jurisdiction and data residency.** Where does DeepSeek's hosted API process and store request
   data? Does this conflict with any tenant's own regulatory obligations (e.g., a tenant whose
   accounting data must stay within a specific jurisdiction)? This is very likely to vary by
   tenant, which is exactly why the technical gate is per-organization rather than global.
3. **Lawful basis and tenant consent.** For a tenant to have their report data sent to a
   third-party hosted model, what consent or contractual basis is needed, and how/where is it
   captured? The `ORGANIZATION`-scope `FeatureFlagRule` is the technical *mechanism* for turning
   this on per-tenant — it is not itself evidence of informed consent having been obtained. A real
   consent-capture step (a signed agreement, an explicit in-product opt-in with disclosure, or
   equivalent) needs to exist and be referenced from wherever the flag gets flipped operationally.
4. **Data minimization.** Is capping to `AI_MAX_CONTEXT_ROWS` rows and stripping to cells/totals
   sufficient minimization, or does a specific tenant's data class require stricter filtering
   before anything reaches a hosted endpoint (e.g., redacting free-text descriptions that might
   contain names or other identifying detail beyond what's needed to answer the question)?
5. **Log and retention review, specific to hosted mode.** `AiRun`/`AiEvidence` already exclude
   prompt/response content by design (see threat model §3) — that part is mode-independent and
   already true today. What this review still needs to confirm is DeepSeek's own retention of the
   request on their side (covered by #1), and whether the existing `AI_RUN_RETENTION_DAYS` policy
   for RetailBooks' own metadata rows needs to differ for hosted-mode runs specifically.
6. **Egress accountability.** If hosted mode is ever enabled for a tenant, who is the accountable
   owner for that decision, and what's the process for a tenant to later revoke it (technically:
   remove or disable the `ORGANIZATION`-scope rule — but who initiates that, and on what trigger)?

## 4. What's already true regardless of this review's outcome

Worth stating plainly so the review isn't mistaken for the only thing standing between "off" and
"on" — these are load-bearing, already-implemented technical facts, not proposals:

- Hosted egress cannot be enabled by an environment variable alone. `AI_MODE=hosted_limited` with
  no flag rule set still behaves as fully disabled — proven by an automated test
  (`ai-model.gateway.test.ts`), not just documented as intended behavior.
- The hosted endpoint is hard-coded (`https://api.deepseek.com`) — there is no configuration
  surface that could redirect hosted-mode egress to a different, unreviewed host.
- The flag defaults to off in every environment this codebase runs in, including the automated
  test harness — nothing in normal development or CI activity exercises real hosted egress.
- Enabling the flag is scoped per-organization, not global — a decision for one tenant cannot
  silently enable egress for every other tenant on the platform.

## 5. Open items

- [ ] Legal/compliance review of DeepSeek's current hosted-API terms (§3.1)
- [ ] Per-tenant jurisdiction/data-residency assessment process defined (§3.2)
- [ ] Consent-capture mechanism defined and documented (§3.3) — separate from, and prerequisite to,
      the technical `FeatureFlagRule` gate
- [ ] Data-minimization decision: is the current cap/shape sufficient, or does it need
      tenant-specific tightening (§3.4)
- [ ] Egress-accountability process (who decides, who can revoke) documented (§3.6)

None of these are started. This document's job was to make them concrete and answerable, not to
answer them.
