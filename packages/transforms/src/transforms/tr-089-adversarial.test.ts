/**
 * P2-034 — TR-089 adversarial inputs (T-RULE-06, deterministic, no network).
 *
 * Every case starts from a VALID MSG built by `buildMsg` and corrupts exactly one field, so a passing case proves
 * that specific guard. The properties checked for each hostile file:
 *   1. it is refused with a typed `Tr089InputError` (the reason names the guard), never a RangeError / stack
 *      overflow / hang;
 *   2. no `Buffer.alloc` / `Buffer.allocUnsafe` / `Uint32Array` larger than the file itself happens BEFORE the refusal
 *      (allocation sizes are recorded by spies — no test allocates a large buffer, the guards are proven by the
 *      requested sizes, not by running out of memory);
 *   3. it is refused quickly (bounded loops: cycles and huge counts are detected, not iterated).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMsg, FREE, SECTOR } from "./ole2-builder.test-helper.ts";
import {
  Ole2,
  TR089_LIMITS,
  Tr089InputError,
  decodeBase64Bounded,
  emlMsgParse,
  parseEml,
  parseMsg,
  parseProperties,
  type Tr089Limits,
} from "./tr-089-eml-msg.ts";
import { runTransform } from "../runner.ts";
import type { HttpTransport } from "@ir/engine/transport";

const noopTransport: HttpTransport = {
  async fetch() {
    throw new Error("TR-089 must never make a network request");
  },
};

const SPEC = {
  subject: "Quarterly report",
  senderEmail: "sender@example.org",
  displayTo: "victim@example.org",
  transportHeaders:
    "Received: from mail.example.org (mail.example.org [192.0.2.10])\r\n\tby mx.example.net; Tue, 13 Oct 2026 10:00:00 +0300\r\n",
  body: "Please see https://example.org/report and the attached file. ".repeat(3),
  attachmentFilename: "report.bin",
  attachmentData: Buffer.from("attachment payload ".repeat(8)),
};

const valid = (): Buffer => buildMsg(SPEC);

/* ---------- layout helpers (header, FAT in sector 0, directory chain from sector 1) ---------- */

const sectorOffset = (s: number) => (s + 1) * SECTOR;
const fatGet = (b: Buffer, s: number) => b.readUInt32LE(sectorOffset(0) + s * 4);
const fatSet = (b: Buffer, s: number, v: number) => b.writeUInt32LE(v, sectorOffset(0) + s * 4);

function dirSectors(b: Buffer): number[] {
  const out: number[] = [];
  // Test-side walk: stops at any special value (END/FREE/...) or a sector outside FAT sector 0.
  for (let s = b.readUInt32LE(0x30); s < SECTOR / 4 && out.length < 64; s = fatGet(b, s)) out.push(s);
  return out;
}

/** File offset of the directory entry with `name`, and its index. */
function entry(b: Buffer, name: string): { offset: number; index: number } {
  let index = 0;
  for (const s of dirSectors(b)) {
    for (let i = 0; i < SECTOR; i += 128, index++) {
      const off = sectorOffset(s) + i;
      const len = b.readUInt16LE(off + 0x40);
      if (len >= 2 && b.subarray(off, off + len - 2).toString("utf16le") === name) return { offset: off, index };
    }
  }
  throw new Error(`test helper: no directory entry ${name}`);
}

const PROPS = "__properties_version1.0";
const ATTACH = "__attach_version1.0_#00000000";

/* ---------- allocation spies ---------- */

let allocations: number[] = [];
beforeEach(() => {
  allocations = [];
  const alloc = Buffer.alloc.bind(Buffer);
  const allocUnsafe = Buffer.allocUnsafe.bind(Buffer);
  vi.spyOn(Buffer, "alloc").mockImplementation(((size: number, ...rest: unknown[]) => {
    allocations.push(size);
    return (alloc as (...a: unknown[]) => Buffer)(size, ...rest);
  }) as typeof Buffer.alloc);
  vi.spyOn(Buffer, "allocUnsafe").mockImplementation(((size: number) => {
    allocations.push(size);
    return allocUnsafe(size);
  }) as typeof Buffer.allocUnsafe);
});
afterEach(() => vi.restoreAllMocks());

/** Parse a hostile MSG buffer and return the typed refusal; asserts no allocation exceeded the file size. */
function refuse(buf: Buffer, limits?: Tr089Limits): Tr089InputError {
  allocations = [];
  const t0 = performance.now();
  let caught: unknown;
  try {
    new Ole2(buf, limits).stream(PROPS);
    parseMsg(buf.toString("base64"), limits);
  } catch (err) {
    caught = err;
  }
  expect(performance.now() - t0).toBeLessThan(2_000);
  expect(caught).toBeInstanceOf(Tr089InputError);
  expect(Math.max(0, ...allocations)).toBeLessThanOrEqual(buf.length);
  return caught as Tr089InputError;
}

describe("TR-089 OLE2 hardening: sizes from the file are bounded before allocation (P2-034)", () => {
  it("control: the unmodified file parses and every allocation stays within the file size", () => {
    const buf = valid();
    const parsed = parseMsg(buf.toString("base64"));
    expect(parsed.subject).toBe(SPEC.subject);
    expect(parsed.attachments).toHaveLength(1);
    expect(Math.max(...allocations)).toBeLessThanOrEqual(buf.length);
  });

  it("a stream entry declaring 4 GiB (0xFFFFFFFF) is refused without allocating it", () => {
    const buf = valid();
    buf.writeUInt32LE(0xffffffff, entry(buf, PROPS).offset + 0x78);
    const err = refuse(buf);
    expect(err.reason).toBe("ole2_out_of_bounds");
    expect(err.message).toMatch(/declares 4294967295 bytes/);
  });

  it("the root entry (mini stream) declaring more bytes than the file is refused in the constructor", () => {
    const buf = valid();
    buf.writeUInt32LE(buf.length + 1, entry(buf, "Root Entry").offset + 0x78);
    expect(refuse(buf).reason).toBe("ole2_out_of_bounds");
  });

  it("version 3: the undefined high 32 bits of a size cannot inflate it (2^62 is read as its low word)", () => {
    const buf = valid();
    buf.writeUInt32LE(0x40000000, entry(buf, PROPS).offset + 0x7c);
    expect(parseMsg(buf.toString("base64")).subject).toBe(SPEC.subject);
    expect(Math.max(...allocations)).toBeLessThanOrEqual(buf.length);
  });

  it("a mini stream whose chain ends before the declared size is refused (no read past the chain)", () => {
    const buf = valid();
    // 4000 bytes < cutoff, so it is read from the mini stream, whose chain for this entry is much shorter.
    buf.writeUInt32LE(4000, entry(buf, PROPS).offset + 0x78);
    expect(refuse(buf).reason).toBe("ole2_out_of_bounds");
  });

  it("a truncated file (cut inside the mini stream) is refused, not read out of bounds", () => {
    const full = valid();
    const buf = Buffer.from(full.subarray(0, full.length - 2 * SECTOR));
    expect(refuse(buf).reason).toBe("ole2_out_of_bounds");
  });
});

describe("TR-089 OLE2 hardening: chains and the directory tree detect cycles (P2-034)", () => {
  it("a FAT cycle in the directory chain is refused (would loop forever)", () => {
    const buf = valid();
    const sectors = dirSectors(buf);
    fatSet(buf, sectors[sectors.length - 1], sectors[0]);
    expect(refuse(buf).reason).toBe("ole2_cycle");
  });

  it("a FAT self-loop on a directory sector is refused", () => {
    const buf = valid();
    const first = buf.readUInt32LE(0x30);
    fatSet(buf, first, first);
    expect(refuse(buf).reason).toBe("ole2_cycle");
  });

  it("a mini FAT self-loop inside a multi-sector stream is refused", () => {
    const buf = valid();
    const props = entry(buf, PROPS);
    const start = buf.readUInt32LE(props.offset + 0x74);
    const miniFatSector = buf.readUInt32LE(0x3c);
    buf.writeUInt32LE(start, sectorOffset(miniFatSector) + start * 4);
    expect(refuse(buf).reason).toBe("ole2_cycle");
  });

  it("a directory tree whose sibling pointer points back to itself is refused (no infinite recursion)", () => {
    const buf = valid();
    const storage = entry(buf, ATTACH);
    // Point the storage's child at its second child (not the target stream) and make that entry its own left sibling.
    const victim = storage.index + 2;
    buf.writeUInt32LE(victim, storage.offset + 0x4c);
    const sectors = dirSectors(buf);
    const off = sectorOffset(sectors[Math.floor(victim / 4)]) + (victim % 4) * 128;
    buf.writeUInt32LE(victim, off + 0x44);
    expect(refuse(buf).reason).toBe("ole2_cycle");
  });

  it("a two-node sibling cycle (A.right = B, B.left = A) is refused", () => {
    const buf = valid();
    const storage = entry(buf, ATTACH);
    const a = storage.index + 2;
    const b = storage.index + 3;
    const sectors = dirSectors(buf);
    const at = (i: number) => sectorOffset(sectors[Math.floor(i / 4)]) + (i % 4) * 128;
    buf.writeUInt32LE(a, storage.offset + 0x4c);
    buf.writeUInt32LE(b, at(a) + 0x48);
    buf.writeUInt32LE(a, at(b) + 0x44);
    expect(refuse(buf).reason).toBe("ole2_cycle");
  });

  it("a directory pointer outside the directory is refused", () => {
    const buf = valid();
    buf.writeUInt32LE(5_000_000, entry(buf, ATTACH).offset + 0x4c);
    expect(refuse(buf).reason).toBe("ole2_out_of_bounds");
  });

  it("a DIFAT count of 0xFFFFFFFF is refused before any loop", () => {
    const buf = valid();
    buf.writeUInt32LE(0, 0x44);
    buf.writeUInt32LE(0xffffffff, 0x48);
    const err = refuse(buf);
    expect(err.reason).toBe("ole2_out_of_bounds");
    expect(err.message).toMatch(/DIFAT count 4294967295 exceeds/);
  });

  it("a DIFAT sector chained to itself is refused", () => {
    const base = valid();
    const idx = Math.floor((base.length - SECTOR) / SECTOR); // index of the appended sector
    const difat = Buffer.alloc(SECTOR, 0xff);
    difat.writeUInt32LE(idx, SECTOR - 4); // next DIFAT = itself
    const buf = Buffer.concat([base, difat]);
    buf.writeUInt32LE(idx, 0x44);
    buf.writeUInt32LE(2, 0x48);
    expect(refuse(buf).reason).toBe("ole2_cycle");
  });

  it("a FAT sector listed twice in the header DIFAT is refused", () => {
    const buf = valid();
    buf.writeUInt32LE(0, 0x4c + 4); // DIFAT[1] = sector 0 again
    expect(refuse(buf).reason).toBe("ole2_cycle");
  });

  it("a FAT sector number outside the file is refused", () => {
    const buf = valid();
    buf.writeUInt32LE(0x7fffffff, 0x4c);
    expect(refuse(buf).reason).toBe("ole2_out_of_bounds");
  });

  it("a FREE sector inside a chain is refused (FREE is not END_OF_CHAIN)", () => {
    const buf = valid();
    expect(dirSectors(buf).length).toBeGreaterThan(1);
    fatSet(buf, buf.readUInt32LE(0x30), FREE);
    expect(refuse(buf).reason).toBe("ole2_out_of_bounds");
  });

  it("a directory larger than maxDirEntries is refused", () => {
    const buf = valid();
    expect(refuse(buf, { ...TR089_LIMITS, maxDirEntries: 4 }).reason).toBe("ole2_too_many_entries");
  });
});

describe("TR-089 OLE2 hardening: header fields and counts (P2-034)", () => {
  it.each([
    ["sector shift 31", 0x1e, 31],
    ["sector shift 0", 0x1e, 0],
    ["mini sector shift 30", 0x20, 30],
  ])("%s is refused (would make 1 << shift absurd)", (_name, offset, value) => {
    const buf = valid();
    buf.writeUInt16LE(value, offset);
    expect(refuse(buf).reason).toBe("invalid_ole2");
  });

  it("a wrong byte order mark is refused", () => {
    const buf = valid();
    buf.writeUInt16LE(0x1234, 0x1c);
    expect(refuse(buf).reason).toBe("invalid_ole2");
  });

  it("a mini FAT count larger than the file is refused before looping", () => {
    const buf = valid();
    buf.writeUInt32LE(0x7fffffff, 0x40);
    expect(refuse(buf).reason).toBe("ole2_out_of_bounds");
  });

  it("an attachment count of 2^31-1 is refused before looping", () => {
    const buf = valid();
    // PT_LONG 0x3701 lives in the top-level property stream: find its 16-byte record and overwrite the value.
    const ole = new Ole2(buf);
    const props = ole.stream(PROPS) as Buffer;
    const at = props.indexOf(Buffer.from([0x01, 0x37, 0x02, 0x00]));
    expect(at).toBeGreaterThan(0);
    const start = buf.readUInt32LE(entry(buf, PROPS).offset + 0x74);
    const miniStreamStart = buf.readUInt32LE(entry(buf, "Root Entry").offset + 0x74);
    const fileOffset = sectorOffset(miniStreamStart) + start * 64 + at + 8;
    buf.writeInt32LE(0x7fffffff, fileOffset);
    const err = refuse(buf);
    expect(err.reason).toBe("too_many_attachments");
  });

  it("the largest FILETIME decodes without throwing (toISOString is guarded)", () => {
    const stream = Buffer.alloc(8 + 16);
    stream.writeUInt32LE(1, 4);
    stream.writeUInt32LE((0x0014 << 16) | 0x0e06, 8);
    stream.writeUInt32LE(0xffffffff, 8 + 8);
    stream.writeUInt32LE(0xffffffff, 8 + 12);
    expect(() => parseProperties(stream)).not.toThrow();
    expect(parseProperties(stream).get(0x0e06)).toMatch(/^\+060056-/);
  });

  it("an MSG larger than maxMsgBytes is refused", () => {
    const buf = valid();
    expect(refuse(buf, { ...TR089_LIMITS, maxMsgBytes: buf.length - 1 }).reason).toMatch(/msg_too_large|decoded_too_large/);
  });
});

describe("TR-089 base64 is decoded only within a computed bound (P2-034)", () => {
  it("refuses base64 whose decoded size exceeds the limit, before decoding", () => {
    const text = "QUFB".repeat(1_000); // 3,000 decoded bytes
    const from = vi.spyOn(Buffer, "from");
    expect(() => decodeBase64Bounded(text, 2_999, "test")).toThrow(Tr089InputError);
    expect(from).not.toHaveBeenCalled();
    expect(decodeBase64Bounded(text, 3_000, "test")).toHaveLength(3_000);
  });

  it("refuses characters outside the base64 alphabet", () => {
    try {
      decodeBase64Bounded("QUFB!!!!", 100, "test");
      expect.unreachable();
    } catch (err) {
      expect((err as Tr089InputError).reason).toBe("invalid_base64");
    }
  });

  it("refuses an MSG whose base64 decodes past maxMsgBytes (the oversized buffer is never created)", () => {
    const buf = valid();
    const limits = { ...TR089_LIMITS, maxMsgBytes: 1_024 };
    allocations = [];
    try {
      parseMsg(buf.toString("base64"), limits);
      expect.unreachable();
    } catch (err) {
      expect((err as Tr089InputError).reason).toBe("decoded_too_large");
    }
    expect(Math.max(0, ...allocations)).toBeLessThan(1_024);
  });

  it("refuses input longer than maxInputChars before stripping or decoding it", () => {
    const limits = { ...TR089_LIMITS, maxInputChars: 100 };
    expect(() => parseMsg("A".repeat(101), limits)).toThrow(/limit 100/);
    expect(() => parseEml("From: a@b.c\r\n\r\n" + "x".repeat(100), limits)).toThrow(/limit 100/);
  });

  it("an EML base64 attachment larger than the decode budget is refused", () => {
    const eml =
      'From: a@example.org\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nhi\r\n' +
      '--b\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="x.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
      "QUFB".repeat(1_000) +
      "\r\n--b--\r\n";
    try {
      parseEml(eml, { ...TR089_LIMITS, maxDecodedBytes: 2_000 });
      expect.unreachable();
    } catch (err) {
      expect((err as Tr089InputError).reason).toBe("decoded_too_large");
    }
    expect(parseEml(eml).attachments).toHaveLength(1);
  });
});

describe("TR-089 MIME structure limits (P2-034)", () => {
  const nested = (depth: number) => {
    let body = "Content-Type: text/plain\r\n\r\nleaf\r\n";
    for (let d = depth; d > 0; d--) {
      body = `Content-Type: multipart/mixed; boundary="b${d}"\r\n\r\n--b${d}\r\n${body}--b${d}--\r\n`;
    }
    return "From: a@example.org\r\n" + body;
  };

  it("nesting within the limit parses", () => {
    expect(parseEml(nested(10)).body).toBe("leaf");
  });

  it("nesting deeper than maxMimeDepth is refused (no stack exhaustion), even 5,000 levels deep", () => {
    for (const depth of [TR089_LIMITS.maxMimeDepth + 2, 5_000]) {
      try {
        parseEml(nested(depth));
        expect.unreachable();
      } catch (err) {
        expect((err as Tr089InputError).reason).toBe("mime_too_deep");
      }
    }
  });

  it("more parts than maxMimeParts is refused", () => {
    const parts = Array.from({ length: 50 }, () => "--b\r\nContent-Type: text/plain\r\n\r\nx\r\n").join("");
    const eml = `From: a@example.org\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n${parts}--b--\r\n`;
    try {
      parseEml(eml, { ...TR089_LIMITS, maxMimeParts: 10 });
      expect.unreachable();
    } catch (err) {
      expect((err as Tr089InputError).reason).toBe("mime_too_many_parts");
    }
  });

  it("a boundary longer than 70 characters is refused", () => {
    const b = "x".repeat(71);
    const eml = `From: a@example.org\r\nContent-Type: multipart/mixed; boundary="${b}"\r\n\r\n--${b}\r\n\r\nx\r\n--${b}--\r\n`;
    expect(() => parseEml(eml)).toThrow(Tr089InputError);
  });
});

describe("TR-089 never crashes on mutated files (deterministic mutation run, P2-034)", () => {
  // xorshift32 with a fixed seed: the same 600 mutants on every run.
  let seed = 0x2f6b_9a31;
  const rand = () => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed;
  };

  it("every mutant either parses or is refused with a TR-089 error, within the file-size allocation bound", () => {
    const base = valid();
    const unexpected: string[] = [];
    const t0 = performance.now();
    for (let n = 0; n < 600; n++) {
      const buf = Buffer.from(base);
      const flips = 1 + (rand() % 4);
      for (let k = 0; k < flips; k++) {
        const at = rand() % buf.length;
        // Bias toward the header and directory, where sizes and pointers live.
        const pos = n % 2 === 0 ? at % (4 * SECTOR) : at;
        buf[pos] = rand() & 0xff;
      }
      allocations = [];
      try {
        parseMsg(buf.toString("base64"));
      } catch (err) {
        if (!(err instanceof Error) || !err.message.startsWith("TR-089:")) unexpected.push(`#${n}: ${String(err)}`);
      }
      // base64 text of the mutant is the largest legitimate allocation.
      if (Math.max(0, ...allocations) > buf.length) unexpected.push(`#${n}: allocation ${Math.max(...allocations)} > ${buf.length}`);
    }
    expect(unexpected).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(20_000);
  });
});

describe("TR-089 through the runner: hostile input fails closed, the process survives (P2-034)", () => {
  it("a 4 GiB stream claim is a run failure, not a crash", async () => {
    const buf = valid();
    buf.writeUInt32LE(0xffffffff, entry(buf, PROPS).offset + 0x78);
    await expect(
      runTransform(emlMsgParse, { transport: noopTransport, input: { content: buf.toString("base64"), format: "msg" } }),
    ).rejects.toThrow(/TR-089: stream declares 4294967295 bytes/);
  });
});
