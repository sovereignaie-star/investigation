#!/usr/bin/env python3
"""P4-013 — frozen FollowTheMoney model reference for the FtM interop module.

Distills the schemas the interop mapping uses from the REAL FtM model (the
`followthemoney` wheel's own YAML schema files — no re-derivation by hand) into
`fixtures/ftm/model-ref.json`. The committed fixture is the reference of
record: the test suite validates every exported entity's schema and property
names against it (structural validation — the runtime Python library is not a
CI dependency; documented in DECLARED_LIMITS).

Usage: python3 tools/ftm/model_reference.py [--check]
  --check  verify the committed fixture matches a fresh extraction (exit 1)

The wheel is fetched with pip download (pinned version, no deps) into a
temporary directory — nothing is installed into the environment.
"""

import io
import json
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "fixtures" / "ftm" / "model-ref.json"
FOLLOWTHEMONEY = "4.11.1"

# The schemas the interop mapping touches. The fixture includes the mapping
# set AND its full transitive `extends` closure (computed from the wheel itself
# below — never hand-listed: a missed parent would fail the importer's
# fail-closed walk, which is exactly what a manual list caused once).
# AS MEASURED against the real FtM 4.11.1 model: there is NO Domain/IpAddress/
# Phone schema in the model (they are property types there, not entities), so
# those stay unmapped (honest limit — see the module docs, DECLARED_LIMITS L-60).
MAPPING_SET = [
    # node schemas
    "Person", "Company", "Email", "CryptoWallet",
    # edge schemas
    "Ownership", "Directorship", "Membership",
    "Associate", "Family", "UnknownLink",
]


def load_yaml(fh):
    """Parse one schema file with PyYAML (a local-only tool dependency).

    CI never runs this script — the committed fixture is the reference of
    record — so PyYAML being absent from CI is fine (documented in --help
    here and in DECLARED_LIMITS).
    """
    try:
        import yaml  # type: ignore
    except ImportError:
        raise SystemExit(
            "PyYAML is required locally to regenerate the model reference "
            "(pip install pyyaml). CI never runs this script — the committed "
            "fixture is the reference of record."
        )
    return yaml.safe_load(fh)


def fetch_wheel(tmp):
    import subprocess

    subprocess.run(
        [
            sys.executable, "-m", "pip", "download", "--no-deps", "--quiet",
            f"followthemoney=={FOLLOWTHEMONEY}", "-d", str(tmp),
        ],
        check=True,
    )
    wheels = list(Path(tmp).glob("*.whl"))
    assert len(wheels) == 1, wheels
    return wheels[0]


def main():
    with tempfile.TemporaryDirectory() as tmp:
        wheel = fetch_wheel(tmp)
        with zipfile.ZipFile(wheel) as z:
            # transitive extends closure of the mapping set (from the wheel itself —
            # never hand-listed: a missed parent would fail the importer's
            # fail-closed walk, which is exactly what a manual list caused once)
            schemas = list(MAPPING_SET)
            i = 0
            while i < len(schemas):
                name = schemas[i]
                doc = load_yaml(io.BytesIO(z.read(f"followthemoney/schema/{name}.yaml")))[name]
                for parent in doc.get("extends", []):
                    if parent not in schemas:
                        schemas.append(parent)
                i += 1
            ref = {}
            for name in schemas:
                member = f"followthemoney/schema/{name}.yaml"
                raw = z.read(member)
                doc = load_yaml(io.BytesIO(raw))
                schema = doc[name]
                props = {}
                for pname, pdef in (schema.get("properties") or {}).items():
                    props[pname] = {
                        "type": pdef.get("type", "string"),
                        **({"range": pdef["range"]} if "range" in pdef else {}),
                    }
                ref[name] = {
                    "extends": schema.get("extends", []),
                    "properties": props,
                    "required": schema.get("required", []),
                    **({"edge": schema["edge"]} if "edge" in schema else {}),
                }

    fixture = {
        "source": f"followthemoney=={FOLLOWTHEMONEY} (wheel schema YAML)",
        "generator": "tools/ftm/model_reference.py",
        "schemas": ref,
    }

    if "--check" in sys.argv:
        committed = json.loads(OUT.read_text(encoding="utf-8"))
        if committed != fixture:
            print("ftm model reference fixture is stale", file=sys.stderr)
            return 1
        print("ftm model reference fixture is up to date")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(ref)} schemas)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
