import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { manualClock } from "@ir/core";
import {
  checkpoint,
  generateInstallationKey,
  hashEntry,
  inclusionProof,
  installationKeyFromPem,
  keyIdOf,
  Ledger,
  loadOrCreateInstallationKey,
  merkleRoot,
  signCheckpoint,
  verify,
  verifyCheckpoint,
  verifyEmbeddedCheckpoints,
  verifyInclusion,
  type Entry,
} from "./index.ts";

function build(n: number) {
  const clock = manualClock("2026-10-10T10:00:00.000Z");
  const ledger = new Ledger({ clock, actor: "analyst" });
  ledger.append("case.created", { purpose: "تحقق من بنية تحتية" });
  for (let i = 1; i < n; i++) {
    clock.advance(1000);
    ledger.append("note.added", { i });
  }
  return { ledger, clock };
}
const copy = (l: Ledger) => l.entries().map((e) => structuredClone(e)) as Entry[];
const codes = (errs: { code: string }[]) => errs.map((e) => e.code);

describe("signed checkpoints (P1-011)", () => {
  const key = generateInstallationKey();

  it("T-LED-011: a checkpoint verifies with the installation key; another key or an edited payload fails", () => {
    const { ledger, clock } = build(5);
    const cp = checkpoint(ledger, key, clock);
    expect(cp.payload).toMatchObject({ format: "ir-checkpoint/1", length: 5, keyId: key.keyId });
    const entries = copy(ledger);
    expect(entries[5]?.kind).toBe("checkpoint");
    expect(verify(entries).ok).toBe(true);
    expect(verifyCheckpoint(entries, cp, key.publicKeyPem)).toEqual([]);
    expect(verifyEmbeddedCheckpoints(entries, key.publicKeyPem)).toEqual([]);
    const other = generateInstallationKey();
    expect(codes(verifyCheckpoint(entries, cp, other.publicKeyPem))).toEqual(["key", "signature"]);
    expect(
      codes(verifyCheckpoint(entries, { ...cp, payload: { ...cp.payload, at: "2030-01-01T00:00:00.000Z" } }, key.publicKeyPem)),
    ).toEqual(["signature"]);
    const sig = Buffer.from(cp.signature, "base64url");
    sig[0] = (sig[0] ?? 0) ^ 1;
    expect(codes(verifyCheckpoint(entries, { ...cp, signature: sig.toString("base64url") }, key.publicKeyPem))).toEqual(["signature"]);
  });

  it("T-LED-012: truncating the tail behind a published checkpoint is detected (closes the T-LED-008 gap)", () => {
    const { ledger, clock } = build(8);
    const cp = signCheckpoint(ledger.entries(), key, clock);
    const entries = copy(ledger);
    for (let keep = 1; keep < 8; keep++) {
      const cut = entries.slice(0, keep);
      expect(verify(cut).ok).toBe(true); // the prefix alone is a valid chain
      expect(codes(verifyCheckpoint(cut, cp, key.publicKeyPem))).toEqual(["truncated"]);
    }
  });

  it("T-LED-013: rewriting history and recomputing every hash still breaks the signed head and Merkle root", () => {
    const { ledger, clock } = build(6);
    const cp = signCheckpoint(ledger.entries(), key, clock);
    const forged = copy(ledger);
    const target = forged[2];
    if (!target) throw new Error("setup");
    target.payload = { i: 999 };
    for (let i = 2; i < forged.length; i++) {
      const e = forged[i] as Entry;
      e.prevHash = (forged[i - 1] as Entry).entryHash;
      e.entryHash = hashEntry(e);
    }
    expect(verify(forged).ok).toBe(true); // internally consistent forgery
    expect(codes(verifyCheckpoint(forged, cp, key.publicKeyPem))).toEqual(["head", "root"]);
    // an embedded checkpoint over a forged prefix fails the same way
    const { ledger: l2, clock: c2 } = build(4);
    checkpoint(l2, key, c2);
    const e2 = copy(l2);
    (e2[1] as Entry).payload = { i: -1 };
    (e2[1] as Entry).entryHash = hashEntry(e2[1] as Entry);
    expect(verifyEmbeddedCheckpoints(e2, key.publicKeyPem).map((r) => codes(r.errors))).toEqual([["root"]]);
  });

  it("T-LED-014: Merkle inclusion proofs (RFC 9162) verify for every leaf of every tree size 1..33 and fail when altered", () => {
    const hashes = Array.from({ length: 33 }, (_, i) =>
      hashEntry({ seq: i, prevHash: null, kind: "note.added", payload: { i }, at: "2026-10-10T00:00:00.000Z", actor: "t" }),
    );
    for (let size = 1; size <= 33; size++) {
      const root = merkleRoot(hashes.slice(0, size));
      for (let i = 0; i < size; i++) {
        const proof = inclusionProof(hashes, i, size);
        expect(verifyInclusion(hashes[i] as string, i, size, proof, root), `${i}/${size}`).toBe(true);
        expect(verifyInclusion(hashes[(i + 1) % 33] as string, i, size, proof, root)).toBe(false);
        if (proof.length > 0) {
          const bad = [...proof];
          bad[0] = (bad[0] as string).replace(/^./, (c) => (c === "0" ? "1" : "0"));
          expect(verifyInclusion(hashes[i] as string, i, size, bad, root)).toBe(false);
          expect(verifyInclusion(hashes[i] as string, i, size, proof.slice(1), root)).toBe(false);
        }
        if (size > 1) expect(verifyInclusion(hashes[i] as string, (i + 1) % size, size, proof, root)).toBe(false);
      }
    }
    // RFC 9162 MTH of the empty tree is SHA-256 of the empty string
    expect(merkleRoot([])).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("T-LED-015: the private key stays out of the ledger and checkpoints, is stored 0600, and only Ed25519 is accepted", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-key-"));
    try {
      const k1 = loadOrCreateInstallationKey(dir);
      const k2 = loadOrCreateInstallationKey(dir);
      expect(k2.keyId).toBe(k1.keyId);
      expect(k1.keyId).toMatch(/^ed25519:[0-9a-f]{16}$/);
      expect(k1.keyId).toBe(keyIdOf(readFileSync(path.join(dir, "installation.pub"), "utf8")));
      expect(statSync(path.join(dir, "installation.key")).mode & 0o777).toBe(0o600);
      const pem = readFileSync(path.join(dir, "installation.key"), "utf8");
      const { ledger, clock } = build(3);
      const cp = checkpoint(ledger, k1, clock);
      const body = pem
        .split("\n")
        .filter((l) => l && !l.startsWith("-----"))
        .join("");
      expect(JSON.stringify([ledger.entries(), cp])).not.toContain(body);
      expect(Object.keys(k1).sort()).toEqual(["keyId", "publicKeyPem", "sign"]);
      expect(installationKeyFromPem(pem).keyId).toBe(k1.keyId);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() => installationKeyFromPem(rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString())).toThrow(/Ed25519/);
    expect(() => keyIdOf(rsa.publicKey.export({ type: "spki", format: "pem" }).toString())).toThrow(/Ed25519/);
  });
});
