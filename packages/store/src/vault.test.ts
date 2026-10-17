import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openVault, parseMasterKey, VaultLockedError, vaultFromEnv } from "./vault.ts";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "ir-vault-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const SECRET = "sk_live_51HxQ_vault_test_value_7f3a";
const KEY = new Uint8Array(32).fill(7);

describe("key vault (P1-015)", () => {
  it("stores sealed entries: the secret is not in the file, list() shows names only, reveal() returns it", () => {
    const file = path.join(tmp(), "vault.json");
    const v = openVault(file, { key: KEY });
    v.set("shodan", `  ${SECRET}\n`);
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(Buffer.from(SECRET).toString("base64url"));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(v.list())).not.toContain(SECRET);
    expect(v.list().map((e) => e.name)).toEqual(["shodan"]);
    expect(openVault(file, { key: KEY }).reveal("shodan")).toBe(SECRET);
    expect(v.delete("shodan")).toBe(true);
    expect(v.delete("shodan")).toBe(false);
    expect(openVault(file, { key: KEY }).reveal("shodan")).toBeUndefined();
  });

  it("the wrong master key or passphrase cannot open the vault", () => {
    const d = tmp();
    openVault(path.join(d, "a.json"), { key: KEY }).set("ipinfo", SECRET);
    expect(() => openVault(path.join(d, "a.json"), { key: new Uint8Array(32).fill(8) })).toThrow(VaultLockedError);
    const fast = { memoryKiB: 256, passes: 1, parallelism: 1 };
    openVault(path.join(d, "b.json"), { passphrase: "vault passphrase", kdf: fast }).set("ipinfo", SECRET);
    expect(openVault(path.join(d, "b.json"), { passphrase: "vault passphrase" }).reveal("ipinfo")).toBe(SECRET);
    expect(() => openVault(path.join(d, "b.json"), { passphrase: "other passphrase" })).toThrow(VaultLockedError);
  });

  it("an entry moved under another name fails authentication (name is bound as AAD)", () => {
    const file = path.join(tmp(), "vault.json");
    openVault(file, { key: KEY }).set("ipinfo", SECRET);
    const raw = JSON.parse(readFileSync(file, "utf8")) as { entries: Record<string, unknown> };
    raw.entries = { shodan: raw.entries["ipinfo"] };
    const swapped = path.join(path.dirname(file), "swapped.json");
    writeFileSync(swapped, JSON.stringify(raw));
    expect(() => openVault(swapped, { key: KEY }).reveal("shodan")).toThrow();
  });

  it("validates names and sizes; parses IR_VAULT_KEY; a local install gets a generated 0600 key file", () => {
    const v = openVault(path.join(tmp(), "v.json"), { key: KEY });
    for (const bad of ["", "A", "../etc", "x".repeat(41), "__proto__"])
      expect(() => v.set(bad, SECRET)).toThrow(/invalid vault entry name/);
    expect(() => v.set("shodan", "   ")).toThrow(/1\.\.4096/);
    expect(() => parseMasterKey("c2hvcnQ=")).toThrow(/32 bytes/);
    expect(parseMasterKey(Buffer.alloc(32, 1).toString("base64")).length).toBe(32);
    const d = tmp();
    vaultFromEnv({}, d).set("hunter", SECRET);
    expect(statSync(path.join(d, "vault.key")).mode & 0o777).toBe(0o600);
    expect(vaultFromEnv({}, d).reveal("hunter")).toBe(SECRET);
  });
});

/**
 * P2-026 (owner decision 2026-10-17): the credential_pair vault extension — a provider whose
 * authentication is a PAIR (an API ID + a secret, e.g. Censys for TR-049) is stored as ONE vault
 * entry of the new kind, instead of pretending it is a single secret. RED FIRST (the J-1 rule):
 * these tests were written before the extension existed — setPair/revealPair/kindOf did not
 * compile, so the red round is the module's own absence, then each behavior below is pinned.
 */
describe("credential_pair vault extension (P2-026)", () => {
  // P2-026 (gitleaks): the pair secret is a SYNTHETIC fixture value in the low-entropy repo
  // style (cf. "n_urlscan_canary_key" in network-secret.test.ts). The first-round value was a
  // high-entropy hex-style string that tripped the generic-api-key entropy rule — a synthetic
  // value must not read like a real secret (rule: synthetic values in tests; the value itself
  // is meaningless to the contract below: seal, typed read, and kind distinction).
  const ID = "censys-api-id-01234567";
  const PAIR_SECRET = "n_censys_pair_secret";

  function pairVault() {
    const d = tmp();
    return { d, v: openVault(path.join(d, "vault.json"), { key: KEY }) };
  }

  it("RED: setPair seals an API ID + secret as ONE entry, and revealPair returns exactly them", () => {
    const { v } = pairVault();
    expect(typeof v.setPair).toBe("function");
    const info = v.setPair("censys", ID, PAIR_SECRET);
    expect(info).toMatchObject({ name: "censys" });
    expect(v.has("censys")).toBe(true);
    expect(v.revealPair("censys")).toEqual({ id: ID, secret: PAIR_SECRET });
    expect(v.list()).toEqual([{ name: "censys", updatedAt: expect.any(String) }]);
  });

  it("kindOf distinguishes the entry kinds: a pair, a single secret, and a missing entry", () => {
    const { v } = pairVault();
    v.setPair("censys", ID, PAIR_SECRET);
    v.set("hunter", SECRET);
    expect(v.kindOf("censys")).toBe("credential_pair");
    expect(v.kindOf("hunter")).toBe("secret");
    expect(v.kindOf("missing")).toBeUndefined();
  });

  it("backward compatible: a pre-existing single-secret entry is untouched by the extension", () => {
    const { v } = pairVault();
    v.set("hunter", SECRET);
    expect(v.reveal("hunter")).toBe(SECRET);
    expect(v.revealPair("hunter")).toBeUndefined(); // a single secret is never misread as a pair
    expect(v.kindOf("hunter")).toBe("secret");
  });

  it("revealPair on a single-secret entry returns undefined — a pair is never silently synthesized", () => {
    const { v } = pairVault();
    v.set("plain", SECRET);
    expect(v.revealPair("plain")).toBeUndefined();
  });

  it("setPair trims both parts and refuses an empty id or an empty secret (fail-closed)", () => {
    const { v } = pairVault();
    v.setPair("trimmed", `  ${ID}  `, `  ${PAIR_SECRET}  `);
    expect(v.revealPair("trimmed")).toEqual({ id: ID, secret: PAIR_SECRET });
    expect(() => v.setPair("bad1", "", PAIR_SECRET)).toThrow(/id/i);
    expect(() => v.setPair("bad2", ID, "")).toThrow(/secret/i);
    expect(v.has("bad1")).toBe(false);
    expect(v.has("bad2")).toBe(false);
  });

  it("setPair enforces the same entry-name rule and the same size bound as set", () => {
    const { v } = pairVault();
    expect(() => v.setPair("Bad-Name", ID, PAIR_SECRET)).toThrow(/invalid vault entry name/i);
    const tooLong = "x".repeat(4097);
    expect(() => v.setPair("toobig", ID, tooLong)).toThrow();
  });

  it("the pair is sealed on disk like any secret: the file carries only iv/ct/tag, never plaintext", () => {
    const { d, v } = pairVault();
    v.setPair("censys", ID, PAIR_SECRET);
    const raw = readFileSync(path.join(d, "vault.json"), "utf8");
    expect(raw).toContain("censys");
    expect(raw).not.toContain(ID);
    expect(raw).not.toContain(PAIR_SECRET);
  });

  it("delete removes a pair entry like any other", () => {
    const { v } = pairVault();
    v.setPair("censys", ID, PAIR_SECRET);
    expect(v.delete("censys")).toBe(true);
    expect(v.has("censys")).toBe(false);
    expect(v.revealPair("censys")).toBeUndefined();
  });

  it("a reopened vault (same master key) reveals the pair — persistence is the sealed file itself", () => {
    const { d } = pairVault();
    const first = openVault(path.join(d, "vault.json"), { key: KEY });
    first.setPair("censys", ID, PAIR_SECRET);
    const reopened = openVault(path.join(d, "vault.json"), { key: KEY });
    expect(reopened.revealPair("censys")).toEqual({ id: ID, secret: PAIR_SECRET });
    expect(reopened.kindOf("censys")).toBe("credential_pair");
  });
});
