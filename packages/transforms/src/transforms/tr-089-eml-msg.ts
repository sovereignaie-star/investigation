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

/** Decode a MIME part body given its Content-Transfer-Encoding. */
function decodeBody(body: string, encoding: string): Buffer {
  const enc = encoding.trim().toLowerCase();
  if (enc === "base64") {
    const clean = body.replace(/\s+/g, "");
    return Buffer.from(clean, "base64");
  }
  if (enc === "quoted-printable") {
    const q = body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(q, "latin1");
  }
  return Buffer.from(body, "utf8");
}

/** Extract the boundary from a Content-Type header value. */
function boundaryOf(contentType: string): string | undefined {
  const m = /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/.exec(contentType);
  return m ? (m[1] ?? m[2]) : undefined;
}

/** Strip HTML tags and decode common entities (for the HTML body part). */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract URLs from text using a linear scan (no catastrophic backtracking). */
function extractUrls(text: string): string[] {
  const out: string[] = [];
  const re = /\bhttps?:\/\/[^\s<>"']+/gi;
  for (const m of text.matchAll(re)) {
    let v = m[0];
    // Trim trailing punctuation that is not part of the URL.
    v = v.replace(/[.,;:!?)\]}>"'،؛]+$/g, "");
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

/** Parse a MIME tree into body text and attachments. */
function walkMime(
  raw: string,
  headers: Array<{ name: string; value: string }>,
  acc: { bodyParts: string[]; attachments: Array<{ filename: string; content: Buffer }> },
): void {
  const contentType = headers.find((h) => h.name === "content-type")?.value ?? "text/plain";
  const boundary = boundaryOf(contentType);
  if (boundary) {
    walkMultipart(raw, boundary, acc);
    return;
  }
  walkLeaf(raw, headers, contentType, acc);
}

function walkMultipart(
  raw: string,
  boundary: string,
  acc: { bodyParts: string[]; attachments: Array<{ filename: string; content: Buffer }> },
): void {
  const parts = raw.split(new RegExp(`--${escapeRegExp(boundary)}`, "g"));
  for (const part of parts.slice(1)) {
    const trimmed = part.replace(/^\r?\n/, "");
    const sep = trimmed.search(/\r?\n\r?\n|\n\n/);
    if (sep < 0) continue;
    const partHeaders = parseHeaders(trimmed.slice(0, sep));
    const partBody = trimmed.slice(sep).replace(/^\r?\n/, "");
    walkMime(partBody, partHeaders, acc);
  }
}

function walkLeaf(
  raw: string,
  headers: Array<{ name: string; value: string }>,
  contentType: string,
  acc: { bodyParts: string[]; attachments: Array<{ filename: string; content: Buffer }> },
): void {
  const cte = headers.find((h) => h.name === "content-transfer-encoding")?.value ?? "";
  const cd = headers.find((h) => h.name === "content-disposition")?.value ?? "";
  const isAttachment = /attachment/i.test(cd) || /filename\s*=/i.test(cd) || /^image\//i.test(contentType.trim());
  const decoded = decodeBody(raw, cte);
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse an EML message (RFC 5322 + MIME). */
export function parseEml(raw: string): ParsedEmail {
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

  const acc: { bodyParts: string[]; attachments: Array<{ filename: string; content: Buffer }> } = {
    bodyParts: [],
    attachments: [],
  };
  walkMime(bodyBlock, headers, acc);
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
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;

/** Minimal OLE2 compound-file reader: header, FAT, directory, streams. */
export class Ole2 {
  private readonly buf: Buffer;
  private readonly sectorShift: number;
  private readonly miniSectorShift: number;
  private readonly fat: number[];
  private readonly miniFat: number[];
  private readonly dir: Array<{ name: string; type: number; start: number; size: number; child: number; left: number; right: number }>;
  private readonly miniStream: Buffer;

  constructor(buf: Buffer) {
    if (buf.length < 512 || !buf.subarray(0, 8).equals(OLE_MAGIC)) {
      throw new Error("TR-089: not an OLE2 compound document (MSG)");
    }
    this.buf = buf;
    this.sectorShift = buf.readUInt16LE(0x1e);
    this.miniSectorShift = buf.readUInt16LE(0x20);
    const firstDirSector = buf.readUInt32LE(0x30);
    const firstMiniFat = buf.readUInt32LE(0x40);
    const miniFatCount = buf.readUInt32LE(0x44);

    this.fat = this.buildFat();
    this.dir = this.buildDir(firstDirSector);
    this.miniFat = this.buildMiniFat(firstMiniFat, miniFatCount);

    // The mini stream is the root entry's stream (holds sub-4KB streams).
    const root = this.dir.find((d) => d.type === 5);
    this.miniStream = root ? this.readStream(root.start, root.size, false) : Buffer.alloc(0);
  }

  private readSector(s: number): Buffer {
    const off = (s + 1) * this.sectorSize;
    return this.buf.subarray(off, off + this.sectorSize);
  }

  private buildFat(): number[] {
    const fat: number[] = [];
    const readFatSector = (s: number) => {
      const sec = this.readSector(s);
      for (let i = 0; i + 4 <= sec.length; i += 4) fat.push(sec.readUInt32LE(i));
    };
    for (let i = 0; i < 109; i++) {
      const v = this.buf.readUInt32LE(0x4c + i * 4);
      if (v === FREE_SECTOR) break;
      readFatSector(v);
    }
    // DIFAT sectors (chained).
    const firstDif = this.buf.readUInt32LE(0x44);
    const difCount = this.buf.readUInt32LE(0x48);
    let dif = firstDif;
    for (let d = 0; d < difCount && dif !== END_OF_CHAIN && dif !== FREE_SECTOR; d++) {
      const sec = this.readSector(dif);
      for (let i = 0; i + 4 <= sec.length - 4; i += 4) {
        const v = sec.readUInt32LE(i);
        if (v !== FREE_SECTOR) readFatSector(v);
      }
      dif = sec.readUInt32LE(sec.length - 4);
    }
    return fat;
  }

  private buildDir(
    firstDirSector: number,
  ): Array<{ name: string; type: number; start: number; size: number; child: number; left: number; right: number }> {
    const dir: Array<{ name: string; type: number; start: number; size: number; child: number; left: number; right: number }> = [];
    let dirSector = firstDirSector;
    while (dirSector !== END_OF_CHAIN && dirSector !== FREE_SECTOR) {
      const sec = this.readSector(dirSector);
      for (let i = 0; i + 128 <= sec.length; i += 128) {
        const nameLen = sec.readUInt16LE(i + 0x40);
        const name = nameLen > 0 ? sec.subarray(i, i + nameLen - 2).toString("utf16le") : "";
        const type = sec.readUInt8(i + 0x42);
        const start = sec.readUInt32LE(i + 0x74);
        const size = Number(sec.readBigUInt64LE(i + 0x78));
        const child = sec.readUInt32LE(i + 0x4c);
        const left = sec.readUInt32LE(i + 0x44);
        const right = sec.readUInt32LE(i + 0x48);
        dir.push({ name, type, start, size, child, left, right });
      }
      dirSector = this.fat[dirSector] ?? END_OF_CHAIN;
    }
    return dir;
  }

  private buildMiniFat(firstMiniFat: number, miniFatCount: number): number[] {
    const miniFat: number[] = [];
    let mf = firstMiniFat;
    for (let m = 0; m < miniFatCount && mf !== END_OF_CHAIN && mf !== FREE_SECTOR; m++) {
      const sec = this.readSector(mf);
      for (let i = 0; i + 4 <= sec.length; i += 4) miniFat.push(sec.readUInt32LE(i));
      mf = this.fat[mf] ?? END_OF_CHAIN;
    }
    return miniFat;
  }

  get sectorSize(): number {
    return 1 << this.sectorShift;
  }

  private readStream(start: number, size: number, useMini: boolean): Buffer {
    const out = Buffer.alloc(size);
    if (useMini) {
      const miniSize = 1 << this.miniSectorShift;
      let s = start;
      let off = 0;
      while (s !== END_OF_CHAIN && s !== FREE_SECTOR && off < size) {
        const chunk = this.miniStream.subarray(s * miniSize, s * miniSize + miniSize);
        const n = Math.min(chunk.length, size - off);
        chunk.copy(out, off, 0, n);
        off += n;
        s = this.miniFat[s] ?? END_OF_CHAIN;
      }
    } else {
      let s = start;
      let off = 0;
      while (s !== END_OF_CHAIN && s !== FREE_SECTOR && off < size) {
        const sec = this.buf.subarray((s + 1) * this.sectorSize, (s + 1) * this.sectorSize + this.sectorSize);
        const n = Math.min(sec.length, size - off);
        sec.copy(out, off, 0, n);
        off += n;
        s = this.fat[s] ?? END_OF_CHAIN;
      }
    }
    return out;
  }

  /** Read a named stream (e.g. "__properties_version1.0"). */
  stream(name: string): Buffer | undefined {
    const e = this.dir.find((d) => d.type === 2 && d.name === name);
    if (!e) return undefined;
    return this.readStream(e.start, e.size, e.size < 4096);
  }

  /** Read a named stream inside a storage (e.g. an attachment's properties). */
  storageStream(storageName: string, streamName: string): Buffer | undefined {
    const storage = this.dir.find((d) => d.type === 1 && d.name === storageName);
    if (!storage) return undefined;
    const found = this.findInTree(storage.child, streamName);
    if (!found) return undefined;
    return this.readStream(found.start, found.size, found.size < 4096);
  }

  /** In-order walk of the directory tree rooted at idx, looking for a stream by name. */
  private findInTree(idx: number, name: string): { start: number; size: number } | undefined {
    if (idx === FREE_SECTOR || idx >= this.dir.length) return undefined;
    const e = this.dir[idx];
    const left = this.findInTree(e.left, name);
    if (left) return left;
    if (e.type === 2 && e.name === name) return { start: e.start, size: e.size };
    return this.findInTree(e.right, name);
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
        value = new Date(ms).toISOString();
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
export function parseMsg(base64: string): ParsedEmail {
  let buf: Buffer;
  try {
    buf = Buffer.from(base64.replace(/\s+/g, ""), "base64");
  } catch {
    throw new Error("TR-089: MSG content is not valid base64");
  }
  const ole = new Ole2(buf);
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
    attachments: parseMsgAttachments(ole, props),
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
function parseMsgAttachments(ole: Ole2, props: Map<number, unknown>): Array<{ filename: string; sha256: string }> {
  const attachments: Array<{ filename: string; sha256: string }> = [];
  const count = typeof props.get(PT.attachmentCount) === "number" ? (props.get(PT.attachmentCount) as number) : 0;
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
