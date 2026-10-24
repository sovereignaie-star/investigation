/**
 * P6-008 — `ir delete` (UC-24): secure case deletion from the CLI.
 *
 * `ir delete <case-dir> --reason text --key <installation-private.pem>` verifies the
 * case, deletes it securely (overwrite + unlink, tree gone) and writes the signed
 * deletion certificate next to the deleted directory (`<case-dir>.deleted.crt.json`).
 * Fail-closed: no reason, no key, or a case that does not verify → nothing deleted.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { manualClock } from "@ir/core";
import { generateInstallationKey, verifyDeletionCertificate } from "@ir/ledger";
import { openCase } from "@ir/store";
import { main } from "./ir.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeCase() {
  const dir = mkdtempSync(path.join(tmpdir(), "ir-del-cli-"));
  dirs.push(dir);
  const clock = manualClock("2026-10-24T12:00:00.000Z");
  const key = generateInstallationKey();
  const priv = `${dir}.key.pem`;
  const pub = `${dir}.pub.pem`;
  writeFileSync(priv, key.privateKeyPem);
  writeFileSync(pub, key.publicKeyPem);
  dirs.push(priv, pub);
  const c = openCase(dir, {
    actor: "analyst",
    clock,
    create: {
      title: "delete cli test",
      purpose: "مراجعة بنية تحتية",
      legalBasis: "security_incident",
      retention: { mode: "days", days: 1 },
    },
  });
  c.close();
  return { dir, priv, pub, key };
}

const run = async (args: string[]) => {
  const out: string[] = [];
  const code = await main(
    args,
    (s) => out.push(s),
    (s) => out.push(s),
  );
  return { code, text: out.join("\n") };
};

describe("ir delete — secure deletion with a certificate (P6-008, T-DEL-001)", () => {
  it("deletes the case and writes a verifiable certificate next to it", async () => {
    const { dir, priv, key } = makeCase();
    const deleted = await run(["delete", dir, "--reason", "انتهاء الاحتفاظ", "--key", priv]);
    expect(deleted.code).toBe(0);
    expect(deleted.text).toMatch(/deleted .*: case .*, chain length \d+/);
    expect(existsSync(dir)).toBe(false);
    const crtPath = `${dir}.deleted.crt.json`;
    expect(existsSync(crtPath)).toBe(true);
    const crt = JSON.parse(readFileSync(crtPath, "utf8"));
    expect(verifyDeletionCertificate(crt, key.publicKeyPem)).toEqual([]);
  });

  it("refuses without a reason (nothing is deleted)", async () => {
    const { dir, priv } = makeCase();
    const refused = await run(["delete", dir, "--key", priv]);
    expect(refused.code).not.toBe(0);
    expect(refused.text).toMatch(/reason/i);
    expect(existsSync(dir)).toBe(true);
  });

  it("refuses without the installation key (the certificate must be signed)", async () => {
    const { dir } = makeCase();
    const refused = await run(["delete", dir, "--reason", "no key provided"]);
    expect(refused.code).not.toBe(0);
    expect(refused.text).toMatch(/--key/i);
    expect(existsSync(dir)).toBe(true);
  });
});
