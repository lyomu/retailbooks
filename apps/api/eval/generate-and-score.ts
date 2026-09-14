import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateDocumentCases } from './lib/document-fixtures.ts';
import { splitFor } from './lib/holdout-split.ts';
import { baselineClassify, generateQuestionCases } from './lib/question-fixtures.ts';
import { scoreDocumentCase, summarizeFieldScores } from './lib/score-documents.ts';

const SEED = 130914; // Fixed: "13" (phase) + "09-14" (the date this eval set was first cut).
const dataDir = join(dirname(fileURLToPath(import.meta.url)), 'data');
mkdirSync(dataDir, { recursive: true });

function writeJson(filename: string, value: unknown): void {
  writeFileSync(join(dataDir, filename), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

// ---- Document cases -------------------------------------------------------

const documentCases = generateDocumentCases(SEED, 110);
writeJson(
  'documents.json',
  documentCases.map((documentCase) => ({ ...documentCase, split: splitFor(documentCase.id) })),
);

const documentResults = documentCases.map((documentCase) => scoreDocumentCase(documentCase));
const devResults = documentResults.filter((result) => splitFor(result.caseId) === 'dev');
const holdoutResults = documentResults.filter((result) => splitFor(result.caseId) === 'holdout');

const documentBaselineReport = {
  seed: SEED,
  generatedAt: new Date().toISOString().slice(0, 10),
  totalCases: documentCases.length,
  devCount: devResults.length,
  holdoutCount: holdoutResults.length,
  fieldScores: {
    dev: summarizeFieldScores(devResults),
    holdout: summarizeFieldScores(holdoutResults),
    overall: summarizeFieldScores(documentResults),
  },
  arithmeticValidAccuracy: {
    dev: rate(devResults.filter((result) => result.arithmeticValidCorrect).length, devResults.length),
    holdout: rate(
      holdoutResults.filter((result) => result.arithmeticValidCorrect).length,
      holdoutResults.length,
    ),
  },
  perCase: documentResults,
};
writeJson('documents-baseline-report.json', documentBaselineReport);

// ---- Question cases ---------------------------------------------------

const questionCases = generateQuestionCases(SEED, 22);
writeJson(
  'questions.json',
  questionCases.map((questionCase) => ({ ...questionCase, split: splitFor(questionCase.id) })),
);

const questionBaselineResults = questionCases.map((questionCase) => {
  const predictedCategory = baselineClassify(questionCase.question);
  return {
    id: questionCase.id,
    split: splitFor(questionCase.id),
    trueCategory: questionCase.category,
    predictedCategory,
    categoryCorrect: predictedCategory === questionCase.category,
  };
});
const questionDev = questionBaselineResults.filter((result) => result.split === 'dev');
const questionHoldout = questionBaselineResults.filter((result) => result.split === 'holdout');

const questionBaselineReport = {
  seed: SEED,
  generatedAt: new Date().toISOString().slice(0, 10),
  totalCases: questionCases.length,
  devCount: questionDev.length,
  holdoutCount: questionHoldout.length,
  note:
    'This baseline is a trivial keyword classifier, not a model -- it exists so a real model (once ' +
    'AI_MODE is private or hosted_limited for a reviewed tenant) has a non-empty floor to beat on ' +
    'category identification, per the Quality gate\'s "model-independent baselines" requirement. It ' +
    'says nothing about actual answer quality, abstention correctness, or citation grounding, which ' +
    'need a real model run and a human/LLM-judge scoring pass -- not yet done, see eval/README.md.',
  categoryAccuracy: {
    dev: rate(questionDev.filter((result) => result.categoryCorrect).length, questionDev.length),
    holdout: rate(
      questionHoldout.filter((result) => result.categoryCorrect).length,
      questionHoldout.length,
    ),
  },
  perCase: questionBaselineResults,
};
writeJson('questions-baseline-report.json', questionBaselineReport);

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 10_000;
}

console.log(
  `Wrote ${documentCases.length} document cases (${devResults.length} dev / ${holdoutResults.length} holdout) ` +
    `and ${questionCases.length} question cases (${questionDev.length} dev / ${questionHoldout.length} holdout) to eval/data/.`,
);
console.log(
  'Document arithmetic-validity accuracy -- dev:',
  documentBaselineReport.arithmeticValidAccuracy.dev,
  'holdout:',
  documentBaselineReport.arithmeticValidAccuracy.holdout,
);
console.log(
  'Question baseline category accuracy -- dev:',
  questionBaselineReport.categoryAccuracy.dev,
  'holdout:',
  questionBaselineReport.categoryAccuracy.holdout,
);
