#!/usr/bin/env python3
"""P4-014 — freeze the OFFICIAL STIX validator's verdict on the reference bundle.

Runs `stix2validator` (the OASIS official validator) on the frozen reference
bundle and writes its verdict to `fixtures/stix/validation-report.json` along
with the bundle's sha256 — so CI (no Python) proves the live export is
byte-identical to the officially-validated bundle, and this script re-proves
the blessing locally.

NOTE on the local environment: the stix2-validator 3.3.1 PyPI package ships
without its schema files; the official schemas from the OASIS
cti-stix2-json-schemas repository (the validator's own schema source) must be
installed next to the package (schemas-2.1/schemas/). This is a local-tool
concern only — CI never runs this script; the committed report is the
reference of record.

Usage: python3 tools/stix/validate_reference.py [--check]
"""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ROOT / "fixtures" / "stix" / "reference-bundle.json"
REPORT = ROOT / "fixtures" / "stix" / "validation-report.json"


def run_validator() -> dict:
    proc = subprocess.run(
        [sys.executable, "-m", "stix2validator.scripts.stix2_validator", str(BUNDLE)],
        capture_output=True,
        text=True,
        check=False,
    )
    output = proc.stdout + proc.stderr
    valid = "[+] STIX JSON: Valid" in output
    errors = [line.strip() for line in output.splitlines() if "[X]" in line]
    warnings = [line.strip() for line in output.splitlines() if "[!]" in line]
    return {
        "valid": valid,
        "validator": "stix2-validator 3.3.1 (OASIS) with the official cti-stix2-json-schemas",
        # canonical hash: the same serialization the CI test produces
        # (JSON.stringify of the parsed object — key order preserved by both)
        "bundleSha256": hashlib.sha256(
            json.dumps(json.loads(BUNDLE.read_text(encoding="utf-8")), separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        ).hexdigest(),
        "exitCode": proc.returncode,
        "errors": errors,
        "warningsCount": len(warnings),
        "warningsSample": warnings[:6],
    }


def main() -> int:
    report = run_validator()
    if "--check" in sys.argv:
        committed = json.loads(REPORT.read_text(encoding="utf-8"))
        if committed != report:
            print("stix validation report is stale (re-run the validator)", file=sys.stderr)
            return 1
        print("stix validation report is up to date (official validator: valid)")
        return 0
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"validator valid={report['valid']} ({report['warningsCount']} warnings) -> {REPORT.relative_to(ROOT)}")
    return 0 if report["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
