/**
 * TR-089 — EML/MSG email parser (P2-027, local LC-A transform).
 *
 * Parses a raw email message — EML (RFC 5322 / MIME) or MSG (Outlook OLE2
 * compound document) — and extracts, WITHOUT opening any link (PB-07):
 *   - headers: subject, from, to, date, message-id, reply-to, return-path;
 *   - the Received chain (server path): each hop's host and client IP;
 *   - every URL in the body (extracted, never fetched);
 *   - every attachment: filename and its SHA-256 hash.
 *
 * It is a *local* transform: it makes no network requests at all (license
 * LC-A). The manifest declares `network: { mode: "pinned", allow: [] }` is
 * invalid (pinned requires a non-empty allow list), so a local transform
 * declares `public` with an empty allow list and simply never calls
 * `ctx.http` — the runner records zero requests. Fail-closed: an input that
 * is neither a valid EML nor a valid MSG throws, never silently returns
 * empty. No raw text is ever used as an identifier (D-018): every finding
 * object is a typed catalog value (email, domain, ipv4, ipv6, url,
 * sha256_hash) or a literal attribute (subject, filename, date).
 */
import { createHash } from "node:crypto";
import { registrableDomain } from "@ir/core/psl";
import { defineTransform } from "../manifest.ts";
import type { TransformContext } from "../transform.ts";

/**
 * Resource limits (P2-034). Every size read from the input (OLE2 header fields, directory entry sizes, sector
 * chains, property counts, MIME nesting, base64 payloads) is checked against these BEFORE any buffer is allocated
 * or any loop is entered, so a malformed or hostile file is refused with a typed error instead of exhausting
 * memory, looping forever or overflowing the stack. The parser never trusts a size it has not bounded by the
 * bytes it actually holds.
 */
export interface Tr089Limits {
  /** Maximum length of `input.content` (characters; EML text or base64 MSG). */
  readonly maxInputChars: number;
  /** Maximum size of a decoded MSG compound file (bytes). */
  readonly maxMsgBytes: number;
  /** Maximum total bytes produced by decoding EML transfer encodings (base64 / quoted-printable) across all parts. */
  readonly maxDecodedBytes: number;
  /** Maximum MIME multipart nesting depth. */
  readonly maxMimeDepth: number;
  /** Maximum number of MIME parts in one message. */
  readonly maxMimeParts: number;
  /** Maximum number of OLE2 directory entries. */
  readonly maxDirEntries: number;
  /** Maximum number of MSG attachments. */
  readonly maxAttachments: number;
}

export const TR089_LIMITS: Tr089Limits = Object.freeze({
  maxInputChars: 40 * 1024 * 1024,
  maxMsgBytes: 25 * 1024 * 1024,
  maxDecodedBytes: 32 * 1024 * 1024,
  maxMimeDepth: 32,
  maxMimeParts: 2_000,
  maxDirEntries: 65_536,
  maxAttachments: 1_000,
});

/** A typed refusal: the input is malformed or exceeds a limit. Always thrown before the offending allocation. */
export class Tr089InputError extends Error {
  constructor(
    readonly reason:
      | "input_too_large"
      | "invalid_base64"
      | "msg_too_large"
      | "decoded_too_large"
      | "mime_too_deep"
      | "mime_too_many_parts"
      | "invalid_mime"
      | "invalid_ole2"
      | "ole2_out_of_bounds"
      | "ole2_cycle"
      | "ole2_too_many_entries"
      | "too_many_attachments",
    message: string,
  ) {
    super(`TR-089: ${message}`);
    this.name = "Tr089InputError";
  }
}

const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decode base64 only after bounding its decoded size by the encoded length (3 bytes per 4 characters), so the
 * output buffer can never exceed `maxBytes`. Whitespace is ignored; any other non-alphabet character is refused.
 */
export function decodeBase64Bounded(text: string, maxBytes: number, what: string): Buffer {
  // The caller bounds `text` by maxInputChars first, so this copy is bounded too.
  const clean = text.replace(/\s+/g, "");
  if (!BASE64_BODY.test(clean)) throw new Tr089InputError("invalid_base64", `${what} is not valid base64`);
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const decodedLength = Math.floor((clean.length * 3) / 4) - padding;
  if (decodedLength > maxBytes) {
    throw new Tr089InputError("decoded_too_large", `${what} would decode to ${decodedLength} bytes (limit ${maxBytes})`);
  }
  return Buffer.from(clean, "base64");
}

/** Per-message decoding budget shared by every MIME part. */
interface DecodeBudget {
  remaining: number;
  parts: number;
}

export interface EmailParseInput {
  /** Raw email content: EML text, or MSG as base64 (auto-detected). */
  content: string;
  /** Optional explicit format; auto-detected when omitted. */
  format?: "eml" | "msg";
}

/** A parsed email: headers, received hops, body text, URLs, attachments. */
export interface ParsedEmail {
  format: "eml" | "msg";
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
  messageId?: string;
  replyTo?: string;
  returnPath?: string;
  /** Received hops in order (oldest first): hosts (from/by) and client IP. */
  received: Array<{ hosts: string[]; ip?: string }>;
  /** Body text (plain text part; HTML stripped of tags). */
  body: string;
  /** URLs found in the body, in order of appearance. */
  urls: string[];
  /** Attachments: filename and SHA-256 of the decoded content. */
  attachments: Array<{ filename: string; sha256: string }>;
}

/* ------------------------------------------------------------------ *
 * EML (RFC 5322 / MIME) parsing
 * ------------------------------------------------------------------ */

const EML_MAGIC =
  /^(From|Return-Path|Received|Date|Subject|To|Cc|Message-ID|Reply-To|MIME-Version|Content-Type|Delivered-To|DKIM-Signature|Authentication-Results):/m;

/** Decode an RFC 2047 encoded-word ("=?utf-8?B?...?=" / "=?utf-8?Q?...?="). */
function decodeEncodedWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, _charset, enc, body) => {
    try {
      if (enc.toLowerCase() === "b") return Buffer.from(body, "base64").toString("utf8");
      // Q-encoding: underscores are spaces; =XX is a byte.
      const q = body.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_x: string, h: string) => String.fromCharCode(parseInt(h, 16)));
      return q;
    } catch {
      return _m;
    }
  });
}

/** Unfold folded headers (CRLF followed by WSP) and split into [name, value]. */
function parseHeaders(raw: string): Array<{ name: string; value: string }> {
  const unfolded = raw.replace(/\r?\n[ \t]+/g, " ");
  const out: Array<{ name: string; value: string }> = [];
  for (const line of unfolded.split(/\r?\n/)) {
    const m = /^([!-9;-~]+):[ \t]*(.*)$/.exec(line);
    if (m) out.push({ name: m[1].toLowerCase(), value: decodeEncodedWords(m[2].trim()) });
  }
  return out;
}

/** Decode a MIME part body given its Content-Transfer-Encoding, charging the output to the message budget. */
function decodeBody(body: string, encoding: string, budget: DecodeBudget): Buffer {
  const enc = encoding.trim().toLowerCase();
  let out: Buffer;
  if (enc === "base64") {
    // A part's body may carry trailing junk after the payload (e.g. epilogue text); keep the historic lenient
    // behaviour of ignoring non-alphabet characters, but bound the output before decoding.
    const clean = body.replace(/[^A-Za-z0-9+/=]/g, "");
    if (Math.floor((clean.length * 3) / 4) > budget.remaining) {
      throw new Tr089InputError("decoded_too_large", "MIME parts decode to more than the message budget");
    }
    out = Buffer.from(clean, "base64");
  } else if (enc === "quoted-printable") {
    if (body.length > budget.remaining) {
      throw new Tr089InputError("decoded_too_large", "MIME parts decode to more than the message budget");
    }
    const q = body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
    out = Buffer.from(q, "latin1");
  } else {
    if (Buffer.byteLength(body, "utf8") > budget.remaining) {
      throw new Tr089InputError("decoded_too_large", "MIME parts decode to more than the message budget");
    }
    out = Buffer.from(body, "utf8");
  }
  budget.remaining -= out.length;
  return out;
}

/** Extract the boundary from a Content-Type header value. */
function boundaryOf(contentType: string): string | undefined {
  const m = /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/.exec(contentType);
  return m ? (m[1] ?? m[2]) : undefined;
}

const HTML_ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" };

/**
 * Remove every `<name ...> ... </name ...>` block (case-insensitive) with a linear indexOf scan. An unterminated
 * block drops the rest of the document, so no script/style text can leak into the extracted body (P2-033: replaces
 * the `<script[\s\S]*?<\/script>` regexes CodeQL flagged as js/bad-tag-filter and js/polynomial-redos).
 */
function dropBlocks(html: string, name: string): string {
  const lower = html.toLowerCase();
  const open = `<${name}`;
  const close = `</${name}`;
  let out = "";
  let i = 0;
  for (;;) {
    const start = lower.indexOf(open, i);
    if (start === -1) return out + html.slice(i);
    out += html.slice(i, start) + " ";
    const end = lower.indexOf(close, start + open.length);
    if (end === -1) return out;
    const gt = lower.indexOf(">", end + close.length);
    if (gt === -1) return out;
    i = gt + 1;
  }
}

/** Strip HTML tags and decode common entities (for the HTML body part). Linear time; entities decode in one pass. */
function htmlToText(html: string): string {
  const src = dropBlocks(dropBlocks(html, "script"), "style");
  let text = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "<") {
      const gt = src.indexOf(">", i + 1);
      if (gt === -1) break; // unterminated tag: drop the remainder
      const tag = src
        .slice(i + 1, gt)
        .trim()
        .toLowerCase();
      text += tag === "br" || tag === "br/" || tag.startsWith("br ") || tag === "/p" ? "\n" : " ";
      i = gt + 1;
      continue;
    }
    if (ch === "&") {
      const semi = src.indexOf(";", i + 1);
      const name = semi !== -1 && semi - i <= 6 ? src.slice(i + 1, semi).toLowerCase() : "";
      const decoded = HTML_ENTITIES[name];
      if (decoded !== undefined) {
        // Single pass: the decoded character is never re-scanned, so "&amp;lt;" stays "&lt;" (js/double-escaping).
        text += decoded;
        i = semi + 1;
        continue;
      }
    }
    text += ch;
    i++;
  }
  return text.replace(/\s+/g, " ").trim();
}

const URL_TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", ">", '"', "'", "،", "؛"]);

/** Extract URLs from text using a linear scan (no catastrophic backtracking). */
function extractUrls(text: string): string[] {
  const out: string[] = [];
  const re = /\bhttps?:\/\/[^\s<>"']+/gi;
  for (const m of text.matchAll(re)) {
    let v = m[0];
    // Trim trailing punctuation that is not part of the URL (linear loop instead of a backtracking regex).
    let end = v.length;
    while (end > 0 && URL_TRAILING_PUNCTUATION.has(v[end - 1] ?? "")) end--;
    v = v.slice(0, end);
    try {
      const u = new URL(v);
      if (u.protocol === "http:" || u.protocol === "https:") out.push(u.toString());
    } catch (err) {
      // Not a valid URL — record and skip (D-017: no silent catch).
      void err;
    }
  }
  return out;
}

interface MimeAcc {
  bodyParts: string[];
  attachments: Array<{ filename: string; content: Buffer }>;
  budget: DecodeBudget;
  limits: Tr089Limits;
}

/** Parse a MIME tree into body text and attachments. Depth and part count are bounded (no stack exhaustion). */
function walkMime(raw: string, headers: Array<{ name: string; value: string }>, acc: MimeAcc, depth: number): void {
  if (depth > acc.limits.maxMimeDepth) {
    throw new Tr089InputError("mime_too_deep", `MIME nesting deeper than ${acc.limits.maxMimeDepth}`);
  }
  acc.budget.parts++;
  if (acc.budget.parts > acc.limits.maxMimeParts) {
    throw new Tr089InputError("mime_too_many_parts", `more than ${acc.limits.maxMimeParts} MIME parts`);
  }
  const contentType = headers.find((h) => h.name === "content-type")?.value ?? "text/plain";
  const boundary = boundaryOf(contentType);
  if (boundary) {
    walkMultipart(raw, boundary, acc, depth);
    return;
  }
  walkLeaf(raw, headers, contentType, acc);
}

function walkMultipart(raw: string, boundary: string, acc: MimeAcc, depth: number): void {
  // RFC 2046: a boundary is 1..70 characters; a longer one is malformed and would only inflate the split cost.
  if (boundary.length > 70) throw new Tr089InputError("invalid_mime", "MIME boundary longer than 70 characters");
  // RFC 2046 5.1.1: a delimiter is a whole line "--boundary" (optionally followed by "--" for the close delimiter
  // and trailing whitespace). Matching whole lines means "--b1" does not split a part at "--b10".
  const open = `--${boundary}`;
  const parts: string[] = [];
  let current: string[] | undefined;
  let closed = false;
  for (const line of raw.split("\n")) {
    const bare = line.replace(/[ \t\r]+$/, "");
    if (!closed && (bare === open || bare === `${open}--`)) {
      if (current) parts.push(current.join("\n"));
      if (parts.length > acc.limits.maxMimeParts) {
        throw new Tr089InputError("mime_too_many_parts", `more than ${acc.limits.maxMimeParts} MIME parts`);
      }
      current = bare === open ? [] : undefined;
      closed = bare !== open;
      continue;
    }
    current?.push(line);
  }
  if (current) parts.push(current.join("\n"));
  for (const part of parts) {
    const trimmed = part;
    const sep = trimmed.search(/\r?\n\r?\n|\n\n/);
    if (sep < 0) continue;
    const partHeaders = parseHeaders(trimmed.slice(0, sep));
    const partBody = trimmed.slice(sep).replace(/^\r?\n/, "");
    walkMime(partBody, partHeaders, acc, depth + 1);
  }
}

function walkLeaf(raw: string, headers: Array<{ name: string; value: string }>, contentType: string, acc: MimeAcc): void {
  const cte = headers.find((h) => h.name === "content-transfer-encoding")?.value ?? "";
  const cd = headers.find((h) => h.name === "content-disposition")?.value ?? "";
  const isAttachment = /attachment/i.test(cd) || /filename\s*=/i.test(cd) || /^image\//i.test(contentType.trim());
  const decoded = decodeBody(raw, cte, acc.budget);
  if (isAttachment) {
    const fn = /filename\s*=\s*(?:"([^"]+)"|([^;\s]+))/.exec(cd) ?? /name\s*=\s*(?:"([^"]+)"|([^;\s]+))/.exec(contentType);
    const filename = fn ? decodeEncodedWords(fn[1] ?? fn[2] ?? "attachment") : "attachment";
    acc.attachments.push({ filename, content: decoded });
    return;
  }
  const text = decoded.toString("utf8");
  if (/^text\/html/i.test(contentType.trim())) {
    acc.bodyParts.push(htmlToText(text));
  } else {
    acc.bodyParts.push(text);
  }
}

/** Parse an EML message (RFC 5322 + MIME). */
export function parseEml(raw: string, limits: Tr089Limits = TR089_LIMITS): ParsedEmail {
  if (raw.length > limits.maxInputChars) {
    throw new Tr089InputError("input_too_large", `EML is ${raw.length} characters (limit ${limits.maxInputChars})`);
  }
  const sep = raw.search(/\r?\n\r?\n/);
  if (sep < 0) throw new Error("TR-089: EML has no header/body separator");
  const headerBlock = raw.slice(0, sep);
  const bodyBlock = raw.slice(sep).replace(/^\r?\n/, "");
  const headers = parseHeaders(headerBlock);
  const get = (n: string) => headers.find((h) => h.name === n)?.value;

  const received: Array<{ hosts: string[]; ip?: string }> = [];
  for (const h of headers.filter((h) => h.name === "received")) {
    const hosts: string[] = [];
    const fromHost = /from\s+([^\s(]+)/i.exec(h.value)?.[1];
    const byHost = /by\s+([^\s(;]+)/i.exec(h.value)?.[1];
    // A bracketed IP is not a hostname; skip it.
    if (fromHost && !/^\[/.test(fromHost)) hosts.push(fromHost);
    if (byHost && !/^\[/.test(byHost) && byHost !== fromHost) hosts.push(byHost);
    const ip = /\[(\d{1,3}(?:\.\d{1,3}){3})\]/.exec(h.value)?.[1] ?? /(\d{1,3}(?:\.\d{1,3}){3})/i.exec(h.value)?.[1];
    received.push({ hosts, ip });
  }

  const acc: MimeAcc = {
    bodyParts: [],
    attachments: [],
    budget: { remaining: limits.maxDecodedBytes, parts: 0 },
    limits,
  };
  walkMime(bodyBlock, headers, acc, 0);
  const body = acc.bodyParts.join("\n").trim();
  const urls = extractUrls(body);
  const attachments = acc.attachments.map((a) => ({
    filename: a.filename,
    sha256: createHash("sha256").update(a.content).digest("hex"),
  }));

  return {
    format: "eml",
    subject: get("subject"),
    from: get("from"),
    to: get("to"),
    date: get("date"),
    messageId: get("message-id"),
    replyTo: get("reply-to"),
    returnPath: get("return-path"),
    received,
    body,
    urls,
    attachments,
  };
}

/* ------------------------------------------------------------------ *
 * MSG (Outlook OLE2 compound document) parsing
 * ------------------------------------------------------------------ */

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const MAX_REG_SECTOR = 0xfffffffa; // [MS-CFB] 2.1: 0xFFFFFFFB.. are special values, never sector numbers
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;
const NO_STREAM = 0xffffffff;
const DIR_ENTRY_SIZE = 128;
const MINI_STREAM_CUTOFF = 4096;

interface DirEntry {
  name: string;
  type: number;
  start: number;
  size: number;
  child: number;
  left: number;
  right: number;
}

/**
 * Minimal OLE2 compound-file reader ([MS-CFB]): header, FAT, directory, streams.
 *
 * Hardened (P2-034) against hostile files:
 *  - header fields are validated (sector shift 9 or 12, mini sector shift 6, byte order, offsets per [MS-CFB] 2.2);
 *  - every sector number is checked against the number of sectors the file really holds;
 *  - every chain walk (DIFAT, FAT, directory, mini FAT, stream) keeps a visited set and stops at a cycle;
 *  - a stream's declared size is checked against the bytes its chain can hold (and the file size) BEFORE
 *    `Buffer.alloc`, so an entry claiming 2^63 bytes is refused without allocating;
 *  - the directory red-black tree is walked iteratively with a visited set (no recursion, no infinite walk).
 */
export class Ole2 {
  private readonly buf: Buffer;
  private readonly sectorShift: number;
  private readonly miniSectorShift: number;
  private readonly sectorCount: number;
  private readonly fat: Uint32Array;
  private readonly miniFat: number[];
  private readonly dir: DirEntry[];
  private readonly miniStream: Buffer;
  private readonly limits: Tr089Limits;

  constructor(buf: Buffer, limits: Tr089Limits = TR089_LIMITS) {
    if (buf.length < 512 || !buf.subarray(0, 8).equals(OLE_MAGIC)) {
      throw new Tr089InputError("invalid_ole2", "not an OLE2 compound document (MSG)");
    }
    if (buf.length > limits.maxMsgBytes) {
      throw new Tr089InputError("msg_too_large", `MSG is ${buf.length} bytes (limit ${limits.maxMsgBytes})`);
    }
    this.buf = buf;
    this.limits = limits;
    if (buf.readUInt16LE(0x1c) !== 0xfffe) throw new Tr089InputError("invalid_ole2", "OLE2 byte order mark is not 0xFFFE");
    this.sectorShift = buf.readUInt16LE(0x1e);
    this.miniSectorShift = buf.readUInt16LE(0x20);
    if (this.sectorShift !== 9 && this.sectorShift !== 12) {
      throw new Tr089InputError("invalid_ole2", `OLE2 sector shift ${this.sectorShift} (must be 9 or 12)`);
    }
    if (this.miniSectorShift !== 6) {
      throw new Tr089InputError("invalid_ole2", `OLE2 mini sector shift ${this.miniSectorShift} (must be 6)`);
    }
    // Sector 0 starts right after the header, which occupies one sector ([MS-CFB] 2.2).
    this.sectorCount = Math.max(0, Math.floor((buf.length - this.sectorSize) / this.sectorSize));
    // [MS-CFB] 2.2 header offsets.
    const firstDirSector = buf.readUInt32LE(0x30);
    const firstMiniFat = buf.readUInt32LE(0x3c);
    const miniFatCount = buf.readUInt32LE(0x40);
    const firstDifat = buf.readUInt32LE(0x44);
    const difatCount = buf.readUInt32LE(0x48);

    this.fat = this.buildFat(firstDifat, difatCount);
    this.dir = this.buildDir(firstDirSector);
    this.miniFat = this.buildMiniFat(firstMiniFat, miniFatCount);

    // The mini stream is the root entry's stream (holds sub-4KB streams).
    const root = this.dir[0];
    if (!root || root.type !== 5) throw new Tr089InputError("invalid_ole2", "OLE2 directory has no root entry");
    this.miniStream = root.size > 0 ? this.readStream(root.start, root.size, false) : Buffer.alloc(0);
  }

  get sectorSize(): number {
    return 1 << this.sectorShift;
  }

  private checkSector(s: number, what: string): void {
    if (s > MAX_REG_SECTOR || s >= this.sectorCount) {
      throw new Tr089InputError("ole2_out_of_bounds", `${what} sector ${s} is outside the file (${this.sectorCount} sectors)`);
    }
  }

  private readSector(s: number, what: string): Buffer {
    this.checkSector(s, what);
    const off = (s + 1) * this.sectorSize;
    return this.buf.subarray(off, off + this.sectorSize);
  }

  /**
   * Follow a FAT chain from `start`, returning at most `maxLength` sector numbers. Refuses a sector outside the
   * file, a FREE/special value inside the chain, and any sector seen twice (cycle).
   */
  private chain(start: number, maxLength: number, what: string): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    let s = start;
    while (s !== END_OF_CHAIN) {
      if (out.length >= maxLength) break;
      this.checkSector(s, what);
      if (seen.has(s)) throw new Tr089InputError("ole2_cycle", `${what} chain revisits sector ${s}`);
      seen.add(s);
      out.push(s);
      s = s < this.fat.length ? this.fat[s] : END_OF_CHAIN;
    }
    return out;
  }

  private buildFat(firstDifat: number, difatCount: number): Uint32Array {
    const fatSectors: number[] = [];
    const seen = new Set<number>();
    const addFatSector = (v: number) => {
      this.checkSector(v, "FAT");
      if (seen.has(v)) throw new Tr089InputError("ole2_cycle", `FAT sector ${v} listed twice`);
      seen.add(v);
      fatSectors.push(v);
    };
    for (let i = 0; i < 109; i++) {
      const v = this.buf.readUInt32LE(0x4c + i * 4);
      if (v === FREE_SECTOR || v === END_OF_CHAIN) break;
      addFatSector(v);
    }
    // DIFAT sectors (chained through their last slot). Each one is a real sector of this file, so their number
    // can never exceed the sector count; a larger header count is refused before any loop.
    if (difatCount > this.sectorCount) {
      throw new Tr089InputError("ole2_out_of_bounds", `DIFAT count ${difatCount} exceeds the ${this.sectorCount} sectors in the file`);
    }
    const difSeen = new Set<number>();
    let dif = firstDifat;
    for (let d = 0; d < difatCount && dif !== END_OF_CHAIN && dif !== FREE_SECTOR; d++) {
      if (difSeen.has(dif)) throw new Tr089InputError("ole2_cycle", `DIFAT chain revisits sector ${dif}`);
      difSeen.add(dif);
      const sec = this.readSector(dif, "DIFAT");
      for (let i = 0; i + 4 <= sec.length - 4; i += 4) {
        const v = sec.readUInt32LE(i);
        if (v !== FREE_SECTOR) addFatSector(v);
      }
      dif = sec.readUInt32LE(sec.length - 4);
    }
    // Bounded: at most sectorCount FAT sectors (each distinct and inside the file).
    const perSector = this.sectorSize / 4;
    const fat = new Uint32Array(fatSectors.length * perSector);
    fatSectors.forEach((fs, k) => {
      const sec = this.readSector(fs, "FAT");
      for (let i = 0; i < perSector; i++) fat[k * perSector + i] = sec.readUInt32LE(i * 4);
    });
    return fat;
  }

  private buildDir(firstDirSector: number): DirEntry[] {
    const dir: DirEntry[] = [];
    const perSector = this.sectorSize / DIR_ENTRY_SIZE;
    const maxSectors = Math.ceil(this.limits.maxDirEntries / perSector);
    const sectors = this.chain(firstDirSector, maxSectors + 1, "directory");
    if (sectors.length > maxSectors) {
      throw new Tr089InputError("ole2_too_many_entries", `directory has more than ${this.limits.maxDirEntries} entries`);
    }
    for (const dirSector of sectors) {
      const sec = this.readSector(dirSector, "directory");
      for (let i = 0; i + DIR_ENTRY_SIZE <= sec.length; i += DIR_ENTRY_SIZE) {
        // Name length is in bytes including the UTF-16 terminator, at most 64 ([MS-CFB] 2.6.1).
        const nameLen = Math.min(sec.readUInt16LE(i + 0x40), 64);
        const name = nameLen >= 2 ? sec.subarray(i, i + nameLen - 2).toString("utf16le") : "";
        const type = sec.readUInt8(i + 0x42);
        const start = sec.readUInt32LE(i + 0x74);
        // Version 3 files (512-byte sectors) only define the low 32 bits of the size ([MS-CFB] 2.6.3).
        const size = this.sectorShift === 9 ? sec.readUInt32LE(i + 0x78) : Number(sec.readBigUInt64LE(i + 0x78) & 0x1f_ffff_ffff_ffffn);
        const child = sec.readUInt32LE(i + 0x4c);
        const left = sec.readUInt32LE(i + 0x44);
        const right = sec.readUInt32LE(i + 0x48);
        dir.push({ name, type, start, size, child, left, right });
      }
    }
    return dir;
  }

  private buildMiniFat(firstMiniFat: number, miniFatCount: number): number[] {
    if (miniFatCount === 0 || firstMiniFat === END_OF_CHAIN) return [];
    if (miniFatCount > this.sectorCount) {
      throw new Tr089InputError("ole2_out_of_bounds", `mini FAT count ${miniFatCount} exceeds the ${this.sectorCount} sectors in the file`);
    }
    const miniFat: number[] = [];
    for (const mf of this.chain(firstMiniFat, miniFatCount, "mini FAT")) {
      const sec = this.readSector(mf, "mini FAT");
      for (let i = 0; i + 4 <= sec.length; i += 4) miniFat.push(sec.readUInt32LE(i));
    }
    return miniFat;
  }

  /**
   * Read a stream. The declared `size` comes from the (untrusted) directory, so it is bounded by the bytes the
   * stream's chain can actually reference before the output buffer is allocated.
   */
  private readStream(start: number, size: number, useMini: boolean): Buffer {
    if (!Number.isSafeInteger(size) || size < 0) throw new Tr089InputError("ole2_out_of_bounds", `stream size ${size} is invalid`);
    const container = useMini ? this.miniStream.length : this.buf.length;
    if (size > container) {
      throw new Tr089InputError(
        "ole2_out_of_bounds",
        `stream declares ${size} bytes but its ${useMini ? "mini stream" : "file"} holds ${container}`,
      );
    }
    if (size === 0) return Buffer.alloc(0);
    if (useMini) {
      const miniSize = 1 << this.miniSectorShift;
      const miniCount = Math.floor(this.miniStream.length / miniSize);
      const need = Math.ceil(size / miniSize);
      const sectors: number[] = [];
      const seen = new Set<number>();
      let s = start;
      while (sectors.length < need) {
        if (s === END_OF_CHAIN || s > MAX_REG_SECTOR || s >= miniCount) {
          throw new Tr089InputError("ole2_out_of_bounds", `mini stream chain ends before ${size} bytes (sector ${s})`);
        }
        if (seen.has(s)) throw new Tr089InputError("ole2_cycle", `mini FAT chain revisits sector ${s}`);
        seen.add(s);
        sectors.push(s);
        s = s < this.miniFat.length ? this.miniFat[s] : END_OF_CHAIN;
      }
      const out = Buffer.alloc(size);
      sectors.forEach((ms, k) => {
        const from = ms * miniSize;
        this.miniStream.copy(out, k * miniSize, from, from + Math.min(miniSize, size - k * miniSize));
      });
      return out;
    }
    const need = Math.ceil(size / this.sectorSize);
    const sectors = this.chain(start, need, "stream");
    if (sectors.length < need) {
      throw new Tr089InputError("ole2_out_of_bounds", `stream chain holds ${sectors.length} sectors, ${need} needed for ${size} bytes`);
    }
    const out = Buffer.alloc(size);
    sectors.forEach((fs, k) => {
      const sec = this.readSector(fs, "stream");
      sec.copy(out, k * this.sectorSize, 0, Math.min(sec.length, size - k * this.sectorSize));
    });
    return out;
  }

  /** Read a named stream (e.g. "__properties_version1.0"). */
  stream(name: string): Buffer | undefined {
    const e = this.dir.find((d) => d.type === 2 && d.name === name);
    if (!e) return undefined;
    return this.readStream(e.start, e.size, e.size < MINI_STREAM_CUTOFF);
  }

  /** Read a named stream inside a storage (e.g. an attachment's properties). */
  storageStream(storageName: string, streamName: string): Buffer | undefined {
    const storage = this.dir.find((d) => d.type === 1 && d.name === storageName);
    if (!storage) return undefined;
    const found = this.findInTree(storage.child, streamName);
    if (!found) return undefined;
    return this.readStream(found.start, found.size, found.size < MINI_STREAM_CUTOFF);
  }

  /**
   * Walk the directory tree rooted at `root` (left/right siblings) looking for a stream by name. Iterative with
   * a visited set: a hostile file whose left/right pointers form a cycle is refused instead of recursing forever.
   */
  private findInTree(root: number, name: string): { start: number; size: number } | undefined {
    const stack: number[] = [root];
    const seen = new Set<number>();
    while (stack.length > 0) {
      const idx = stack.pop() as number;
      if (idx === NO_STREAM) continue;
      if (idx >= this.dir.length) {
        throw new Tr089InputError("ole2_out_of_bounds", `directory entry ${idx} is outside the directory (${this.dir.length} entries)`);
      }
      if (seen.has(idx)) throw new Tr089InputError("ole2_cycle", `directory tree revisits entry ${idx}`);
      seen.add(idx);
      const e = this.dir[idx];
      if (e.type === 2 && e.name === name) return { start: e.start, size: e.size };
      stack.push(e.right, e.left);
    }
    return undefined;
  }
}

/** MSG property tags we care about. */
const PT = {
  subject: 0x0037,
  senderName: 0x0c1a,
  senderEmail: 0x0c1f,
  displayTo: 0x0e03,
  displayCc: 0x0e04,
  sentOn: 0x0e06,
  receivedOn: 0x0e07,
  transportHeaders: 0x007d,
  body: 0x1000,
  bodyHtml: 0x1013,
  attachmentCount: 0x3701,
  attachFilename: 0x3704,
  attachLongFilename: 0x370a,
  attachData: 0x370e,
} as const;

// The attachment data property (0x370E, binary) holds the decoded attachment bytes.
const ATTACH_DATA = 0x370e;

/** Parse the MSG property stream into a map of tag → value. */
export function parseProperties(stream: Buffer): Map<number, unknown> {
  const out = new Map<number, unknown>();
  if (stream.length < 8) return out;
  const count = stream.readUInt32LE(4);
  let off = 8;
  for (let i = 0; i < count && off + 16 <= stream.length; i++) {
    const fullTag = stream.readUInt32LE(off);
    const flags = stream.readUInt32LE(off + 4);
    const type = fullTag >>> 16;
    const tag = fullTag & 0xffff;
    const raw = stream.subarray(off + 8, off + 16);
    let value: unknown;
    switch (type) {
      case 0x001e: // string (ANSI)
      case 0x001f: {
        // unicode string
        const size = raw.readUInt32LE(0);
        if (size <= 4) {
          value = type === 0x001f ? raw.subarray(0, size).toString("utf16le") : raw.subarray(0, size).toString("latin1");
        } else {
          const idx = raw.readUInt32LE(4);
          value = undefined; // resolved by caller via stream index
          out.set(tag, { __stream: idx, __type: type, __size: size, __fullTag: fullTag });
          off += 16;
          continue;
        }
        break;
      }
      case 0x0002: // int32
        value = raw.readInt32LE(0);
        break;
      case 0x0003: // float
        value = raw.readFloatLE(0);
        break;
      case 0x000b: // boolean
        value = raw.readUInt8(0) !== 0;
        break;
      case 0x0014: {
        // FILETIME (8 bytes)
        const lo = raw.readUInt32LE(0);
        const hi = raw.readUInt32LE(4);
        const ms = (Number(hi) * 2 ** 32 + lo) / 10000 - 11644473600000;
        const date = new Date(ms);
        // A hostile FILETIME outside the Date range would make toISOString() throw a RangeError.
        value = Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
        break;
      }
      case 0x0040: {
        // binary
        const size = raw.readUInt32LE(0);
        if (size <= 4) value = Buffer.from(raw.subarray(0, size));
        else {
          const idx = raw.readUInt32LE(4);
          out.set(tag, { __stream: idx, __type: 0x0040, __size: size, __fullTag: fullTag });
          off += 16;
          continue;
        }
        break;
      }
      default:
        value = undefined;
    }
    out.set(tag, value);
    off += 16;
    void flags;
  }
  return out;
}

/** Resolve stream-indexed property values against the OLE streams. */
export function resolveStreams(props: Map<number, unknown>, ole: Ole2): Map<number, unknown> {
  const resolved = new Map<number, unknown>();
  for (const [tag, v] of props) {
    if (v && typeof v === "object" && "__stream" in (v as object)) {
      const s = v as { __stream: number; __type: number; __size: number; __fullTag?: number };
      const fullTag = s.__fullTag ?? tag;
      const stream = ole.stream(`__substg1.0_${fullTag.toString(16).padStart(8, "0").toUpperCase()}`);
      if (stream) {
        const data = stream.subarray(0, s.__size);
        resolved.set(tag, s.__type === 0x001f ? data.toString("utf16le") : s.__type === 0x001e ? data.toString("latin1") : data);
      }
    } else {
      resolved.set(tag, v);
    }
  }
  return resolved;
}

/** Parse an MSG (Outlook) message. */
export function parseMsg(base64: string, limits: Tr089Limits = TR089_LIMITS): ParsedEmail {
  if (base64.length > limits.maxInputChars) {
    throw new Tr089InputError("input_too_large", `MSG base64 is ${base64.length} characters (limit ${limits.maxInputChars})`);
  }
  const buf = decodeBase64Bounded(base64, limits.maxMsgBytes, "MSG content");
  const ole = new Ole2(buf, limits);
  const props = resolveStreams(parseProperties(ole.stream("__properties_version1.0") ?? Buffer.alloc(0)), ole);
  const str = (tag: number) => {
    const v = props.get(tag);
    return typeof v === "string" ? v : undefined;
  };

  const body = str(PT.body) ?? "";
  return {
    format: "msg",
    subject: str(PT.subject),
    from: str(PT.senderName) ? `${str(PT.senderName)} <${str(PT.senderEmail) ?? ""}>`.trim() : str(PT.senderEmail),
    to: str(PT.displayTo),
    date: str(PT.sentOn) ?? str(PT.receivedOn),
    received: parseReceivedChain(str(PT.transportHeaders) ?? ""),
    body,
    urls: extractUrls(body),
    attachments: parseMsgAttachments(ole, props, limits),
  };
}

/** Parse the Received chain from MSG transport headers (0x007D). */
function parseReceivedChain(transportHeaders: string): Array<{ hosts: string[]; ip?: string }> {
  const received: Array<{ hosts: string[]; ip?: string }> = [];
  // Unfold folded continuation lines (Received headers span multiple lines).
  const unfolded = transportHeaders.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    if (!/^received:/i.test(line)) continue;
    const hosts: string[] = [];
    const fromHost = /from\s+([^\s(]+)/i.exec(line)?.[1];
    const byHost = /by\s+([^\s(;]+)/i.exec(line)?.[1];
    if (fromHost && !/^\[/.test(fromHost)) hosts.push(fromHost);
    if (byHost && !/^\[/.test(byHost) && byHost !== fromHost) hosts.push(byHost);
    const ip = /\[(\d{1,3}(?:\.\d{1,3}){3})\]/.exec(line)?.[1] ?? /(\d{1,3}(?:\.\d{1,3}){3})/i.exec(line)?.[1];
    received.push({ hosts, ip });
  }
  return received;
}

/** Read attachment sub-storages and hash their contents. */
function parseMsgAttachments(ole: Ole2, props: Map<number, unknown>, limits: Tr089Limits): Array<{ filename: string; sha256: string }> {
  const attachments: Array<{ filename: string; sha256: string }> = [];
  const raw = props.get(PT.attachmentCount);
  const count = typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : 0;
  // The count is an untrusted int32: refuse it before looping (up to 2^31 lookups otherwise).
  if (count > limits.maxAttachments) {
    throw new Tr089InputError("too_many_attachments", `MSG declares ${count} attachments (limit ${limits.maxAttachments})`);
  }
  for (let i = 0; i < count; i++) {
    const name = `__attach_version1.0_#${i.toString().padStart(8, "0")}`;
    const aprops = resolveStreams(parseProperties(ole.storageStream(name, "__properties_version1.0") ?? Buffer.alloc(0)), ole);
    const astr = (tag: number) => {
      const v = aprops.get(tag);
      return typeof v === "string" ? v : undefined;
    };
    const filename = astr(PT.attachLongFilename) ?? astr(PT.attachFilename) ?? `attachment-${i}`;
    const data = aprops.get(ATTACH_DATA);
    const content = Buffer.isBuffer(data) ? data : Buffer.alloc(0);
    attachments.push({ filename, sha256: createHash("sha256").update(content).digest("hex") });
  }
  return attachments;
}

/* ------------------------------------------------------------------ *
 * Transform
 * ------------------------------------------------------------------ */

/** Extract email addresses from a header value (From/To/Reply-To/Return-Path). */
function emailsIn(value: string | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const m of value.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    out.push(m[0].toLowerCase());
  }
  return out;
}

export const emlMsgParse = defineTransform<EmailParseInput>(
  {
    id: "TR-089",
    version: "1.0.0",
    inputs: ["email_content"],
    outputs: ["email", "domain", "ipv4", "ipv6", "url", "sha256_hash", "subject", "filename", "date"],
    // Local transform: no network. `public` with an empty allow list is the
    // only valid declaration for a transform that never calls ctx.http.
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-A",
  },
  async (input: EmailParseInput, _ctx: TransformContext) => {
    if (!input || typeof input.content !== "string" || input.content.length === 0) {
      throw new Error("TR-089: input.content is required");
    }
    if (input.content.length > TR089_LIMITS.maxInputChars) {
      throw new Tr089InputError("input_too_large", `input is ${input.content.length} characters (limit ${TR089_LIMITS.maxInputChars})`);
    }
    const format = detectFormat(input.content);
    const parsed = format === "msg" ? parseMsg(input.content) : parseEml(input.content);
    const findings: Array<{ predicate: string; objectType: string; objectValue: string; confidence: number; explanation: string }> = [];
    addHeaderFindings(findings, parsed);
    addEmailFindings(findings, parsed);
    addReceivedFindings(findings, parsed);
    addUrlFindings(findings, parsed);
    addAttachmentFindings(findings, parsed);
    return { findings };
  },
);

function detectFormat(content: string): "eml" | "msg" {
  if (content.length > 512 && /^[A-Za-z0-9+/=\r\n]+$/.test(content.slice(0, 512)) && !EML_MAGIC.test(content)) {
    return "msg";
  }
  return "eml";
}

function addHeaderFindings(
  findings: Array<{ predicate: string; objectType: string; objectValue: string; confidence: number; explanation: string }>,
  parsed: ParsedEmail,
): void {
  if (parsed.subject) {
    findings.push({
      predicate: "has_subject",
      objectType: "subject",
      objectValue: parsed.subject.slice(0, 500),
      confidence: 1,
      explanation: `email subject (${parsed.format})`,
    });
  }
  if (parsed.date) {
    findings.push({
      predicate: "has_date",
      objectType: "date",
      objectValue: parsed.date.slice(0, 200),
      confidence: 1,
      explanation: `email date (${parsed.format})`,
    });
  }
}

function addEmailFindings(
  findings: Array<{ predicate: string; objectType: string; objectValue: string; confidence: number; explanation: string }>,
  parsed: ParsedEmail,
): void {
  const emails = new Set<string>([
    ...emailsIn(parsed.from),
    ...emailsIn(parsed.to),
    ...emailsIn(parsed.replyTo),
    ...emailsIn(parsed.returnPath),
  ]);
  for (const e of emails) {
    findings.push({
      predicate: "has_email_address",
      objectType: "email",
      objectValue: e,
      confidence: 0.95,
      explanation: `email address in ${parsed.format} headers`,
    });
  }
}

function addReceivedFindings(
  findings: Array<{ predicate: string; objectType: string; objectValue: string; confidence: number; explanation: string }>,
  parsed: ParsedEmail,
): void {
  for (const hop of parsed.received) {
    for (const h of hop.hosts) {
      const rd = registrableDomain(h);
      if (rd) {
        findings.push({
          predicate: "has_received_hop",
          objectType: "domain",
          objectValue: rd,
          confidence: 0.9,
          explanation: `Received hop registrable domain (${parsed.format})`,
        });
      }
      findings.push({
        predicate: "has_received_hop",
        objectType: "hostname",
        objectValue: h.toLowerCase(),
        confidence: 0.9,
        explanation: `Received hop host (${parsed.format})`,
      });
    }
    if (hop.ip) {
      const ipType = hop.ip.includes(":") ? "ipv6" : "ipv4";
      findings.push({
        predicate: "has_received_hop",
        objectType: ipType,
        objectValue: hop.ip,
        confidence: 0.9,
        explanation: `Received hop client IP (${parsed.format})`,
      });
    }
  }
}

function addUrlFindings(
  findings: Array<{ predicate: string; objectType: string; objectValue: string; confidence: number; explanation: string }>,
  parsed: ParsedEmail,
): void {
  for (const u of parsed.urls) {
    findings.push({
      predicate: "has_url",
      objectType: "url",
      objectValue: u,
      confidence: 0.95,
      explanation: `URL in ${parsed.format} body (not fetched)`,
    });
  }
}

function addAttachmentFindings(
  findings: Array<{ predicate: string; objectType: string; objectValue: string; confidence: number; explanation: string }>,
  parsed: ParsedEmail,
): void {
  for (const a of parsed.attachments) {
    findings.push({
      predicate: "has_attachment",
      objectType: "sha256_hash",
      objectValue: a.sha256,
      confidence: 1,
      explanation: `SHA-256 of attachment "${a.filename}" (${parsed.format})`,
    });
    findings.push({
      predicate: "has_attachment_name",
      objectType: "filename",
      objectValue: a.filename.slice(0, 500),
      confidence: 1,
      explanation: `attachment filename (${parsed.format})`,
    });
  }
}
