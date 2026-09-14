import { extractReceiptCandidate, type ReceiptCandidate } from '../../src/documents/receipt-extractor.ts';
import type { DocumentCase, GroundTruthField } from './document-fixtures.ts';

export interface FieldScore {
  readonly field: string;
  readonly truePositive: number;
  readonly falsePositive: number;
  readonly falseNegative: number;
  readonly correctAbstention: number;
  readonly incorrectValue: number;
  readonly total: number;
}

export interface DocumentCaseResult {
  readonly caseId: string;
  readonly scanQuality: string;
  readonly candidate: ReturnType<typeof serializeCandidate>;
  readonly fieldOutcomes: Record<string, 'true_positive' | 'false_positive' | 'false_negative' | 'correct_abstention' | 'incorrect_value'>;
  readonly arithmeticValidCorrect: boolean;
  readonly categoryMatchTestable: boolean;
}

function serializeCandidate(candidate: ReceiptCandidate) {
  return {
    vendorName: candidate.vendorName,
    vendorId: candidate.vendorId,
    date: candidate.date,
    currency: candidate.currency,
    subtotalMinor: candidate.subtotalMinor?.toString() ?? null,
    taxMinor: candidate.taxMinor?.toString() ?? null,
    totalMinor: candidate.totalMinor?.toString() ?? null,
    categoryId: candidate.categoryId,
    arithmeticValid: candidate.arithmeticValid,
    fieldFlags: candidate.fieldFlags,
  };
}

function scoreField(
  truth: GroundTruthField<string>,
  actual: string | null,
): 'true_positive' | 'false_positive' | 'false_negative' | 'correct_abstention' | 'incorrect_value' {
  if (truth.correctlyNull) {
    return actual === null ? 'correct_abstention' : 'false_positive';
  }
  if (actual === null) return 'false_negative';
  return actual === truth.value ? 'true_positive' : 'incorrect_value';
}

export function scoreDocumentCase(documentCase: DocumentCase): DocumentCaseResult {
  const candidate = extractReceiptCandidate(
    documentCase.lines,
    documentCase.knownVendors,
    documentCase.knownCategories,
  );
  const serialized = serializeCandidate(candidate);

  const fieldOutcomes: DocumentCaseResult['fieldOutcomes'] = {
    vendorName: scoreField(documentCase.groundTruth.vendorName, candidate.vendorName),
    date: scoreField(documentCase.groundTruth.date, candidate.date),
    currency: scoreField(documentCase.groundTruth.currency, candidate.currency),
    subtotalMinor: scoreField(documentCase.groundTruth.subtotalMinor, serialized.subtotalMinor),
    taxMinor: scoreField(documentCase.groundTruth.taxMinor, serialized.taxMinor),
    totalMinor: scoreField(documentCase.groundTruth.totalMinor, serialized.totalMinor),
  };

  return {
    caseId: documentCase.id,
    scanQuality: documentCase.scanQuality,
    candidate: serialized,
    fieldOutcomes,
    arithmeticValidCorrect: candidate.arithmeticValid === documentCase.groundTruth.arithmeticValid,
    categoryMatchTestable: documentCase.groundTruth.categoryMatched,
  };
}

export function summarizeFieldScores(results: readonly DocumentCaseResult[]): FieldScore[] {
  const fields = ['vendorName', 'date', 'currency', 'subtotalMinor', 'taxMinor', 'totalMinor'];
  return fields.map((field) => {
    const outcomes = results.map((result) => result.fieldOutcomes[field]);
    return {
      field,
      truePositive: outcomes.filter((outcome) => outcome === 'true_positive').length,
      falsePositive: outcomes.filter((outcome) => outcome === 'false_positive').length,
      falseNegative: outcomes.filter((outcome) => outcome === 'false_negative').length,
      correctAbstention: outcomes.filter((outcome) => outcome === 'correct_abstention').length,
      incorrectValue: outcomes.filter((outcome) => outcome === 'incorrect_value').length,
      total: outcomes.length,
    };
  });
}
