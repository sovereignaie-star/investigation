/* eslint-disable no-console */
/**
 * P4-023 — معيار core/er: نفس بروتوكول القبول المجمد (أوزان FS من train فقط،
 * عتبات معلنة)، والقياس على eval المجمدة. التوقيت: وسيط 5 تشغيلات للقرار
 * (الاستدلال فقط — تقدير الأوزان خارج التوقيت لأنه خارج التشغيل بالبرنامج).
 * Same metric as the engine's acceptance test: pairwise F1 over labeled pairs.
 */
import { generateReferenceSet, estimateWeights, resolveEntities } from "../../packages/core/src/er/index.ts";
import { writeFileSync } from "node:fs";

const train = generateReferenceSet(42);
const frozen = generateReferenceSet(1337);
const weights = estimateWeights(train.train);
const truth = new Set(frozen.eval.duplicatePairs.map((p) => [p.a.id, p.b.id].sort().join("|")));

let tp = 0,
  fp = 0;
const suggestions = resolveEntities(frozen.eval.records, weights);
for (const s of suggestions) {
  if (truth.has([s.aId, s.bId].sort().join("|"))) tp += 1;
  else fp += 1;
}
const fn = truth.size - tp;
const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
const recall = truth.size === 0 ? 0 : tp / (tp + fn);
const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

// التوقيت: وسيط 5 تشغيلات للقرار
const times = [];
for (let i = 0; i < 5; i++) {
  const a = performance.now();
  resolveEntities(frozen.eval.records, weights);
  times.push(performance.now() - a);
}
times.sort((a, b) => a - b);
const medianMs = times[Math.floor(times.length / 2)];

const result = {
  tool: "core/er",
  tp,
  fp,
  fn,
  precision: Number(precision.toFixed(4)),
  recall: Number(recall.toFixed(4)),
  f1: Number(f1.toFixed(4)),
  resolveMedianMs: Number(medianMs.toFixed(1)),
  suggestions: suggestions.length,
};
writeFileSync(new URL("./result-core.json", import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
