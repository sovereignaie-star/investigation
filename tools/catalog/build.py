#!/usr/bin/env python3
"""Build the Investigation Room tool catalog (docs/tools/*) from public curated lists.

Usage:
  python3 tools/catalog/build.py                 # fetch, parse, classify, check links, emit
  python3 tools/catalog/build.py --no-check      # skip the liveness check (reuse previous status)
  python3 tools/catalog/build.py --cache DIR     # read/write raw source files in DIR

Rules (see docs/tools/README.md and ROADMAP section 7):
  * Every entry is a real link taken from a named public source list. Nothing is invented.
  * A catalog entry is a CANDIDATE, not an approval. Integration requires a TR-xxx adapter,
    a licence/terms review and the ethics gate.
  * Offensive tooling (exploitation, phishing, stalkerware, DDoS ...) is excluded by policy.
"""
import argparse, asyncio, csv, datetime, hashlib, json, os, re, urllib.request
from collections import Counter, defaultdict
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "docs", "tools")

BAD_URL = re.compile(
    r"(arxiv\.org|doi\.org|dl\.acm\.org|springer|sciencedirect|wiley\.com|jstor|ieeexplore|researchgate|ssrn"
    r"|youtube\.com|youtu\.be|vimeo|medium\.com|\.pdf$|amazon\.|goodreads|slideshare|reddit\.com/r/|//t\.me/"
    r"|discord\.gg|facebook\.com/groups|linkedin\.com/in/|twitter\.com/[^/]+$|x\.com/[^/]+$|wikipedia\.org"
    r"|coursera|udemy|podcast|shields\.io|badge|travis-ci|img\.|\.png$|\.jpg$|\.svg$|\.gif$|creativecommons\.org"
    r"|awesome\.re|github\.com/sindresorhus/awesome|contributing|patreon|buymeacoffee|ko-fi|twitter\.com/intent)",
    re.I,
)
SKIP_CAT = re.compile(r"contents|contribut|license|table of|related|awesome lists|other lists|footnote|credits|support", re.I)
# Excluded by product policy (ROADMAP 3.5 / 3.8): offensive or abusive capability.
OFFENSIVE = re.compile(
    r"exploit|phish(?!tank)|ddos|stresser|booter|keylog|ransom|stalk|spyware|\brat\b|botnet|carding|\bdoxx?|"
    r"password crack|brute.?forc|credential stuff|sqlmap|metasploit|c2 framework|bypass 2fa|sms bomb|call bomb|swatting",
    re.I,
)
# public-apis categories with no investigative use (kept out to keep the catalog relevant).
IRRELEVANT_API_CATS = re.compile(r"^(Games & Comics|Sports & Fitness|Music|Food & Drink|Personality|Animals|Anime|Entertainment|Art & Design|Shopping|Calendar|Test Data|Jobs|Health|Events|Continuous Integration|Authentication & Authorization|Programming|APILayer APIs|APIs Covered Under APILayer Suite!|Learn more about Public APIs|Cloud Storage & File Sharing|Currency Exchange)$", re.I)
CORE_SOURCES = {"lockfale/OSINT-Framework", "jivoi/awesome-osint", "cipher387/osint_stuff_tool_collection", "Jieyab89/OSINT-Cheat-sheet",
                "Ph055a/OSINT_Collection", "tracelabs/awesome-osint", "osintambition/Social-Media-OSINT-Tools-Collection",
                "ItIsMeCall911/Awesome-Telegram-OSINT", "hslatman/awesome-threat-intelligence", "iipc/awesome-web-archiving"}
LINK = re.compile(r"\[([^\]]{1,120})\]\((https?://[^)\s]+)\)\s*[-\u2013\u2014:|]?\s*(.*)")

# (code, Arabic label, English label, regex). First match wins; order matters.
DOMAINS = [
    ("crypto", "العملات الرقمية وسلاسل الكتل", "Crypto & blockchain", r"crypto|bitcoin|blockchain|ethereum|wallet|\bbtc\b|\beth\b|nft|defi|monero|\bcoin"),
    ("darkweb", "الويب المظلم وTor", "Dark web & Tor", r"dark ?web|\btor\b|onion|i2p|deep ?web"),
    ("threat", "استخبارات التهديدات والبرمجيات الخبيثة", "Threat intel & malware", r"threat|malware|\bioc|virus|sandbox|phishtank|indicator|\bcve|vulnerab|stix|taxii|misp|yara|sigma|honeypot|abuse"),
    ("forensics", "الجنائيات الرقمية والاستجابة للحوادث", "Forensics & incident response", r"forensic|incident|memory|disk|timeline|evidence|dfir|volatility|artifact|log analysis|triage"),
    ("archive", "أرشفة الويب واللقطات", "Web archiving & snapshots", r"archiv|wayback|snapshot|warc|memento"),
    ("transport", "النقل: طيران وسفن ومركبات", "Transport: aviation, maritime, vehicles", r"flight|aircraft|aviation|plane|\bship|vessel|maritime|\bais\b|marine|vehicle|license plate|\bvin\b|train|railway|transport"),
    ("domain", "النطاقات وIP وDNS والشهادات", "Domains, IP, DNS & certificates", r"domain|\bdns\b|whois|\bip\b|\bips\b|ip address|subdomain|certificate|\bssl\b|\btls\b|\basn\b|bgp|network scan|\bport|shodan|censys|reverse ip|hosting|\burl"),
    ("geo", "الجغرافيا والخرائط والأقمار الصناعية", "Geospatial, maps & satellite", r"geo|\bmap|satellite|\bgis\b|location|coordinat|street ?view|earth|\bosm\b|openstreetmap|raster|lidar|remote sensing|spatial|imagery|weather|climate|elevation"),
    ("media", "الصور والفيديو والتحقق البصري", "Image, video & visual verification", r"image|photo|picture|video|exif|metadata|reverse search|face|deepfake|visual|camera|webcam|audio"),
    ("email_phone", "البريد الإلكتروني والهاتف", "Email & phone", r"e-?mail|phone|\bsms\b|\bcaller|telephon|mobile number|breach|leak|pwned"),
    ("social", "وسائل التواصل الاجتماعي والمراسلة", "Social media & messaging", r"social|twitter|\bx\b|facebook|instagram|tiktok|telegram|whatsapp|reddit|linkedin|youtube|snapchat|discord|vk\b|mastodon|threads|weibo|forum|messag"),
    ("people", "الأشخاص وأسماء المستخدمين", "People & usernames", r"people|person|username|user ?name|\bname\b|identity|profile|obituar|genealog|family|background check"),
    ("company", "الشركات والسجلات والعقود والعقوبات", "Companies, registries, contracts & sanctions", r"compan|business|corporate|registry|register|\bsec\b|financ|sanction|procure|tender|contract|court|legal|law|trademark|patent|offshore|beneficial|lobby|government|politic|tax|bank|stock|econom|trade|customs"),
    ("code", "الكود والمطورون والبنية التقنية", "Code, developers & tech stack", r"github|gitlab|\bcode\b|source|developer|repository|\bgit\b|programming|\bapi key|technolog|stack"),
    ("graph", "تحليل الشبكات والرسوم البيانية", "Network & graph analysis", r"graph|network analysis|centrality|gephi|cytoscape|networkx|igraph|link analysis|visuali[sz]|node|edge|community detection"),
    ("language", "العربية واللغويات والترجمة", "Arabic, linguistics & translation", r"arab|عرب|translat|language|\bnlp\b|linguist|dictionar|transliter|\bocr\b|speech|font|text"),
    ("documents", "الوثائق والبيانات المفتوحة", "Documents & open data", r"document|dataset|open data|data portal|\bfile|\bpdf|spreadsheet|statistic|census|librar|book|paper|research|scholar|academ"),
    ("news", "الأخبار والإعلام والتحقق من المعلومات", "News, media & fact-checking", r"news|journal|media|fact.?check|press|rss|broadcast|magazine|disinfo|misinfo"),
    ("search", "محركات البحث والاستعلام", "Search engines & dorking", r"search|engine|dork|query|find|lookup|discover"),
    ("automation", "أطر الأتمتة والجمع", "Automation & collection frameworks", r"framework|automat|scraper|crawl|spider|recon|collect|harvest|monitor|alert|workflow|pipeline"),
]
DOMAIN_RE = [(c, a, e, re.compile(r, re.I)) for c, a, e, r in DOMAINS]
DOMAIN_LABELS = {c: (a, e) for c, a, e, _ in DOMAINS}
DOMAIN_LABELS["general"] = ("عام ومتنوع", "General & miscellaneous")
DOMAIN_LABELS["public_api"] = ("واجهات برمجية عامة (اتصالات)", "Public APIs (connections)")
SENSITIVE = {"people", "email_phone", "social"}
SENSITIVE_KW = re.compile(r"people|person|face|username|phone|e-?mail|breach|leak|address|family|genealog|license plate|background check", re.I)


def norm(u):
    u = u.strip().rstrip("/").split("#")[0]
    p = urlparse(u)
    if p.scheme not in ("http", "https") or not p.netloc:
        return None
    h = p.netloc.lower()
    h = h[4:] if h.startswith("www.") else h
    return h + p.path.rstrip("/").lower() + (("?" + p.query) if p.query else "")


def fetch(src, cache):
    if src["kind"] == "curated":  # local, owner-curated additions (tools/catalog/curated.json)
        return open(os.path.join(ROOT, src["url"]), encoding="utf-8").read()
    path = os.path.join(cache, src["id"].replace("/", "__"))
    if os.path.exists(path):
        return open(path, encoding="utf-8", errors="ignore").read()
    with urllib.request.urlopen(src["url"], timeout=60) as r:
        data = r.read().decode("utf-8", "ignore")
    os.makedirs(cache, exist_ok=True)
    open(path, "w", encoding="utf-8").write(data)
    return data


class Collector:
    def __init__(self):
        self.rows, self.excluded = {}, Counter()

    def add(self, name, url, cat, desc, src, extra=None):
        if not url or BAD_URL.search(url):
            return
        k = norm(url)
        if not k:
            return
        name = re.sub(r"[`*_]", "", name).strip()
        if not name or len(name) > 120 or SKIP_CAT.search(cat or ""):
            return
        desc = re.sub(r"\s+", " ", desc or "").strip()[:240]
        if src == "public-apis/public-apis" and IRRELEVANT_API_CATS.search((cat or "").strip()):
            self.excluded["irrelevant_category"] += 1
            return
        if OFFENSIVE.search(f"{name} {desc} {cat}"):
            self.excluded["offensive_policy"] += 1
            return
        if k in self.rows:
            self.rows[k]["sources"].add(src)
            if not self.rows[k]["description"] and desc:
                self.rows[k]["description"] = desc
            return
        r = dict(name=name, url=url.strip(), source_category=(cat or "General").strip()[:100], description=desc, sources={src}, auth="", https="", cors="")
        if extra:
            r.update(extra)
        self.rows[k] = r


def parse_curated(col, data, src):
    for e in json.loads(data):
        col.add(e["name"], e["url"], e.get("cat", "General"), e.get("desc", ""), src)


def finalize(r):
    k = norm(r["url"])
    r["id"] = "TL-" + hashlib.sha1(k.encode()).hexdigest()[:8]
    r["sources"] = sorted(r["sources"])
    r["domain"] = classify(r, r["sources"] == ["public-apis/public-apis"])
    r["kind"] = kind_of(r)
    r["tier"] = "core" if CORE_SOURCES.intersection(r["sources"]) else "supporting"
    r["sensitivity"] = "natural_person_gate" if (r["domain"] in SENSITIVE or SENSITIVE_KW.search(f"{r['name']} {r['description']}")) else "standard"
    return r


def add_curated_offline(sources):
    """Merge tools/catalog/curated.json into the existing catalog without refetching the public lists.
    Only the new rows are link-checked; existing rows keep their previous status."""
    prev_path = os.path.join(OUT, "catalog.csv")
    old = list(csv.DictReader(open(prev_path, encoding="utf-8")))
    by_key = {norm(r["url"]): r for r in old}
    for r in old:
        r["sources"] = r["sources"].split(";") if r["sources"] else []
    src = next(s for s in sources if s["kind"] == "curated")
    col = Collector()
    parse_curated(col, fetch(src, None), src["id"])
    new = []
    for k, r in col.rows.items():
        if k in by_key:
            if src["id"] not in by_key[k]["sources"]:
                by_key[k]["sources"] = sorted(set(by_key[k]["sources"]) | {src["id"]})
            continue
        new.append(finalize(r))
    asyncio.run(check_all(new))
    for r in new:
        code = r.get("http", "")
        r["http"] = code
        r["link_status"] = link_status(code)
    stats = open(os.path.join(OUT, "STATS.md"), encoding="utf-8").read()
    excluded = Counter()
    for key, label in (("offensive_policy", "مستبعدة بسياسة المنتج"), ("irrelevant_category", "مستبعدة لعدم الصلة")):
        m = re.search(re.escape(label) + r"[^|]*\| (\d+)", stats)
        excluded[key] = int(m.group(1)) if m else 0
    rows = old + new
    rows.sort(key=lambda r: (r["domain"], r["name"].lower()))
    emit(rows, sources, excluded, checked=False)
    return new


def parse_tree(col, data, src):
    def walk(n, path):
        if n.get("type") == "url" and n.get("url"):
            col.add(n.get("name", ""), n["url"], " / ".join(p for p in path[1:] if p) or "General", "", src)
        for c in n.get("children") or []:
            walk(c, path + [n.get("name", "")])
    walk(json.loads(data), [])


def parse_md(col, data, src, table=False):
    cat = "General"
    for line in data.splitlines():
        s = line.strip()
        m = re.match(r"^#{1,6}\s+(.*)", s)
        if m:
            cat = re.sub(r"[\[\]()#*]|https?://\S+", "", m.group(1)).strip()[:80] or cat
            continue
        if table and s.startswith("|"):
            cells = [c.strip() for c in s.strip("|").split("|")]
            mm = re.match(r"\[([^\]]+)\]\((https?://[^)]+)\)", cells[0]) if cells else None
            if mm:
                col.add(mm.group(1), mm.group(2), cat, cells[1] if len(cells) > 1 else "", src,
                        dict(auth=(cells[2].strip("` ") if len(cells) > 2 else ""), https=(cells[3] if len(cells) > 3 else ""), cors=(cells[4] if len(cells) > 4 else "")))
            continue
        if s.startswith(("-", "*", "+", "|")) or re.match(r"^\d+\.", s):
            for m in LINK.finditer(s):
                d = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", m.group(3)).strip(" -|")
                col.add(m.group(1), m.group(2), cat, d, src)


def classify(r, src_is_api):
    hay = f"{r['source_category']} {r['name']} {r['description']}"
    for c, _, _, rx in DOMAIN_RE:
        if rx.search(hay):
            return c
    return "public_api" if src_is_api else "general"


def kind_of(r):
    p = urlparse(r["url"])
    host = p.netloc.lower()
    parts = [x for x in p.path.split("/") if x]
    if host in ("github.com", "gitlab.com", "codeberg.org", "bitbucket.org") and len(parts) >= 2:
        return "oss"
    if "public-apis/public-apis" in r["sources"] or re.search(r"\bapi\b", f"{r['name']} {r['description']}", re.I):
        return "api"
    if re.search(r"dataset|data portal|open data", f"{r['name']} {r['description']} {r['source_category']}", re.I):
        return "dataset"
    return "web"


def link_status(code):
    if isinstance(code, int):
        if 200 <= code < 400:
            return "reachable"
        if code in (401, 402, 403, 406, 429, 451, 999):
            return "restricted"
        return "unreachable"
    return "unreachable" if code else "unchecked"


async def check_all(rows, conc=150):
    import aiohttp
    sem = asyncio.Semaphore(conc)
    ua = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36 InvestigationRoomCatalog/1.0"}

    async def one(s, r):
        async with sem:
            for m in ("HEAD", "GET"):
                try:
                    async with s.request(m, r["url"], allow_redirects=True, timeout=aiohttp.ClientTimeout(total=12), ssl=False) as resp:
                        if m == "HEAD" and resp.status in (400, 403, 404, 405, 501):
                            continue
                        r["http"] = resp.status
                        return
                except Exception as e:  # noqa: BLE001 - network errors are data here
                    r["http"] = "ERR:" + type(e).__name__

    async with aiohttp.ClientSession(headers=ua, connector=aiohttp.TCPConnector(limit=200, limit_per_host=4)) as s:
        await asyncio.gather(*(one(s, r) for r in rows))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-check", action="store_true")
    ap.add_argument("--cache", default=os.path.join(HERE, ".cache"))
    ap.add_argument("--add-curated", action="store_true", help="merge curated.json into the existing catalog offline")
    a = ap.parse_args()
    sources = json.load(open(os.path.join(HERE, "sources.json"), encoding="utf-8"))
    if a.add_curated:
        for r in add_curated_offline(sources):
            print(r["id"], r["link_status"], r["http"], r["name"])
        return
    col = Collector()
    for src in sources:
        data = fetch(src, a.cache)
        if src["kind"] == "json-tree":
            parse_tree(col, data, src["id"])
        elif src["kind"] == "curated":
            parse_curated(col, data, src["id"])
        else:
            parse_md(col, data, src["id"], table=src["kind"] == "md-table")
    rows = []
    prev = {}
    prev_path = os.path.join(OUT, "catalog.csv")
    if os.path.exists(prev_path):
        for p in csv.DictReader(open(prev_path, encoding="utf-8")):
            prev[p["id"]] = p
    for k, r in col.rows.items():
        r["id"] = "TL-" + hashlib.sha1(k.encode()).hexdigest()[:8]
        r["sources"] = sorted(r["sources"])
        r["domain"] = classify(r, r["sources"] == ["public-apis/public-apis"])
        r["kind"] = kind_of(r)
        r["tier"] = "core" if CORE_SOURCES.intersection(r["sources"]) else "supporting"
        r["sensitivity"] = "natural_person_gate" if (r["domain"] in SENSITIVE or SENSITIVE_KW.search(f"{r['name']} {r['description']}")) else "standard"
        rows.append(r)
    if not a.no_check:
        asyncio.run(check_all(rows))
    else:
        for r in rows:
            if r["id"] in prev:
                r["http"] = prev[r["id"]].get("http", "")
    for r in rows:
        code = r.get("http", "")
        try:
            code = int(code)
        except (TypeError, ValueError):
            pass
        r["http"] = code
        r["link_status"] = link_status(code)
    rows.sort(key=lambda r: (r["domain"], r["name"].lower()))
    emit(rows, sources, col.excluded, checked=not a.no_check)


def md_escape(s):
    return (s or "").replace("|", "\\|").replace("\n", " ")


def emit(rows, sources, excluded, checked):
    os.makedirs(os.path.join(OUT, "domains"), exist_ok=True)
    today = datetime.date.today().isoformat()
    fields = ["id", "name", "url", "domain", "tier", "kind", "sensitivity", "link_status", "http", "auth", "https", "cors", "sources", "source_category", "description"]
    with open(os.path.join(OUT, "catalog.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: (";".join(r[k]) if k == "sources" else r.get(k, "")) for k in fields})
    by_dom = defaultdict(list)
    for r in rows:
        by_dom[r["domain"]].append(r)
    for d, items in by_dom.items():
        ar, en = DOMAIN_LABELS[d]
        lines = [f"# {ar} ({en})", "", f"> مُولَّد آلياً بواسطة `tools/catalog/build.py` بتاريخ {today}. لا تحرّر هذا الملف يدوياً.", "",
                 f"عدد الأدوات: **{len(items)}**. الإدراج هنا ترشيح لا اعتماد؛ انظر `docs/tools/README.md`.", "",
                 "| المعرّف | الأداة | الطبقة | النوع | الحساسية | حالة الرابط | المصادقة | الوصف |", "|---|---|---|---|---|---|---|---|"]
        for r in items:
            lines.append(f"| {r['id']} | [{md_escape(r['name'])}]({r['url']}) | {'أساسية' if r['tier']=='core' else 'داعمة'} | {r['kind']} | {'بوابة الأشخاص' if r['sensitivity'] != 'standard' else '—'} | {r['link_status']} | {md_escape(r.get('auth','')) or '—'} | {md_escape(r['description'])[:160] or '—'} |")
        open(os.path.join(OUT, "domains", f"{d}.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
    st = Counter(r["link_status"] for r in rows)
    kd = Counter(r["kind"] for r in rows)
    sens = Counter(r["sensitivity"] for r in rows)
    srcc = Counter(s for r in rows for s in r["sources"])
    usable = st["reachable"] + st["restricted"]
    L = ["# إحصاءات كتالوج الأدوات", "", f"> مُولَّد آلياً بتاريخ {today} (فحص الروابط: {'نعم' if checked else 'لا، أُعيد استعمال النتيجة السابقة'}). لا تحرّر يدوياً.", "",
         "| المقياس | القيمة |", "|---|---|",
         f"| إجمالي الأدوات الفريدة (بعد إزالة التكرار) | **{len(rows)}** |",
         f"| روابط تستجيب (2xx/3xx) | {st['reachable']} |",
         f"| روابط موجودة لكنها مقيّدة للفحص الآلي (401/403/429…) | {st['restricted']} |",
         f"| المجموع القابل للمتابعة (تستجيب + مقيّدة) | **{usable}** |",
         f"| روابط لم تستجب وقت الفحص | {st['unreachable']} |",
         f"| طبقة أساسية (من قوائم OSINT المتخصصة) | {Counter(r['tier'] for r in rows)['core']} |",
         f"| طبقة داعمة (واجهات وجغرافيا وتحليل شبكات وأمن) | {Counter(r['tier'] for r in rows)['supporting']} |",
         f"| مستبعدة بسياسة المنتج (أدوات هجومية أو مراقبة أشخاص) | {excluded['offensive_policy']} |",
         f"| مستبعدة لعدم الصلة (فئات واجهات ترفيهية وغيرها) | {excluded['irrelevant_category']} |",
         f"| موسومة ببوابة الأشخاص الطبيعيين | {sens['natural_person_gate']} |", "",
         "## حسب المجال", "", "| الرمز | المجال | العدد | الملف |", "|---|---|---|---|"]
    for d, items in sorted(by_dom.items(), key=lambda x: -len(x[1])):
        L.append(f"| `{d}` | {DOMAIN_LABELS[d][0]} | {len(items)} | [domains/{d}.md](domains/{d}.md) |")
    L += ["", "## حسب نوع الأداة", "", "| النوع | المعنى | العدد |", "|---|---|---|"]
    meaning = {"web": "خدمة ويب", "oss": "مستودع مفتوح المصدر", "api": "واجهة برمجية", "dataset": "مجموعة بيانات"}
    for k, v in kd.most_common():
        L.append(f"| `{k}` | {meaning.get(k, k)} | {v} |")
    L += ["", "## حسب القائمة المصدر", "", "| القائمة | الأدوات المأخوذة منها |", "|---|---|"]
    homes = {s["id"]: s["home"] for s in sources}
    for k, v in srcc.most_common():
        L.append(f"| [{k}]({homes.get(k, '#')}) | {v} |")
    open(os.path.join(OUT, "STATS.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
    print(json.dumps(dict(total=len(rows), usable=usable, status=st, kinds=kd, excluded=excluded), ensure_ascii=False, default=dict))


if __name__ == "__main__":
    main()
