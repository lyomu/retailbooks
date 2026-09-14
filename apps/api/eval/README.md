# Phase 13A evaluation set

**Status: synthetic, generated, pending human review.** This is infrastructure plus a first
labeled batch, not a substitute for the review the user needs to actually do — see
`docs/PHASE13_TODO.md`'s 13A section for what's still open. Nothing here should be cited as
"reviewer-labeled" in the strict sense the acceptance-gates table means until a human has actually
gone through it.

## What's here

- `lib/document-fixtures.ts` — generates synthetic receipt/document cases (OCR-line shape,
  ground truth computed by construction, not by running the extractor — see the file's own
  comment for why that distinction matters).
- `lib/question-fixtures.ts` — generates synthetic Q&A cases across report, retrieval, ambiguous,
  missing-evidence, and adversarial categories, each with an expected-behavior label (should the
  answer abstain, and why).
- `lib/score-documents.ts` — runs the real, deterministic `extractReceiptCandidate` against each
  document case and scores every field as true-positive / false-positive / false-negative /
  correct-abstention / incorrect-value against ground truth.
- `lib/holdout-split.ts` — a frozen dev/holdout split, keyed by case id hash so it never reshuffles
  as the corpus grows.
- `generate-and-score.ts` — the entry point. Run with `node eval/generate-and-score.ts` from
  `apps/api/`. Node's native TypeScript support (Node 23.6+/24) runs it directly — no build step,
  no `ts-node`/`tsx` dependency added.
- `data/` — generated output (`documents.json`, `questions.json`,
  `documents-baseline-report.json`, `questions-baseline-report.json`). Regeneratable from the seed
  in `generate-and-score.ts` (`130914`); regenerating overwrites these files with byte-identical
  content given the same generator code, which is the point of a frozen, reproducible set.

## What this does and doesn't prove

**Proves today, for real, with no model involved:**
- The deterministic receipt extractor's actual field-level accuracy against 110 varied synthetic
  documents (5 organizations/currencies, 3 scan-quality tiers, multiple date/currency/vendor/amount
  presentation styles) — this is real code being scored against real (if synthetic) input, not a
  mock.
- A "model-independent baseline" for the 115 Q&A cases' category identification, via a deliberately
  trivial keyword classifier (`baselineClassify`) — satisfying the Quality gate's requirement that
  a real model have a non-empty floor to beat, rather than nothing to compare against.

**Does not yet prove, and is explicitly out of scope for this pass:**
- Actual model answer quality, retrieval recall, or abstention correctness — there is no live
  model to run these questions through (`AI_MODE` is `off` by default; `private` needs a
  self-hosted endpoint; `hosted_limited` is gated behind the still-open 13A privacy review this
  evaluation set is itself part of). `questions.json`'s `expected` field is the ground truth a real
  model run would be scored against, once one exists to run.
- Human review of whether the synthetic cases and their ground-truth labels are actually
  representative of real receipts and real user questions. They were constructed by an AI agent
  from first principles (vendor name lists, currency codes, date formats, question templates) —
  plausible, not validated against real usage patterns.

## Known limitations, stated plainly rather than hidden

- **The Q&A baseline classifier is likely over-fit to its own question templates.** Both the
  question generator and the baseline classifier were written by the same process in the same
  pass, so keyword overlap between them is expected and the reported ~100% baseline accuracy is
  not a meaningful signal of how well *any* classifier would do on real, human-written questions —
  only that this specific trivial classifier can recognize its own template vocabulary. Treat the
  category-accuracy number as a harness smoke test, not a real baseline, until the question set has
  real-world (or at least independently-written) examples mixed in.
- **The document extractor essentially always returns a non-null `vendorName`.** `extractVendor`
  returns the first non-empty, non-purely-numeric line anywhere in the document, not just a
  dedicated "vendor field" — so even a case deliberately constructed to have no legible vendor line
  still gets a wrong, non-null guess from whatever text (an invoice number, a date label) appears
  first. This is a genuine characteristic of the current extractor, not a test-harness bug; it's
  visible in the `no_vendor_line`-style cases' ground truth (which correctly expects a wrong,
  non-null value, not `null`) rather than papered over. Worth a product decision at some point:
  is a wrong guess here actually better or worse than an explicit "no vendor found," given the
  system's "never invent a value" principle applies most obviously to amounts, but arguably should
  extend to vendor identity too.
- **Organizations, vendors, and questions are all invented,** not sampled from real (even
  anonymized) production or demo data. 13A's original ask was for real documents/questions,
  anonymized; this synthetic-first approach was an explicit scope decision made with the user
  given no such corpus existed, recorded in the branch history around 2026-09-14.

## Regenerating

```
cd apps/api
node eval/generate-and-score.ts
```

Change `SEED` in `generate-and-score.ts` only if you deliberately want a different frozen set
(this immediately invalidates any review already done against the old one — don't do this lightly
once a human has actually reviewed a batch).
