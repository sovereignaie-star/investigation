import { describe, expect, it } from "vitest";
import { canonicalKey, normalize, NormalizeError, parseCanonicalKey } from "./index.ts";

/** The pre-P1-007 node id from apps/web smartInvestigator.ts, kept here to show D-021. */
const legacyNodeId = (value: string, type: string) => `${type}:${value}`.replace(/[^a-zA-Z0-9:\-_.]/g, "_").slice(0, 64);

describe("canonicalKey: equivalent spellings share one key (D-020)", () => {
  const same: Array<[string, string[]]> = [
    ["domain", ["example.com", "Example.COM", " example.com. ", "exa\u200Bmple.com", "ｅｘａｍｐｌｅ.com"]],
    ["domain", ["xn--mgbh0fb.xn--kgbechtv", "مثال.إختبار"]],
    ["email", ["info@example.com", "INFO@Example.com", " info@EXAMPLE.com\u200F"]],
    ["email_corporate", ["a@b.co", "A@B.CO"]],
    ["url", ["https://Example.com:443/a?b=1#top", "HTTPS://example.com/a?b=1"]],
    ["url", ["example.com/x", "http://example.com/x"]],
    ["ipv4", ["8.8.8.8", " 008.008.008.008 "]],
    ["ipv6", ["2001:DB8:0:0:0:0:0:1", "2001:db8::1", "[2001:db8::1]"]],
    ["cidr", ["10.0.0.0/08", "10.0.0.0/8"]],
    ["asn", ["AS13335", "as13335", "13335"]],
    ["mac_address", ["00-1A-2B-3C-4D-5E", "001a.2b3c.4d5e", "00:1a:2b:3c:4d:5e"]],
    ["phone_sa", ["+966 50 123 4567", "00966501234567", "+٩٦٦٥٠١٢٣٤٥٦٧", "(+966) 50-123-4567"]],
    ["ethereum_address", ["0x52908400098527886E0F7030069857D2E4169EE7", "0x52908400098527886e0f7030069857d2e4169ee7"]],
    [
      "sha256_hash",
      [
        "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      ],
    ],
    ["iban", ["sa03 8000 0000 6080 1016 7519", "SA0380000000608010167519"]],
    ["credit_card", ["4111-1111-1111-1111", "4111 1111 1111 1111"]],
    ["twitter_username", ["@Jack", "jack"]],
    ["mastodon_handle", ["@Gargron@Mastodon.social", "gargron@mastodon.social"]],
    ["bitcoin_address_bech32", ["BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"]],
    ["text", ["محمد   بن  عبدالله", " محمد بن عبدالله "]],
  ];
  for (const [type, variants] of same) {
    it(`${type}: ${variants[0]}`, () => {
      const keys = new Set(variants.map((v) => canonicalKey(type, v)));
      expect([...keys]).toHaveLength(1);
    });
  }

  it("produces the expected canonical forms", () => {
    expect(canonicalKey("domain", "مثال.إختبار")).toBe("domain:xn--mgbh0fb.xn--kgbechtv");
    expect(canonicalKey("url", "https://Example.com:443/a?b=1#top")).toBe("url:https://example.com/a?b=1");
    expect(canonicalKey("phone_sa", "+٩٦٦٥٠١٢٣٤٥٦٧")).toBe("phone_sa:+966501234567");
    expect(canonicalKey("ipv6", "2001:DB8:0:0:0:0:0:1")).toBe("ipv6:2001:db8::1");
    expect(canonicalKey("asn", "as13335")).toBe("asn:AS13335");
  });
});

describe("canonicalKey: different identifiers never share a key (D-021)", () => {
  it("keeps case where the encoding is case-sensitive", () => {
    expect(canonicalKey("bitcoin_address", "1BoatSLRHtKNngkdXEeobR76b53LETtpyT")).not.toBe(
      canonicalKey("bitcoin_address", "1boatslrhtknngkdxeeobr76b53lettpyt"),
    );
    expect(normalize("github_token_classic", "ghp_AbC")).toBe("ghp_AbC");
  });

  it("does not collide where the legacy id did", () => {
    const longA = "https://example.com/very/long/path/that/goes/on/and/on/and/on/page-1";
    const longB = "https://example.com/very/long/path/that/goes/on/and/on/and/on/page-2";
    expect(legacyNodeId(longA, "url")).toBe(legacyNodeId(longB, "url")); // truncation at 64
    expect(canonicalKey("url", longA)).not.toBe(canonicalKey("url", longB));
    expect(legacyNodeId("a+b@x.com", "email")).toBe(legacyNodeId("a/b@x.com", "email")); // substitution
    expect(canonicalKey("email", "a+b@x.com")).not.toBe(canonicalKey("email", "a/b@x.com"));
    expect(canonicalKey("domain", "example.com")).not.toBe(canonicalKey("hostname", "example.com")); // type is part of the key
  });

  it("round-trips through parseCanonicalKey, including values that contain ':'", () => {
    const key = canonicalKey("ipv6", "2001:db8::1");
    expect(parseCanonicalKey(key)).toEqual({ type: "ipv6", normalized: "2001:db8::1" });
    expect(() => parseCanonicalKey("nocolon")).toThrow(TypeError);
  });
});

describe("normalize rejects values that cannot be the type", () => {
  const bad: Array<[string, string]> = [
    ["ipv4", "256.1.1.1"],
    ["ipv4", "1.2.3"],
    ["ipv6", "not-ip"],
    ["email", "no-at-sign"],
    ["domain", "exa mple.com"],
    ["mac_address", "00:11:22"],
    ["ethereum_address", "0x1234"],
    ["bitcoin_address_bech32", "bc1QAR0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"],
    ["phone_intl", "+12"],
    ["asn", "AS99999999999"],
    ["domain", "   \u200B "],
    ["Bad Type", "x"],
  ];
  for (const [type, raw] of bad) {
    it(`${type}: ${JSON.stringify(raw)}`, () => expect(() => normalize(type, raw)).toThrow(NormalizeError));
  }
});

describe("P6-004 — idempotence under hostile unicode (fuzz finding)", () => {
  // found by the fuzz campaign: normalize("iban", "ῒ") returned a decomposed
  // sequence whose second pass recomposed — normalize(normalize(x)) !== normalize(x).
  it("upperCompact types are idempotent on non-ASCII input (IBAN counterexample)", () => {
    const once = normalize("iban", "\u1FD2"); // Greek iota with dialytika and tonos
    const twice = normalize("iban", once);
    expect(twice).toBe(once);
  });

  it("mrz_line is idempotent on non-ASCII input", () => {
    const once = normalize("mrz_line", "\u1FD2");
    expect(normalize("mrz_line", once)).toBe(once);
  });
});

describe("P6-004 — second fuzz finding: ideographic full stop (U+3002) in domains", () => {
  // found by the fuzz campaign (counterexample [{"type":"domain","raw":"。"}]):
  // the WHATWG URL parser maps U+3002 (and U+FF0E, U+FF61) to the ASCII dot, but
  // normalizeHost only stripped an ASCII trailing dot, so "x。" normalized to "x."
  // and "。" normalized to "." — both violate idempotence and "." is not a hostname.
  it("domain: ideographic separators normalize to ASCII dots, idempotently", () => {
    for (const raw of ["x\u3002", "x\uFF0E", "x\uFF61", "a\u3002b\u3002c"]) {
      const once = normalize("domain", raw);
      expect(normalize("domain", once)).toBe(once);
    }
  });

  it("domain: a lone ideographic separator is rejected (not a hostname)", () => {
    for (const raw of ["\u3002", "\uFF0E", "\uFF61"]) {
      expect(() => normalize("domain", raw)).toThrow(NormalizeError);
    }
  });

  it("domain: trailing-dot runs are stripped whole, idempotently (a second campaign finding)", () => {
    // ".." — found by re-running the campaign after the first fix: one strip left "."
    // which the second pass rejected. A hostname has no trailing dots, strip them all.
    for (const raw of ["x..", "x\u3002\uFF0E"]) {
      const once = normalize("domain", raw);
      expect(normalize("domain", once)).toBe(once);
    }
    expect(() => normalize("domain", "..")).toThrow(NormalizeError);
  });
});
describe("P6-026 — fuzz finding #5: prototype-member type ids must not hit Object.prototype", () => {
  // found by the 24h acceptance campaign (run 40085338964, 4 chunks, counterexample
  // [{"type":"constructor","raw":"!"}]): EXACT is a plain object, so EXACT["constructor"]
  // returned Object.prototype.constructor (truthy) instead of undefined — normalize then
  // "normalized" via Object("!", ...) and returned a boxed String object. Two boxed
  // Strings are never === so the idempotence invariant broke; a boxed String escaping
  // into canonicalKey/consumers is a type-confusion hazard. The fix is structural: the
  // type map has a null prototype, so every prototype-member key is a miss.
  it("prototype-member type ids are unknown types: text fallback, primitive, idempotent", () => {
    for (const type of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf"]) {
      const once = normalize(type, "!");
      expect(typeof once).toBe("string");
      expect(once instanceof String).toBe(false);
      expect(normalize(type, once)).toBe(once);
    }
  });

  it("the type map has a null prototype (structural guard)", () => {
    // import * as core and reach the map? the map is not exported — assert behaviorally:
    // a prototype-member key behaves exactly like an arbitrary unknown type id.
    expect(normalize("constructor", "a b")).toBe(normalize("unknown_type_xyz", "a b"));
  });
});
