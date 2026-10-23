#!/usr/bin/env python3
"""P4-023 — Splink benchmark on the frozen reference set (same splits, same
pairwise F1 as core/er). Trains EM on the seed-42 train split (the same data
core/er's FS estimation sees), scores the seed-1337 eval pairs with the trained
model, and reports F1 + prediction wall-clock time (training time reported
separately — training is offline)."""
import json, time, sys
from splink import Linker, DuckDBAPI, SettingsCreator
from splink.comparison_library import (
    ExactMatch,
    JaroWinklerAtThresholds,
    LevenshteinAtThresholds,
    JaccardAtThresholds,
    NameComparison,
    DateOfBirthComparison,
)

def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

train = load("bench/er/data/records-train.json")
evalr = load("bench/er/data/records-eval.json")
truth = set(tuple(p) for p in load("bench/er/data/truth-eval.json"))

settings = SettingsCreator(
    link_type="dedupe_only",
    unique_id_column_name="id",
    # أولوية تجريبية من train نفسها — نفس مستوى الإشراف الذي يحصل عليه core/er
    # (95 زوجاً إيجابياً من 25878 مقارنة ممكنة)
    probability_two_random_records_match=95 / (228 * 227 / 2),
    comparisons=[
        NameComparison("name"),
        ExactMatch("country").configure(term_frequency_adjustments=True),
        DateOfBirthComparison("birthDate", input_is_string=True),
        JaccardAtThresholds("addresses", [0.9, 0.7]),
        JaccardAtThresholds("identifiers", [0.9, 0.7]),
    ],
    blocking_rules_to_generate_predictions=[
        "l.name = r.name",
        "l.country = r.country",
    ],
)

db_api = DuckDBAPI()
t_train0 = time.perf_counter()
linker = Linker(db_api.register(train), settings)
linker.training.estimate_u_using_random_sampling(max_pairs=1e6)
for br in ["l.country = r.country", "l.birthDate = r.birthDate", "substr(l.name,1,1) = substr(r.name,1,1)"]:
    linker.training.estimate_parameters_using_expectation_maximisation(br)
t_train1 = time.perf_counter()

model = linker.misc.save_model_to_json(out_path="/tmp/splink-model.json", overwrite=True)
# score the EVAL pairs with the train-estimated model
db_api2 = DuckDBAPI()
linker_eval = Linker(db_api2.register(evalr), model)
t_pred0 = time.perf_counter()
pred = linker_eval.inference.predict(threshold_match_probability=0.5)
rows = pred.as_pandas_dataframe()
t_pred1 = time.perf_counter()

tp = fp = 0
for _, r in rows.iterrows():
    a, b = sorted([r["id_l"], r["id_r"]])
    if (a, b) in truth:
        tp += 1
    else:
        fp += 1
fn = len(truth) - tp
precision = tp / (tp + fp) if tp + fp else 0.0
recall = tp / (tp + fn) if tp + fn else 0.0
f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
result = {
    "tool": "splink 5.0.0 (duckdb)",
    "tp": tp, "fp": fp, "fn": fn,
    "precision": round(precision, 4), "recall": round(recall, 4), "f1": round(f1, 4),
    "trainSeconds": round(t_train1 - t_train0, 2),
    "predictSeconds": round(t_pred1 - t_pred0, 2),
    "predictions": int(len(rows)),
}
with open("bench/er/result-splink.json", "w", encoding="utf-8") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)
print(json.dumps(result, indent=2, ensure_ascii=False))
