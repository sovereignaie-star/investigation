#!/usr/bin/env python3
"""P4-023 — dedupe (python) benchmark on the frozen reference set (same splits,
same pairwise F1 as core/er). Training gets the SAME supervision core/er's FS
estimation gets: the train split's labeled positive pairs + sampled negatives
from the same blocking space (name-prefix + country). Prediction on eval."""
import json, random, time

def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

train = load("bench/er/data/records-train.json")
evalr = load("bench/er/data/records-eval.json")
truth = set(tuple(p) for p in load("bench/er/data/truth-eval.json"))
labels_train = load("bench/er/data/labels-train.json")

def as_rec(r):
    return {
        "name": r["name"],
        "country": r["country"],
        "birthDate": r["birthDate"],
        "addresses": frozenset(r["addresses"].split(" | ")) if r["addresses"] else frozenset(),
        "identifiers": frozenset(r["identifiers"].split(" | ")) if r["identifiers"] else frozenset(),
    }

train_data = {r["id"]: as_rec(r) for r in train}
train_pos = set(tuple(p) for p in labels_train["positives"])

# negatives: sampled candidate pairs from the same blocking space core/er uses
# (first-3 name chars + country) that are not labeled duplicates
rng = random.Random(42)
blocks = {}
for i, a in enumerate(train):
    for b in train[i + 1:]:
        if a["name"][:3] == b["name"][:3] and a["country"] == b["country"]:
            key = tuple(sorted([a["id"], b["id"]]))
            if key not in train_pos:
                blocks.setdefault(key, None)
negatives = sorted(blocks.keys())
if len(negatives) > 2000:
    negatives = rng.sample(negatives, 2000)
labeled_pairs = {
    "match": [[train_data[a], train_data[b]] for a, b in sorted(train_pos)],
    "distinct": [[train_data[a], train_data[b]] for a, b in negatives],
}

import dedupe
from importlib import metadata
from dedupe.variables import String, Exact, Set as SetVar
variables = [
    String("name"),
    Exact("country"),
    String("birthDate", has_missing=True),
    SetVar("addresses", has_missing=True),
    SetVar("identifiers", has_missing=True),
]
t_train0 = time.perf_counter()
deduper = dedupe.Dedupe(variables, num_cores=1)  # بيئة العزل: forkserver متعطل — أحادي النواة
deduper.prepare_training(train_data)
deduper.mark_pairs(labeled_pairs)
deduper.train()
t_train1 = time.perf_counter()
eval_data = {r["id"]: as_rec(r) for r in evalr}
t_pred0 = time.perf_counter()
raw_pairs = list(deduper.pairs(eval_data))
scores = list(deduper.score(raw_pairs))
t_pred1 = time.perf_counter()

# العتبة المعلنة: 0.5 — الافتراضي المعتمد في dedupe نفسه (نفس نهج core/er
# في العتبات المعلنة لا المقدَّرة من eval)
THRESHOLD = 0.5
tp = fp = 0
for scored in scores:
    ids, score = scored[0], float(scored[1])
    if score < THRESHOLD:
        continue
    a, b = sorted(ids)
    if (a, b) in truth:
        tp += 1
    else:
        fp += 1
fn = len(truth) - tp
precision = tp / (tp + fp) if tp + fp else 0.0
recall = tp / (tp + fn) if tp + fn else 0.0
f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
result = {
    "tool": f"dedupe {metadata.version('dedupe')}",
    "tp": tp, "fp": fp, "fn": fn,
    "precision": round(precision, 4), "recall": round(recall, 4), "f1": round(f1, 4),
    "threshold": THRESHOLD,
    "trainSeconds": round(t_train1 - t_train0, 2),
    "predictSeconds": round(t_pred1 - t_pred0, 2),
    "scoredPairs": len(scored),
}
with open("bench/er/result-dedupe.json", "w", encoding="utf-8") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)
print(json.dumps(result, indent=2, ensure_ascii=False))
