/**
 * P6-004: fuzz targets for the parsers — الكشف (core normalize) والاستيراد (interop import parsers).
 *
 * Each target is a fast-check property. A target FAILS the campaign when:
 *  1. the parser throws an unexpected error (anything that is not the module's declared
 *     validation error — plain `Error` or `NormalizeError`), or
 *  2. an invariant is violated (idempotence / roundtrip).
 *
 * Declared validation failures (bad input rejected with `Error`/`NormalizeError`) are
 * CORRECT behavior and pass. The canary target (--canary) proves the harness detects bugs.
 *
 * Targets import the TypeScript sources directly (tsx loader) — no build step, no drift
 * between what is fuzzed and what ships.
 */
import * as fc from "fast-check";

import * as core from "../../packages/core/src/normalize.ts";
import * as interopFtm from "../../packages/interop/src/ftm/ftm.ts";
import * as interopStix from "../../packages/interop/src/stix/stix.ts";
import * as interopIoc from "../../packages/interop/src/ioc/ioc.ts";
import * as interopCsv from "../../packages/interop/src/formats/csv.ts";

/** Parser modules declare their validation failures as plain Error / NormalizeError. */
function isExpected(e) {
  return e instanceof Error && (e.name === "Error" || e.name === "NormalizeError");
}

/** Run fn(); expected validation failures pass, unexpected throws crash, and the value is returned. */
function attempt(fn, onUnexpected) {
  try {
    return { threw: false, value: fn() };
  } catch (e) {
    if (!isExpected(e)) onUnexpected(e);
    return { threw: true };
  }
}

function invariant(name, raw, message) {
  return new Error(`INVARIANT ${name} broken for input ${JSON.stringify(raw)}: ${message}`);
}

/** Hostile-ish unicode: full grapheme range incl. bidi/invisible/digits, and hex-like strings. */
const HOSTILE_STRINGS = fc.oneof(
  fc.string({ unit: "grapheme", minLength: 0, maxLength: 120 }),
  fc.string({ unit: "binary", minLength: 0, maxLength: 120 }),
  fc.stringMatching(/^[0-9a-f]{1,40}$/),
);

/** Representative + arbitrary identifier types (normalize supports open-ended type ids). */
const TYPES = fc.oneof(
  fc.constantFrom(
    "domain",
    "ip",
    "url",
    "email",
    "phone",
    "iban",
    "as_number",
    "md5_hash",
    "sha256_hash",
    "bitcoin_address",
    "ethereum_address",
    "cosmos_address",
    "monero_address",
    "jwt_token",
    "ssh_public_key",
    "email_personal",
    "phone_number",
    "impassable_type",
    "passport_number",
    "twitter_user",
    "url_shortener",
  ),
  fc.stringMatching(/^[a-z][a-z0-9_.-]{0,20}$/),
);

/** Arbitrary JSON values for import parsers (unknown shape, hostile content). */
const JSON_VALUES = fc.jsonValue({ maxDepth: 4 });

export const TARGETS = [
  {
    name: "core.cleanText",
    arbitrary: HOSTILE_STRINGS,
    run(raw, onUnexpected) {
      const a = attempt(() => core.cleanText(raw), onUnexpected);
      if (a.threw) return;
      const b = attempt(() => core.cleanText(a.value), onUnexpected);
      if (b.threw || b.value !== a.value) throw invariant("cleanText idempotence", raw, "second pass differs or failed");
    },
  },
  {
    name: "core.asciiDigits",
    arbitrary: HOSTILE_STRINGS,
    run(raw, onUnexpected) {
      const a = attempt(() => core.asciiDigits(raw), onUnexpected);
      if (a.threw) return;
      const b = attempt(() => core.asciiDigits(a.value), onUnexpected);
      if (b.threw || b.value !== a.value) throw invariant("asciiDigits idempotence", raw, "second pass differs");
    },
  },
  {
    name: "core.normalize",
    arbitrary: fc.record({ type: TYPES, raw: HOSTILE_STRINGS }),
    run({ type, raw }, onUnexpected) {
      const a = attempt(() => core.normalize(type, raw), onUnexpected);
      if (a.threw) return; // rejected input is correct behavior
      const b = attempt(() => core.normalize(type, a.value), onUnexpected);
      if (b.threw) throw invariant("normalize idempotence", { type, raw }, `normalized value rejected on second pass`);
      if (b.value !== a.value) throw invariant("normalize idempotence", { type, raw }, "second pass differs");
    },
  },
  {
    name: "core.canonicalKey",
    arbitrary: fc.record({ type: TYPES, raw: HOSTILE_STRINGS }),
    run({ type, raw }, onUnexpected) {
      const a = attempt(() => core.canonicalKey(type, raw), onUnexpected);
      if (a.threw) return;
      const parsed = attempt(() => core.parseCanonicalKey(a.value), onUnexpected);
      if (parsed.threw) throw invariant("canonicalKey roundtrip", { type, raw }, "own key unparseable");
      if (parsed.value.type !== type || parsed.value.normalized !== a.value.slice(type.length + 1)) {
        throw invariant("canonicalKey roundtrip", { type, raw }, "parse does not return the original pair");
      }
    },
  },
  {
    name: "interop.ftmImport",
    arbitrary: fc.array(JSON_VALUES, { minLength: 0, maxLength: 8 }),
    run(entities, onUnexpected) {
      attempt(() => interopFtm.ftmImport(entities), onUnexpected);
    },
  },
  {
    name: "interop.stixImport",
    arbitrary: JSON_VALUES,
    run(bundle, onUnexpected) {
      attempt(() => interopStix.stixImport(bundle), onUnexpected);
    },
  },
  {
    name: "interop.mispImport",
    arbitrary: JSON_VALUES,
    run(event, onUnexpected) {
      attempt(() => interopIoc.mispImport(event), onUnexpected);
    },
  },
  {
    name: "interop.csvImport",
    arbitrary: fc.record({ nodesCsv: HOSTILE_STRINGS, edgesCsv: HOSTILE_STRINGS }),
    run(exported, onUnexpected) {
      attempt(() => interopCsv.csvImport(exported), onUnexpected);
    },
  },
];

/** P6-004 canary: proves the harness reports crashes (injected TypeError on a fixed input). */
export function canaryTarget() {
  return {
    name: "canary.FUZZ-CANARY",
    arbitrary: fc.constantFrom("FUZZ-CANARY", "not-the-canary"),
    run(value, onUnexpected) {
      if (value === "FUZZ-CANARY") onUnexpected(new TypeError("FUZZ-CANARY injected crash"));
    },
  };
}
