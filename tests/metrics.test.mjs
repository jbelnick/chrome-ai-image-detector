import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  confusionAtThreshold,
  balancedAccuracy,
  summarize,
  summarizeByCategory,
} from "../src/metrics.js";

describe("metrics", () => {
  it("computes balanced accuracy as (TPR + TNR) / 2", () => {
    const rows = [
      { label: 1, score: 0.9 },
      { label: 1, score: 0.2 },
      { label: 0, score: 0.1 },
      { label: 0, score: 0.8 },
    ];
    const c = confusionAtThreshold(rows, 0.65);
    assert.deepEqual(c, { tp: 1, fn: 1, tn: 1, fp: 1 });
    assert.equal(balancedAccuracy(c), 0.5);
  });

  it("summarizes TPR/TNR/BA per category without changing overall math", () => {
    const rows = [
      { label: 1, score: 0.9, category: "a" },
      { label: 1, score: 0.2, category: "a" },
      { label: 0, score: 0.1, category: "b" },
      { label: 0, score: 0.8, category: "b" },
    ];
    const { overall, byCategory } = summarizeByCategory(rows, 0.65);
    assert.equal(overall.balancedAccuracy, 0.5);
    assert.equal(byCategory.a.tpr, 0.5);
    assert.equal(byCategory.a.nAi, 2);
    assert.equal(byCategory.b.tnr, 0.5);
    assert.equal(byCategory.b.nReal, 2);
  });

  it("treats the 0.65 threshold as inclusive for the AI class", () => {
    const rows = [
      { label: 1, score: 0.65 },
      { label: 0, score: 0.649 },
    ];
    const summary = summarize(rows, 0.65);
    assert.equal(summary.tp, 1);
    assert.equal(summary.tn, 1);
    assert.equal(summary.balancedAccuracy, 1);
  });
});
