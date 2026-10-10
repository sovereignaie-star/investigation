#!/usr/bin/env python3
"""Build docs/tools/ARSENAL.md from tools/catalog/arsenal.json, docs/tools/catalog.csv and docs/ROADMAP.md.

Usage: python3 tools/catalog/arsenal.py

The arsenal is the owner's capability map (eyes / arms / legs / wings ...), organised by specialty.
For every tool it shows, automatically:
  * the catalog entry (TL-xxxxxxxx) when the tool is in docs/tools/catalog.csv,
  * the roadmap items (TR-xxx transforms and Pn-nnn tasks) whose row names the tool,
  * a status: integrated in the roadmap / project stack / in catalog / candidate / defunct / excluded.
Do not edit ARSENAL.md by hand; edit arsenal.json (rows, aliases, status) and rerun.
"""
import csv, json, os, re
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = json.load(open(os.path.join(HERE, "arsenal.json"), encoding="utf-8"))
CAT = list(csv.DictReader(open(os.path.join(ROOT, "docs", "tools", "catalog.csv"), encoding="utf-8")))
ROADMAP = open(os.path.join(ROOT, "docs", "ROADMAP.md"), encoding="utf-8").read()

LAYERS = OrderedDict([
    ("eyes", "العيون: الرصد والجمع"), ("arms", "الأذرع: التحليل والمعالجة"), ("legs", "الأرجل: الوصول والتنقل"),
    ("wings", "الأجنحة: التوسع والنشر والتشغيل"), ("special", "أدوات متخصصة ومتقدمة"), ("protect", "الحماية والخصوصية"),
    ("ai", "الذكاء الاصطناعي"), ("collab", "الإدارة والتعاون"), ("extra", "تحليلات متخصصة إضافية"),
])
LIC = {"oss": "مفتوح", "free": "مجاني", "paid": "مدفوع", "caution": "حساس", "special": "عتاد/متخصص"}
STATE = {"roadmap": "في الخارطة", "stack": "مكدس المشروع", "catalog": "في الكتالوج", "candidate": "مرشح", "defunct": "متوقف", "excluded": "مستبعد"}


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


by_name = {}
for c in CAT:
    by_name.setdefault(norm(c["name"]), c)


def catalog_entry(name):
    a = DATA["aliases"].get(name.lower())
    if a:
        hit = [c for c in CAT if a in c["url"].lower()]
        if hit:
            return sorted(hit, key=lambda c: (c["link_status"] != "reachable", len(c["url"])))[0]
        return None  # an explicit alias that is not in the catalog means "not catalogued", never a fuzzy guess
    k = norm(name)
    if len(k) < 3:
        return None
    if k in by_name:
        return by_name[k]
    for c in CAT:  # repository or host named exactly like the tool
        u = re.sub(r"^https?://(www\.)?", "", c["url"].lower()).rstrip("/")
        parts = u.split("/")
        if norm(parts[0].split(".")[0]) == k or (parts[0] in ("github.com", "gitlab.com") and len(parts) == 3 and norm(parts[2]) == k):
            return c
    return None


ROWS = [l for l in ROADMAP.split("\n") if re.match(r"^\| (TR-\d{3}|P\d-\d{3}) \|", l)]


def roadmap_refs(name):
    if len(name) < 3:
        return []
    rx = re.compile(r"(?<![A-Za-z0-9])" + re.escape(name) + r"(?![A-Za-z0-9])", re.I)
    out = []
    for l in ROWS:
        if rx.search(l):
            out.append(l.split("|")[1].strip())
    return out[:4]


def classify(r):
    key = r["name"].lower()
    st = DATA["status"]
    if key in st["defunct"]:
        note, url = st["defunct"][key]
        return "defunct", f"{note} ([مصدر]({url}))"
    if key in st["excluded"]:
        return "excluded", st["excluded"][key]
    refs = roadmap_refs(r["name"])
    if refs:
        return "roadmap", "، ".join(refs)
    if key in st["stack"]:
        return "stack", st["stack"][key]
    return None, ""


def esc(s):
    return (s or "").replace("|", "\\|")


def main():
    rows = DATA["rows"]
    stats, uniq = Counter(), {}
    by_layer = OrderedDict((k, OrderedDict()) for k in LAYERS)
    for r in rows:
        c = catalog_entry(r["name"])
        state, where = classify(r)
        if state is None:
            state = "catalog" if c else "candidate"
        r["_c"], r["_state"], r["_where"] = c, state, where
        uniq.setdefault(r["name"].lower(), state)
        by_layer[r["layer"]].setdefault((r["sec"], r["section"]), []).append(r)
    for s in uniq.values():
        stats[s] += 1
    L = ["# ترسانة الأدوات والقدرات", "",
         "> مُولَّد آلياً بواسطة `tools/catalog/arsenal.py` من `tools/catalog/arsenal.json` والكتالوج والخارطة. لا تحرّر هذا الملف يدوياً.", "",
         "خريطة القدرات التي أرفقها المالك (PR #9، «ترسانة الأدوات والقدرات»)، مرتبة حسب الاختصاص في طبقات: العيون (الرصد والجمع)، والأذرع (التحليل)، والأرجل (الوصول)، والأجنحة (التوسع والتشغيل)، ثم الأدوات المتخصصة.",
         "لكل أداة: موقعها في الكتالوج (`TL-…`)، وموقعها في الخارطة (`TR-…` محوّل أو `Pn-nnn` مهمة) إن وُجد، وحالتها. النص الأصلي محفوظ في `docs/archive/ROADMAP2-arsenal-original-2026-10-10.md`، والقرارات في القسم 14.8 من الخارطة.", "",
         "## الملخص", "", "| الحالة | المعنى | عدد الأدوات الفريدة |", "|---|---|---|"]
    meaning = {"roadmap": "لها محوّل أو مهمة في الخارطة", "stack": "جزء من مكدس بناء المشروع نفسه", "catalog": "في الكتالوج، تنتظر محوّلاً",
               "candidate": "مذكورة في الترسانة فقط (بلا رابط موثق بعد)", "defunct": "متوقفة أو أُعيدت تسميتها", "excluded": "مستبعدة بقواعد المنتج E-01..E-10"}
    for k in STATE:
        L.append(f"| {STATE[k]} | {meaning[k]} | {stats[k]} |")
    L.append(f"| **المجموع** | | **{sum(stats.values())}** |")
    L += ["", "## الفهرس", ""]
    for lk, secs in by_layer.items():
        if secs:
            L.append(f"- {LAYERS[lk]}: " + "، ".join(f"[{s[0]}](#{s[0].replace('.', '')}-{re.sub(r'[^\w\u0600-\u06FF -]', '', s[1]).strip().lower().replace(' ', '-')})" for s in secs))
    for lk, secs in by_layer.items():
        if not secs:
            continue
        L += ["", f"## {LAYERS[lk]}"]
        for (no, title), items in secs.items():
            L += ["", f"### {no} {title}", "", "| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |", "|---|---|---|---|---|---|"]
            for r in items:
                c = r["_c"]
                name = f"[{esc(r['name'])}]({c['url']})" if c else esc(r["name"])
                lic = "، ".join(LIC[x] for x in r["lic"]) or "—"
                L.append(f"| {name} | {esc(r['desc'])} | {lic} | {c['id'] if c else '—'} | {STATE[r['_state']]} | {esc(r['_where']) or '—'} |")
    out = os.path.join(ROOT, "docs", "tools", "ARSENAL.md")
    open(out, "w", encoding="utf-8").write("\n".join(L) + "\n")
    print(json.dumps({"rows": len(rows), "unique": len(uniq), "by_state": stats}, ensure_ascii=False))


if __name__ == "__main__":
    main()
