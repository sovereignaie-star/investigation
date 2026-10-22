#!/usr/bin/env python3
"""P4-020 — build the frozen local ATT&CK/CAPEC/D3FEND knowledge bundle.

The knowledge base of record for `@ir/interop/attack` is the GENERATED module
`packages/interop/src/attack/knowledge.generated.ts` (this file, emitted as TypeScript
so it typechecks and esbuild inlines it into the server bundle — runtime is offline
by construction) — a small STIX 2.1 bundle extracted from the
OFFICIAL sources (no third-party conversions of record):

- MITRE ATT&CK: the official STIX bundle (mitre-attack/attack-stix-data,
  enterprise-attack-20.0) — the attack-pattern objects are copied VERBATIM
  (subset by technique id; kill_chain_phases carry the tactics).
- MITRE CAPEC: the official XML (capec.mitre.org) — converted to STIX
  attack-pattern SDOs (id/name/description + external_reference CAPEC-n);
  CAPEC has no kill-chain tactics, so none are invented.
- MITRE D3FEND: the official ontology (d3fend/d3fend-ontology TTL) — converted
  to STIX course-of-action SDOs (defensive techniques; D3- ids).

Everything runs OFFLINE at runtime: the frozen bundle is the data; this tool
only (re)builds it. `--check` verifies a fresh extraction reproduces the
committed file byte-for-byte. CI never runs this (it pins the fixture; the
module tests prove the parser against it).

Usage: python3 tools/attack/build_reference.py [--check]
"""

import json
import sys
import urllib.request
import uuid
from pathlib import Path

from lxml import etree

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "packages" / "interop" / "src" / "attack" / "knowledge.generated.ts"

ATTACK_URL = (
    "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/"
    "enterprise-attack/enterprise-attack-20.0.json"
)
CAPEC_URL = "https://capec.mitre.org/data/xml/capec_latest.xml"
D3FEND_URL = (
    "https://raw.githubusercontent.com/d3fend/d3fend-ontology/master/"
    "src/ontology/d3fend-protege.ttl"
)

# The documented subsets (technique ids) — small on purpose: the frozen bundle is
# the local knowledge base, not a mirror of the full matrices.
ATTACK_IDS = {
    "T1566", "T1566.001", "T1059", "T1059.001", "T1071", "T1071.004", "T1041", "T1583.001",
}
CAPEC_IDS = {"112", "148", "662", "664"}
D3FEND_IDS = {"D3-AA", "D3-ACA", "D3-AM", "D3-AMED"}


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def ir_uuid5(kind: str, external_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"ir/{kind}/{external_id}"))


def attack_objects() -> list:
    bundle = json.loads(fetch(ATTACK_URL))
    out = []
    for o in bundle["objects"]:
        if o.get("type") != "attack-pattern":
            continue
        ids = {r.get("external_id") for r in o.get("external_references", [])}
        if ids & ATTACK_IDS:
            out.append(o)
    found = set()
    for o in out:
        found |= {r.get("external_id") for r in o.get("external_references", [])} & ATTACK_IDS
    missing = ATTACK_IDS - found
    if missing:
        raise SystemExit(f"ATT&CK subset incomplete: {sorted(missing)}")
    return out


def capec_objects() -> list:
    ns = {"c": "http://capec.mitre.org/capec-3"}
    tree = etree.fromstring(fetch(CAPEC_URL))
    out = []
    for p in tree.findall(".//c:Attack_Pattern", ns):
        if p.get("ID") not in CAPEC_IDS:
            continue
        cid = p.get("ID")
        out.append(
            {
                "type": "attack-pattern",
                "spec_version": "2.1",
                "id": f"attack-pattern--{ir_uuid5('capec', cid)}",
                "name": p.get("Name"),
                "description": (p.findtext("c:Description", namespaces=ns) or "").strip(),
                "created": "2026-10-22T00:00:00.000Z",
                "modified": "2026-10-22T00:00:00.000Z",
                "created_by_ref": "identity--ir-knowledge-base",
                "external_references": [
                    {
                        "source_name": "capec",
                        "external_id": f"CAPEC-{cid}",
                        "url": f"https://capec.mitre.org/data/definitions/{cid}.html",
                    }
                ],
            }
        )
    if len(out) != len(CAPEC_IDS):
        raise SystemExit("CAPEC subset incomplete")
    return out


def d3fend_objects() -> list:
    ttl = fetch(D3FEND_URL).decode("utf-8")
    out = []
    for did in sorted(D3FEND_IDS):
        # the class block carrying this d3fend-id: label + definition follow in the same block
        marker = f':d3fend-id "{did}"'
        i = ttl.find(marker)
        if i < 0:
            raise SystemExit(f"D3FEND id {did} not found")
        block = ttl[i : i + 4000]
        label_i = block.find('rdfs:label "')
        label = block[label_i + len('rdfs:label "') : block.find('"', label_i + len('rdfs:label "'))]
        def_i = block.find(':definition "')
        definition = block[def_i + len(':definition "') : block.find('"', def_i + len(':definition "'))]
        out.append(
            {
                "type": "course-of-action",
                "spec_version": "2.1",
                "id": f"course-of-action--{ir_uuid5('d3fend', did)}",
                "name": label,
                "description": definition,
                "created": "2026-10-22T00:00:00.000Z",
                "modified": "2026-10-22T00:00:00.000Z",
                "created_by_ref": "identity--ir-knowledge-base",
                "external_references": [
                    {
                        "source_name": "d3fend",
                        "external_id": did,
                        "url": f"https://d3fend.mitre.org/technique/{did}",
                    }
                ],
            }
        )
    return out


def main() -> int:
    objects = attack_objects() + capec_objects() + d3fend_objects()
    objects.sort(key=lambda o: (o["type"], o["id"]))
    bundle = {
        "type": "bundle",
        "id": "bundle--ir-attack-knowledge",
        "spec_version": "2.1",
        "objects": objects,
    }
    text = (
        "// GENERATED by tools/attack/build_reference.py — do not edit by hand.\n"
        "// The frozen local ATT&CK/CAPEC/D3FEND knowledge bundle (official sources; --check verified).\n"
        "export const ATTACK_KNOWLEDGE_BUNDLE = "
        + json.dumps(bundle, indent=2, ensure_ascii=False)
        + " as const;\n"
    )
    if "--check" in sys.argv:
        committed = OUT.read_text(encoding="utf-8")
        if committed != text:
            print("attack knowledge bundle is stale (re-run the extraction)", file=sys.stderr)
            return 1
        print("attack knowledge bundle is up to date")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(objects)} objects)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
