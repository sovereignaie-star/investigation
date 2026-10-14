/**
 * P2-027 — TR-089 EML/MSG parser contract test (T-RULE-06).
 *
 * Deterministic: the EML fixture is a literal string; the MSG fixture is a
 * minimal OLE2 compound document built in-memory by the test helper. No
 * network, no external services. Proves the transform extracts headers,
 * Received chain, URLs (without opening them — PB-07), and attachment
 * SHA-256 hashes, and that it fails closed on invalid input.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { emlMsgParse, parseEml } from "./tr-089-eml-msg.ts";
import { buildMsg, sha256 } from "./ole2-builder.test-helper.ts";
import { runTransform } from "../runner.ts";
import type { HttpTransport } from "@ir/engine/transport";

const noopTransport: HttpTransport = {
  async fetch() {
    throw new Error("TR-089 must never make a network request");
  },
};

const EML_FIXTURE = `Return-Path: <attacker@evil.example>
Received: from mail.evil.example (mail.evil.example [203.0.113.7])
\tby mx.legit.example (Postfix) with ESMTP id ABC123
\tfor <victim@legit.example>; Tue, 13 Oct 2026 10:00:00 +0300
Received: from [198.51.100.9] (unknown [198.51.100.9])
\tby mail.evil.example with SMTP id XYZ789;
\tTue, 13 Oct 2026 09:59:59 +0300
From: "Phishing Team" <attacker@evil.example>
To: victim@legit.example
Subject: =?utf-8?B?2YXYsdit2KjYpw==?=
Date: Tue, 13 Oct 2026 09:59:58 +0300
Message-ID: <phish-001@evil.example>
Reply-To: attacker@evil.example
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="BOUNDARY-42"

--BOUNDARY-42
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: base64

SGVsbG8sIHBsZWFzZSB2aXNpdCBodHRwczovL2V2aWwuZXhhbXBsZS9sb2dpbj9mcm9tPWVtYWls
--BOUNDARY-42
Content-Type: application/pdf; name="invoice.pdf"
Content-Disposition: attachment; filename="invoice.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQKJcOkw7zDtsOfCg==
--BOUNDARY-42--
`;

describe("TR-089 eml-msg", () => {
  it("parses an EML: headers, received chain, URLs, attachment hash — no network", async () => {
    const result = await runTransform(emlMsgParse, {
      transport: noopTransport,
      input: { content: EML_FIXTURE, format: "eml" },
    });
    // No network requests at all (LC-A local transform).
    expect(result.requestCount).toBe(0);
    expect(result.evidence).toHaveLength(0);

    const f = result.output.findings;
    // Subject decoded from RFC 2047 (Arabic "مرحبا").
    expect(f).toContainEqual(expect.objectContaining({ predicate: "has_subject", objectValue: "مرحبا" }));
    // Email addresses from From/To/Reply-To/Return-Path.
    const emails = f.filter((x) => x.objectType === "email").map((x) => x.objectValue);
    expect(emails).toContain("attacker@evil.example");
    expect(emails).toContain("victim@legit.example");
    // Received chain: hosts + client IPs.
    const domains = f.filter((x) => x.objectType === "domain").map((x) => x.objectValue);
    expect(domains).toContain("evil.example");
    expect(domains).toContain("legit.example");
    const ips = f.filter((x) => x.objectType === "ipv4").map((x) => x.objectValue);
    expect(ips).toContain("203.0.113.7");
    expect(ips).toContain("198.51.100.9");
    // URL extracted from the body (never fetched).
    const urls = f.filter((x) => x.objectType === "url").map((x) => x.objectValue);
    expect(urls).toContain("https://evil.example/login?from=email");
    // Attachment: filename + SHA-256 of the decoded PDF bytes.
    const hashes = f.filter((x) => x.objectType === "sha256_hash").map((x) => x.objectValue);
    const expected = createHash("sha256").update(Buffer.from("JVBERi0xLjQKJcOkw7zDtsOfCg==", "base64")).digest("hex");
    expect(hashes).toContain(expected);
    const names = f.filter((x) => x.objectType === "filename").map((x) => x.objectValue);
    expect(names).toContain("invoice.pdf");
  });

  it("fails closed on invalid input (not EML, not MSG)", async () => {
    await expect(
      runTransform(emlMsgParse, { transport: noopTransport, input: { content: "this is not an email at all", format: "eml" } }),
    ).rejects.toThrow(/separator|TR-089/);
  });

  it("fails closed on missing content", async () => {
    await expect(runTransform(emlMsgParse, { transport: noopTransport, input: {} })).rejects.toThrow(/content is required/);
  });

  it("rejects a malformed MSG (not OLE2)", async () => {
    await expect(
      runTransform(emlMsgParse, {
        transport: noopTransport,
        input: { content: Buffer.from("not an ole file").toString("base64"), format: "msg" },
      }),
    ).rejects.toThrow(/OLE2|TR-089/);
  });

  it("parses an MSG: subject, sender, received chain, body URL, attachment hash — no network", async () => {
    const attachment = Buffer.from("%PDF-1.4 fake msg attachment");
    const msg = buildMsg({
      subject: "MSG Phish",
      senderEmail: "attacker@evil.example",
      displayTo: "victim@legit.example",
      transportHeaders:
        "Received: from mail.evil.example (mail.evil.example [203.0.113.7])\r\n" +
        "\tby mx.legit.example (Postfix) with ESMTP id MSG1\r\n" +
        "Received: from [198.51.100.9] (unknown [198.51.100.9])\r\n" +
        "\tby mail.evil.example with SMTP id MSG2\r\n",
      body: "Click https://evil.example/msg-login now",
      attachmentFilename: "report.xlsx",
      attachmentData: attachment,
    });
    const result = await runTransform(emlMsgParse, {
      transport: noopTransport,
      input: { content: msg.toString("base64"), format: "msg" },
    });
    expect(result.requestCount).toBe(0);
    const f = result.output.findings;
    expect(f).toContainEqual(expect.objectContaining({ predicate: "has_subject", objectValue: "MSG Phish" }));
    const emails = f.filter((x) => x.objectType === "email").map((x) => x.objectValue);
    expect(emails).toContain("attacker@evil.example");
    expect(emails).toContain("victim@legit.example");
    const domains = f.filter((x) => x.objectType === "domain").map((x) => x.objectValue);
    expect(domains).toContain("evil.example");
    expect(domains).toContain("legit.example");
    const ips = f.filter((x) => x.objectType === "ipv4").map((x) => x.objectValue);
    expect(ips).toContain("203.0.113.7");
    expect(ips).toContain("198.51.100.9");
    const urls = f.filter((x) => x.objectType === "url").map((x) => x.objectValue);
    expect(urls).toContain("https://evil.example/msg-login");
    const hashes = f.filter((x) => x.objectType === "sha256_hash").map((x) => x.objectValue);
    expect(hashes).toContain(sha256(attachment));
    const names = f.filter((x) => x.objectType === "filename").map((x) => x.objectValue);
    expect(names).toContain("report.xlsx");
  });
});

// P2-033: the HTML body is reduced to text by a linear scanner (CodeQL js/bad-tag-filter, js/double-escaping,
// js/polynomial-redos on the previous regex chain).
describe("TR-089 HTML body hardening (P2-033)", () => {
  const html = (body: string) => `From: a@example.org\r\nSubject: h\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${body}\r\n`;

  it("drops script/style blocks regardless of case or a spaced closing tag", () => {
    const parsed = parseEml(html(`<p>keep</p><SCRIPT type="x">alert('a')</script ><style>p{color:red}</STYLE>tail https://ok.example/x).`));
    expect(parsed.body).toBe("keep tail https://ok.example/x).");
    expect(parsed.body).not.toContain("alert");
    expect(parsed.body).not.toContain("color");
    expect(parsed.urls).toEqual(["https://ok.example/x"]);
  });

  it("an unterminated script block drops the remainder instead of leaking it", () => {
    expect(parseEml(html(`before<script>secret()`)).body).toBe("before");
  });

  it("decodes entities in one pass (no double unescaping)", () => {
    expect(parseEml(html(`a &amp;lt;b&amp;gt; &lt;c&gt; &quot;d&quot; &#39;e&#39;`)).body).toBe(`a &lt;b&gt; <c> "d" 'e'`);
  });

  it("stays linear on adversarial input", () => {
    const t0 = performance.now();
    parseEml(html("<script".repeat(20_000) + "<".repeat(50_000) + "https://x.example/" + ".".repeat(50_000)));
    expect(performance.now() - t0).toBeLessThan(2_000);
  });
});
