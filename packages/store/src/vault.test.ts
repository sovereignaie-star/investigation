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
