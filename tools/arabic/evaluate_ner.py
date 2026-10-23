#!/usr/bin/env python3
"""
P5-025 — حصن تقييم أدوات العربية للتجزئة والكيانات المسماة (قياس محلي).

يقيس «تغطية اكتشاف أسماء الأشخاص» لأداتين قابلتين للتشغيل المحلي
(Stanza وCAMeL Tools — نماذج عربية مضمّنة محلياً) على مجموعة P5-006
الذهبية (أزواج الأسماء — كل اسم فيها اسم شخص حقيقي البنية من بنوك
أسماء شائعة): نسبة الأسماء التي يصنفها النموذج كـPERSON/PERS.

هذا القياس مُعلن بدقة: هو «تغطية اكتشاف أسماء الأشخاص على هذه المجموعة»
وليس «دقة NER عامة» (لا قياس على مؤسسات أو مواقع أو إنذارات كاذبة في
جمل حقيقية) — والتجزئة الصرفية بلا حقيقة أرضية في المجموعة فلا تُدّعى
لها دقة (تُوصف وصفياً فقط).

الاستخدام: python3 tools/arabic/evaluate_ner.py --report <out.json>
"""
import argparse
import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
GOLD = REPO / "fixtures" / "arabic" / "name-pairs.jsonl"


def load_names():
    names = []
    seen = set()
    with open(GOLD, encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            for key in ("a", "b"):
                if row[key] not in seen:
                    seen.add(row[key])
                    names.append(row[key])
    return names


def evaluate_stanza(names):
    import stanza
    nlp = stanza.Pipeline("ar", processors="tokenize,ner", verbose=False)
    detected = 0
    tokens_total = 0
    started = time.time()
    for name in names:
        doc = nlp(name)
        tokens_total += len(doc.sentences[0].tokens) if doc.sentences else 0
        if any(e.type == "PER" for e in doc.ents):
            detected += 1
    return {
        "tool": "stanza",
        "version": stanza.__version__,
        "names": len(names),
        "person_detected": detected,
        "person_recall": detected / len(names),
        "mean_tokens_per_name": tokens_total / len(names),
        "seconds": round(time.time() - started, 1),
    }


def evaluate_camel(names):
    from camel_tools.ner import NERecognizer
    from camel_tools.tokenizers.word import simple_word_tokenize
    ner = NERecognizer(model_path=str(Path.home() / ".camel_tools" / "data" / "ner" / "arabert"))
    detected = 0
    tokens_total = 0
    started = time.time()
    for name in names:
        tokens = simple_word_tokenize(name)
        tokens_total += len(tokens)
        labels = ner.predict([tokens])[0]
        if any(l in ("B-PERS", "U-PERS") for l in labels):
            detected += 1
    return {
        "tool": "camel-tools (ner-arabert)",
        "version": "camel_tools ner-arabert",
        "names": len(names),
        "person_detected": detected,
        "person_recall": detected / len(names),
        "mean_tokens_per_name": tokens_total / len(names),
        "seconds": round(time.time() - started, 1),
    }


def evaluate_spacy(names):
    """spaCy: لا يوجد نموذج NER عربي رسمي — يُقاس التقطيع وصفياً فقط."""
    import spacy
    nlp = spacy.blank("ar")
    tokens_total = 0
    started = time.time()
    for name in names:
        tokens_total += len(nlp(name))
    return {
        "tool": "spacy (blank ar tokenizer)",
        "version": spacy.__version__,
        "names": len(names),
        "person_detected": None,
        "person_recall": None,
        "person_recall_note": "لا يوجد نموذج NER عربي رسمي في spacy-models — غير قابل للقياس (موثق)",
        "mean_tokens_per_name": tokens_total / len(names),
        "seconds": round(time.time() - started, 1),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True)
    parser.add_argument("--tools", default="stanza,camel,spacy")
    args = parser.parse_args()
    names = load_names()
    print(f"loaded {len(names)} unique gold names from {GOLD}")
    results = []
    if "stanza" in args.tools:
        print("evaluating stanza (ar) ...")
        results.append(evaluate_stanza(names))
    if "camel" in args.tools:
        print("evaluating camel-tools ner-arabert ...")
        results.append(evaluate_camel(names))
    if "spacy" in args.tools:
        print("evaluating spacy blank(ar) tokenizer (descriptive) ...")
        results.append(evaluate_spacy(names))
    report = {
        "protocol": {
            "set": "P5-006 gold name pairs (fixtures/arabic/name-pairs.jsonl)",
            "measure": "person-name detection coverage on the gold set (NOT general NER accuracy)",
            "segmentation": "no gold segmentation exists in the set — descriptive only, no accuracy claimed",
            "farasa": "not measured locally: jar download requires registration and its license is research-purpose-only (evidence in the evaluation file)",
        },
        "results": results,
    }
    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps(report["results"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sys.exit(main())
