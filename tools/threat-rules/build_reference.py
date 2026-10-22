#!/usr/bin/env python3
"""P4-021 — build the frozen local YARA (YARA Forge) and Sigma (SigmaHQ) rule sets.

The rules of record for the local threat scanning transforms (TR-092 YARA,
TR-093 Sigma) are GENERATED modules, extracted from the OFFICIAL sources:

- YARA: the YARA Forge core pack (YARAHQ/yara-forge release 20261018,
  `yara-forge-rules-core.zip`). Rules are frozen as their RAW TEXT — the
  TypeScript subset parser must parse every one of them (a test enforces it;
  a rule using syntax the engine does not support fails that test, never
  silently mis-evaluates).
- Sigma: official SigmaHQ rules (SigmaHQ/Sigma, rules/windows/process_creation),
  converted here to the documented normalized form (the faithful conversion is
  this tool's; the runtime evaluates the normalized form only).

Everything runs OFFLINE at runtime: the generated modules are bundled. This
tool only (re)builds them; `--check` verifies a fresh extraction reproduces
the committed files byte-for-byte. CI never runs this.

Usage: python3 tools/threat-rules/build_reference.py [--check]
"""

import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
YARA_OUT = ROOT / "packages" / "transforms" / "src" / "yara" / "rules.generated.ts"
SIGMA_OUT = ROOT / "packages" / "transforms" / "src" / "sigma" / "rules.generated.ts"

YARA_FORGE_URL = (
    "https://github.com/YARAHQ/yara-forge/releases/download/20261018/yara-forge-rules-core.zip"
)
SIGMA_BASE = "https://raw.githubusercontent.com/SigmaHQ/Sigma/master/rules/windows/process_creation/"

# The documented YARA subset the engine supports; a rule outside it is REJECTED
# here (and would fail the TS parse test). Subset: text strings with
# nocase/wide/ascii/fullword, hex strings with ?? wildcards only, conditions
# built from $refs / filesize / uint8|16|32 / all|any|N of them / at / and or not.
YARA_MAX_RULES = 20

# The documented Sigma rules frozen (official SigmaHQ paths).
SIGMA_FILES = [
    "proc_creation_win_7zip_password_compression.yml",
    "proc_creation_win_acccheckconsole_execution.yml",
    "proc_creation_win_7zip_exfil_dmp_files.yml",
    "proc_creation_win_addinutil_uncommon_cmdline.yml",
    "proc_creation_win_adplus_memory_dump.yml",
    "proc_creation_win_agentexecutor_potential_abuse.yml",
]

SIGMA_MODIFIERS = {"", "contains", "startswith", "endswith"}


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


# ---------------------------------------------------------------- YARA

HEX_STRING = re.compile(r"^\{\s*([0-9A-Fa-f?]{2}(\s*))*[0-9A-Fa-f?]{2}\s*\}$")
TEXT_STRING = re.compile(r'^"(?:[^"\\]|\\.)*"$')
KNOWN_MODIFIERS = {"nocase", "wide", "ascii", "fullword"}

CONDITION_TOKEN = re.compile(r"\$?\w+|==|!=|<=|>=|<|>|\(|\)|[0-9]+|0x[0-9A-Fa-f]+|.")
CONDITION_WORDS = {
    "and", "or", "not", "filesize", "of", "them", "all", "any", "at",
    "uint8", "uint16", "uint32", "uint8be", "uint16be", "uint32be", "true", "false",
}


def validate_condition(cond: str) -> bool:
    cond = " ".join(cond.split())
    if not cond:
        return False
    depth = 0
    for tok in CONDITION_TOKEN.findall(cond):
        if tok in ("(",):
            depth += 1
        elif tok in (")",):
            depth -= 1
            if depth < 0:
                return False
        elif re.fullmatch(r"0x[0-9A-Fa-f]+|[0-9]+(KB|MB)?", tok, re.I):
            continue
        elif tok in ("==", "!=", "<=", ">=", "<", ">", "*",):
            continue
        elif re.fullmatch(r"[\w.$*]+", tok):
            if "." in tok:  # module references (pe., hash., ...) — unsupported
                return False
            if tok.startswith("$") or tok.lstrip("$") in CONDITION_WORDS:
                continue
            return False
        else:
            return False
    return depth == 0


def split_rules(pack_text: str) -> list:
    """Split a .yar pack into (name, full_rule_text) pairs: top-level rules are
    separated by their own `^rule ` line — anything between two rule lines is
    that rule's text (import/include headers are excluded by the subset check)."""
    lines = pack_text.split("\n")
    starts = [i for i, l in enumerate(lines) if re.match(r"^rule\s+\w+", l)]
    rules = []
    for k, i in enumerate(starts):
        end = starts[k + 1] if k + 1 < len(starts) else len(lines)
        m = re.match(r"^rule\s+(\w+)", lines[i])
        rules.append((m.group(1), "\n".join(lines[i:end])))
    return rules


def rule_in_subset(text: str) -> bool:
    """Structural validation against the engine's documented subset."""
    # strings: only text/hex with known modifiers
    strings = re.search(r"strings:\s*(.*?)\n\s*condition:", text, re.S)
    if not strings:
        return False
    # scan each `$id = value modifiers` definition; values are quoted text or
    # (possibly multi-line) braced hex
    defs = re.findall(
        r"\$(\w+)\s*=\s*(\"(?:[^\"\\]|\\.)*\"|\{.*?\})((?:\s+\w+)*)\s*(?=\$|\Z)",
        strings.group(1),
        re.S,
    )
    if not defs:
        return False
    for _sid, value, mods in defs:
        if value.startswith("{"):
            if not HEX_STRING.match(" ".join(value.split())):
                return False
        elif not TEXT_STRING.match(value):
            return False
        if any(mod not in KNOWN_MODIFIERS for mod in mods.split()):
            return False
    cond = re.search(r"condition:\s*(.*?)\n?\s*\}", text, re.S)
    if not cond or not validate_condition(cond.group(1)):
        return False
    # no imports, no global/private rules, no nested blocks beyond the two
    if re.search(r"^\s*(import|include|global|private)\b", text, re.M):
        return False
    return True


def build_yara() -> list:
    z = zipfile.ZipFile(_write_tmp(fetch(YARA_FORGE_URL)))
    name = next(n for n in z.namelist() if n.endswith(".yar"))
    pack = z.read(name).decode("utf-8", errors="replace")
    out = []
    for rule_name, text in split_rules(pack):
        if len(out) >= YARA_MAX_RULES:
            break
        if rule_in_subset(text):
            out.append({"name": rule_name, "text": text})
    if len(out) < YARA_MAX_RULES:
        raise SystemExit(f"YARA subset too small: {len(out)}")
    return out


def _write_tmp(data: bytes) -> str:
    import tempfile

    p = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    p.write(data)
    p.close()
    return p.name


# ---------------------------------------------------------------- Sigma


def normalize_sigma(rule: dict) -> dict:
    """Convert an official Sigma rule to the documented normalized form."""
    detection = rule.get("detection") or {}
    condition = str(detection.get("condition", "")).strip()
    selections = []
    for name, body in detection.items():
        if name == "condition":
            continue
        alternatives = body if isinstance(body, list) else [body]
        alts = []
        for alt in alternatives:
            matchers = []
            for field_spec, values in (alt or {}).items():
                field, _, modifier = field_spec.partition("|")
                if modifier not in SIGMA_MODIFIERS:
                    raise SystemExit(f"unsupported Sigma modifier: {field_spec}")
                if not isinstance(values, list):
                    values = [values]
                matchers.append({
                    "field": str(field),
                    "modifier": modifier or "is",
                    "values": [str(v) for v in values],
                })
            alts.append({"matchers": matchers})
        selections.append({"name": str(name), "alternatives": alts})
    # condition: `X` / `X and not Y` where X/Y are (all|1|N) of <prefix>* or a
    # plain `sel_a and sel_b` conjunction. The `not` term is a filter (excluded).
    cond_kind = None
    terms = [t.strip() for t in condition.split(" and ")]
    excludes = []
    core = None
    for term in terms:
        negated = term.startswith("not ")
        term = term[4:] if negated else term
        m = re.fullmatch(r"(all|1|\d+) of (\w+)\*", term)
        if m:
            node = {
                "kind": ("all-of-prefix" if m.group(1) == "all" else "any-of-prefix"),
                "prefix": m.group(2),
                "minCount": (None if m.group(1) in ("all", "1") else int(m.group(1))),
            }
            if negated:
                excludes.append(node)
                continue
            core = node
            continue
        elif not negated and set(re.findall(r"\w+", term)) <= {s["name"] for s in selections}:
            core = {"kind": "all-named", "names": re.findall(r"\w+", term)}
            continue
        raise SystemExit(f"unsupported Sigma condition: {condition!r} (term {term!r})")
    cond_kind = {**(core or {}), "excludes": excludes}
    return {
        "id": str(rule.get("id", "")),
        "title": str(rule.get("title", "")),
        "level": str(rule.get("level", "medium")),
        "tags": [str(x) for x in rule.get("tags", []) or []],
        "logsource": rule.get("logsource") or {},
        "selections": selections,
        "condition": cond_kind,
    }


def build_sigma() -> list:
    out = []
    for fname in SIGMA_FILES:
        rule = yaml.safe_load(fetch(SIGMA_BASE + fname))
        out.append(normalize_sigma(rule))
    return out


# ---------------------------------------------------------------- emit


def emit(path: Path, header: str, const: str, payload) -> None:
    text = (
        "// GENERATED by tools/threat-rules/build_reference.py — do not edit by hand.\n"
        + header
        + f"\nexport const {const} = "
        + json.dumps(payload, indent=2, ensure_ascii=False)
        + " as const;\n"
    )
    if "--check" in sys.argv:
        if path.read_text(encoding="utf-8") != text:
            print(f"{path.name} is stale (re-run the extraction)", file=sys.stderr)
            sys.exit(1)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def main() -> int:
    yara = build_yara()
    sigma = build_sigma()
    emit(
        YARA_OUT,
        "// The frozen YARA Forge core rules (release 20261018) — RAW rule text;\n"
        "// the engine's subset parser must parse every one (a test enforces it).",
        "YARA_FORGE_RULES",
        yara,
    )
    emit(
        SIGMA_OUT,
        "// The frozen official SigmaHQ rules, converted to the documented normalized\n"
        "// form (tools/threat-rules/build_reference.py); the runtime evaluates this form.",
        "SIGMA_RULES",
        sigma,
    )
    if "--check" in sys.argv:
        print("threat rules are up to date")
        return 0
    print(f"wrote {YARA_OUT.relative_to(ROOT)} ({len(yara)} rules) and {SIGMA_OUT.relative_to(ROOT)} ({len(sigma)} rules)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
