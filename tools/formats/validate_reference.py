#!/usr/bin/env python3
"""P4-015 — freeze the OFFICIAL format validators' verdicts on the reference artifacts.

Three independent official checks, all frozen into
`fixtures/formats/validation-report.json` with each artifact's sha256:
- GEXF 1.3: lxml XSD validation against the official schema from the Gephi org
  (fixtures/formats/gexf-1.3.xsd — from gephi/gexf specs/1.3).
- GraphML 1.0: lxml XSD validation against the official graphdrawing.org schema
  (fixtures/formats/graphml-1.0.xsd).
- PROV: the official provtoolbox-python (`prov`) package parses the PROV-JSON
  (a full PROV-DM parse is the machine-checkable blessing).

CI never runs this script (no Python/lxml/prov there) — the committed report is
the reference of record; the CI tests prove the live exports are byte-identical
to these blessed artifacts.

Usage: python3 tools/formats/validate_reference.py [--check]
"""

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FX = ROOT / "fixtures" / "formats"


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def validate_gexf() -> dict:
    from lxml import etree

    schema = etree.XMLSchema(etree.parse(str(FX / "gexf-1.3.xsd")))
    doc = etree.parse(str(FX / "reference.gexf"))
    valid = schema.validate(doc)
    return {"valid": valid, "sha256": sha256_file(FX / "reference.gexf"), "errors": [str(e) for e in schema.error_log][:4]}


def validate_graphml() -> dict:
    from lxml import etree

    schema = etree.XMLSchema(etree.parse(str(FX / "graphml-1.0.xsd")))
    doc = etree.parse(str(FX / "reference.graphml"))
    valid = schema.validate(doc)
    return {"valid": valid, "sha256": sha256_file(FX / "reference.graphml"), "errors": [str(e) for e in schema.error_log][:4]}


def validate_prov() -> dict:
    from prov.model import ProvDocument

    doc = ProvDocument.deserialize(source=str(FX / "reference.prov.json"), format="json")
    # a full parse is the blessing; also count the records it resolved.
    # sha256 of the CANONICAL serialization (what the CI test produces via
    # JSON.stringify of the parsed object — key order preserved by both sides)
    canonical = json.dumps(json.loads((FX / "reference.prov.json").read_text(encoding="utf-8")), separators=(",", ":"), ensure_ascii=False)
    records = len(list(doc.get_records()))
    return {"valid": True, "sha256": hashlib.sha256(canonical.encode("utf-8")).hexdigest(), "records": records}


def main() -> int:
    report = {
        "gexf": validate_gexf(),
        "graphml": validate_graphml(),
        "prov": validate_prov(),
    }
    REPORT = FX / "validation-report.json"
    if "--check" in sys.argv:
        committed = json.loads(REPORT.read_text(encoding="utf-8"))
        if committed != report:
            print("formats validation report is stale (re-run the validators)", file=sys.stderr)
            return 1
        print("formats validation report is up to date")
        return 0
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"gexf={report['gexf']['valid']} graphml={report['graphml']['valid']} prov={report['prov']['valid']} -> {REPORT.relative_to(ROOT)}")
    return 0 if all(v["valid"] for v in report.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
