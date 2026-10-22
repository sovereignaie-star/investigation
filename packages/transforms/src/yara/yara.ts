/**
 * P4-021 — the YARA subset engine (محوّل محلي LC-A; no network, nothing is ever
 * executed — scanning is STATIC byte matching only, PB-07's rule extended to
 * whole files).
 *
 * The documented subset (anything else is a TYPED refusal — never a guess):
 * - strings: `$id = "text"` with modifiers `ascii|wide|nocase|fullword`, or
 *   `$id = { hex bytes }` where `??` is a wildcard nibble pair;
 * - conditions: `and`/`or`/`not`, `$id` (optionally `$id at N` or with an
 *   occurrence-count comparison), `filesize <op> N` (N may carry KB/MB),
 *   `uint8|16|32[be](N) <op> M`, and `all|any|N of them` / `N of ($prefix*)`.
 * No modules (pe./hash./…), no regex strings, no xor/base64 modifiers, no
 * jumps `[n]` in hex, no loops — refused with {@link YaraSubsetError}.
 *
 * The frozen rules of record are the YARA Forge core pack (raw text,
 * rules.generated.ts) — a test enforces the parser reads every one.
 */

/** A typed refusal: the rule is outside the documented subset. */
export class YaraSubsetError extends Error {
  constructor(readonly reason: string) {
    super(`YARA subset: ${reason}`);
  }
}

export interface YaraTextString {
  id: string;
  kind: "text";
  value: string;
  modifiers: string[];
}
export interface YaraHexString {
  id: string;
  kind: "hex";
  /** Bytes of the pattern; null = wildcard (??). */
  bytes: (number | null)[];
}
export type YaraString = YaraTextString | YaraHexString;

type Cmp = "==" | "!=" | "<" | "<=" | ">" | ">=";

export type YaraCondition =
  | { k: "and"; terms: YaraCondition[] }
  | { k: "or"; terms: YaraCondition[] }
  | { k: "not"; term: YaraCondition }
  | { k: "ref"; id: string; at?: number; cmp?: { op: Cmp; n: number } }
  | { k: "filesize"; op: Cmp; n: number }
  | { k: "uint"; size: 8 | 16 | 32; be: boolean; offset: number; op: Cmp; n: number }
  | { k: "of"; count: "all" | "any" | number; prefix?: string };

export interface YaraRule {
  name: string;
  tags: string[];
  meta: Record<string, string | number>;
  strings: YaraString[];
  condition: YaraCondition;
}

export interface YaraMatch {
  ruleName: string;
  /** Every string hit that contributed: [stringId, offset]. */
  matches: { id: string; offset: number }[];
}

/* ------------------------------------------------------------------ parse */

const RULE_HEAD = /^rule\s+(\w+)\s*(?::\s*([\w\s,]+))?\s*\{/;

export function parseYaraRule(text: string): YaraRule {
  const body = stripComments(text).trim();
  const head = RULE_HEAD.exec(body);
  if (!head) throw new YaraSubsetError("no `rule name {` head");
  const name = head[1];
  const tags = (head[2] ?? "").split(/[,\s]+/).filter(Boolean);
  const sections = body.slice(head[0].length);
  const meta = parseMeta(sections);
  const strings = parseStrings(sections);
  const condition = parseCondition(sections);
  return { name, tags, meta, strings, condition };
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
}

function sectionOf(text: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:strings|condition|meta)\\s*:|\\s*}\\s*$)`).exec(text);
  return m ? m[1] : "";
}

function parseMeta(text: string): Record<string, string | number> {
  const meta: Record<string, string | number> = {};
  for (const m of sectionOf(text, "meta").matchAll(/^\s*(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|-?\d+)\s*$/gm)) {
    const raw = m[2];
    meta[m[1]] = raw.startsWith('"') ? JSON.parse(raw) : Number(raw);
  }
  return meta;
}

function parseStrings(text: string): YaraString[] {
  const body = sectionOf(text, "strings");
  if (!body.trim()) throw new YaraSubsetError("no strings section (a rule without strings has no signal)");
  const out: YaraString[] = [];
  const defs = body.matchAll(
    /\$(\w+)\s*=\s*(?:"(?:[^"\\]|\\.)*"|\{[\s\S]*?\})(?:\s+(?:ascii|wide|nocase|fullword|private))*\s*(?=\$|\s*$)/g,
  );
  for (const d of defs) {
    const id = d[1];
    const valueMatch = /^\$(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|\{[\s\S]*?\})((?:\s+\w+)*)/.exec(d[0]);
    if (!valueMatch) throw new YaraSubsetError(`unparsable string definition $${id}`);
    const value = valueMatch[2];
    const mods = valueMatch[3].trim().split(/\s+/).filter(Boolean);
    if (value.startsWith('"')) {
      if (mods.some((m) => !["ascii", "wide", "nocase", "fullword", "private"].includes(m))) {
        throw new YaraSubsetError(`unsupported string modifier on $${id}`);
      }
      out.push({ id, kind: "text", value: JSON.parse(value), modifiers: mods });
    } else {
      if (mods.length > 0 && mods.some((m) => m !== "private")) throw new YaraSubsetError(`hex strings take no modifiers ($${id})`);
      out.push({ id, kind: "hex", bytes: parseHexBytes(value) });
    }
  }
  if (out.length === 0) throw new YaraSubsetError("no string definitions parsed");
  return out;
}

function parseHexBytes(value: string): (number | null)[] {
  const inner = value
    .replace(/^\{|\}$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = inner.split(" ").filter(Boolean);
  const bytes: (number | null)[] = [];
  for (const tok of tokens) {
    // YARA allows unspaced hex ({41424344}); normalize long tokens to pairs
    const pairs = tok.length > 2 && /^[0-9A-Fa-f?]+$/.test(tok) ? (tok.match(/.{1,2}/g) ?? []) : [tok];
    for (const pair of pairs) {
      if (pair === "??") bytes.push(null);
      else if (/^[0-9A-Fa-f]{2}$/.test(pair)) bytes.push(parseInt(pair, 16));
      else throw new YaraSubsetError(`unsupported hex token ${pair} (jumps/wildcards beyond ?? are outside the subset)`);
    }
  }
  if (bytes.length === 0) throw new YaraSubsetError("empty hex string");
  return bytes;
}

/* -------------------------------------------------------------- condition */

const TOKEN = /\(|\)|==|!=|<=|>=|<|>|\$[\w*]+|[\w.]+|\d+(?:KB|MB)?|0x[0-9A-Fa-f]+/gi;

function tokenizeCondition(text: string): string[] {
  const cond = sectionOf(text, "condition");
  if (!cond.trim()) throw new YaraSubsetError("no condition section");
  const toks = cond.match(new RegExp(TOKEN.source, "g")) ?? [];
  if (toks.length === 0) throw new YaraSubsetError("empty condition");
  return toks;
}

function number(tok: string, what: string): number {
  const m = /^(\d+)(KB|MB)?$/i.exec(tok) ?? /^0x[0-9A-Fa-f]+$/i.exec(tok);
  if (!m) throw new YaraSubsetError(`bad number ${tok} in ${what}`);
  if (tok.toLowerCase().startsWith("0x")) return parseInt(tok, 16);
  const mult = m[2]?.toUpperCase() === "KB" ? 1024 : m[2]?.toUpperCase() === "MB" ? 1024 * 1024 : 1;
  return Number(m[1]) * mult;
}

const CMP: string[] = ["==", "!=", "<", "<=", ">", ">="];

function parseCondition(text: string): YaraCondition {
  const toks = tokenizeCondition(text);
  let pos = 0;
  const peek = (): string | undefined => toks[pos];
  const next = (): string => {
    const t = toks[pos++];
    if (t === undefined) throw new YaraSubsetError("condition ended early");
    return t;
  };
  const parseExpr = (): YaraCondition => {
    const terms = [parseAnd()];
    while (peek() === "or") {
      next();
      terms.push(parseAnd());
    }
    return terms.length === 1 ? terms[0] : { k: "or", terms };
  };
  const parseAnd = (): YaraCondition => {
    const terms = [parseNot()];
    while (peek() === "and") {
      next();
      terms.push(parseNot());
    }
    return terms.length === 1 ? terms[0] : { k: "and", terms };
  };
  const parseNot = (): YaraCondition => (peek() === "not" ? (next(), { k: "not", term: parseNot() }) : parsePrimary());
  const parsePrimary = (): YaraCondition => {
    if (peek() === "(") {
      next();
      const e = parseExpr();
      if (next() !== ")") throw new YaraSubsetError("unbalanced parentheses");
      return e;
    }
    return parseAtom();
  };
  const parseAtom = (): YaraCondition => {
    const t = next();
    if (t === "filesize") return { k: "filesize", op: cmpTok(next()), n: number(next(), "filesize") };
    if (/^uint(8|16|32)(be)?$/.test(t)) return parseUintAtom(t);
    if (t.startsWith("$")) return parseRefAtom(t.slice(1));
    if (t === "all" || t === "any" || /^\d+$/.test(t)) return parseOfAtom(t);
    throw new YaraSubsetError(`unsupported condition token ${t}`);
  };
  const cmpTok = (tok: string): Cmp => {
    if (!CMP.includes(tok)) throw new YaraSubsetError(`bad comparison ${tok}`);
    return tok as Cmp;
  };
  const parseUintAtom = (t: string): YaraCondition => {
    const m = /^(uint)(8|16|32)(be)?$/.exec(t);
    if (!m) throw new YaraSubsetError(`bad uint ${t}`);
    const inner = next();
    if (inner !== "(") throw new YaraSubsetError("uint takes an offset in parentheses");
    const offset = number(next(), "uint offset");
    if (next() !== ")") throw new YaraSubsetError("unbalanced uint(...)");
    return {
      k: "uint",
      size: Number(m[2]) as 8 | 16 | 32,
      be: m[3] === "be",
      offset,
      op: cmpTok(next()),
      n: number(next(), "uint"),
    };
  };
  const parseRefAtom = (id: string): YaraCondition => {
    if (peek() === "at") {
      next();
      return { k: "ref", id, at: number(next(), "at") };
    }
    const ahead = peek();
    if (ahead !== undefined && CMP.includes(ahead)) {
      const op = next();
      return { k: "ref", id, cmp: { op: op as Cmp, n: number(next(), "count") } };
    }
    return { k: "ref", id };
  };
  const parseOfAtom = (t: string): YaraCondition => {
    if (next() !== "of") throw new YaraSubsetError("expected `of`");
    const target = next();
    const count = t === "all" ? ("all" as const) : t === "any" ? ("any" as const) : Number(t);
    if (target === "them") return { k: "of", count };
    if (target !== "(") throw new YaraSubsetError(`unsupported of-target ${target}`);
    const first = next();
    if (!first.endsWith("*")) {
      // explicit id lists and non-wildcard targets are outside the subset
      throw new YaraSubsetError("explicit of-lists are outside the subset (use $prefix*)");
    }
    if (next() !== ")") throw new YaraSubsetError("unbalanced of(...)");
    return { k: "of", count, prefix: first.slice(1, -1) };
  };
  const cond = parseExpr();
  if (pos !== toks.length) throw new YaraSubsetError(`trailing tokens: ${toks.slice(pos).join(" ")}`);
  return cond;
}

/* ------------------------------------------------------------------ scan */

/** Find every occurrence of one rule string in the data. */
function findString(s: YaraString, data: Uint8Array): number[] {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (s.kind === "text") return findTextString(s, buf);
  return findHexString(s.bytes, buf);
}

const isWordByte = (b: number): boolean => /[A-Za-z0-9]/.test(String.fromCharCode(b));

/** A hit counts only when its edges are not word bytes (fullword). */
function pushIfFullword(out: number[], buf: Buffer, off: number, len: number, fullword: boolean): void {
  if (!fullword) {
    out.push(off);
    return;
  }
  const before = off === 0 ? 0 : buf[off - 1];
  const after = off + len >= buf.length ? 0 : buf[off + len];
  if (!isWordByte(before) && !isWordByte(after)) out.push(off);
}

function findTextString(s: YaraTextString, buf: Buffer): number[] {
  const out: number[] = [];
  const wide = s.modifiers.includes("wide");
  const nocase = s.modifiers.includes("nocase");
  const fullword = s.modifiers.includes("fullword");
  for (const pattern of variantsOf(s.value, wide)) {
    const needle = Buffer.from(nocase ? pattern.toLowerCase() : pattern, "latin1");
    const hay = nocase ? Buffer.from(buf.toString("latin1").toLowerCase(), "latin1") : buf;
    let off = hay.indexOf(needle);
    while (off !== -1) {
      pushIfFullword(out, buf, off, needle.length, fullword);
      off = hay.indexOf(needle, off + 1);
    }
  }
  return out;
}

/** hex: sliding window with wildcard (null) bytes. */
function findHexString(bytes: readonly (number | null)[], buf: Buffer): number[] {
  const out: number[] = [];
  outer: for (let off = 0; off + bytes.length <= buf.length; off++) {
    for (let i = 0; i < bytes.length; i++) {
      const want = bytes[i];
      if (want !== null && buf[off + i] !== want) continue outer;
    }
    out.push(off);
  }
  return out;
}

/** The text encodings to search: wide (UTF-16LE) when asked, ASCII/Latin-1 otherwise. */
function variantsOf(value: string, wide: boolean): string[] {
  const asciiVariant = value;
  if (!wide) return [asciiVariant];
  const utf16 = value
    .split("")
    .map((c) => `${c}\x00`)
    .join("");
  return [utf16, asciiVariant];
}

const applyCmp = (op: Cmp, a: number, b: number): boolean =>
  op === "==" ? a === b : op === "!=" ? a !== b : op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b;

function readUint(data: Uint8Array, offset: number, size: 8 | 16 | 32, be: boolean): number {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (offset < 0 || offset + size / 8 > buf.length) return NaN;
  if (size === 8) return buf[offset];
  if (size === 16) return be ? buf.readUInt16BE(offset) : buf.readUInt16LE(offset);
  return be ? buf.readUInt32BE(offset) : buf.readUInt32LE(offset);
}

interface ScanContext {
  hits: Map<string, number[]>;
  size: number;
  data: Uint8Array;
}

/** Evaluate a condition against the precomputed string matches. */
function evaluate(cond: YaraCondition, ctx: ScanContext): boolean {
  switch (cond.k) {
    case "and":
      return cond.terms.every((t) => evaluate(t, ctx));
    case "or":
      return cond.terms.some((t) => evaluate(t, ctx));
    case "not":
      return !evaluate(cond.term, ctx);
    case "filesize":
      return applyCmp(cond.op, ctx.size, cond.n);
    case "uint":
      return applyCmp(cond.op, readUint(ctx.data, cond.offset, cond.size, cond.be), cond.n);
    case "ref":
      return evaluateRef(cond, ctx);
    case "of":
      return evaluateOf(cond, ctx);
  }
}

function evaluateRef(cond: Extract<YaraCondition, { k: "ref" }>, ctx: ScanContext): boolean {
  const hits = ctx.hits.get(cond.id) ?? [];
  if (cond.at !== undefined) return hits.includes(cond.at);
  if (cond.cmp !== undefined) return applyCmp(cond.cmp.op, hits.length, cond.cmp.n);
  return hits.length > 0;
}

function evaluateOf(cond: Extract<YaraCondition, { k: "of" }>, ctx: ScanContext): boolean {
  const ids = [...ctx.hits.keys()].filter((id) => cond.prefix === undefined || id.startsWith(cond.prefix));
  const present = ids.filter((id) => (ctx.hits.get(id) ?? []).length > 0).length;
  if (cond.count === "all") return ids.length > 0 && present === ids.length;
  if (cond.count === "any") return present > 0;
  return present >= cond.count;
}

/** Scan the data against the rules (static matching only). */
export function scanYara(rules: readonly YaraRule[], data: Uint8Array): YaraMatch[] {
  const out: YaraMatch[] = [];
  for (const rule of rules) {
    const hits = new Map<string, number[]>();
    for (const s of rule.strings) hits.set(s.id, findString(s, data));
    if (evaluate(rule.condition, { hits, size: data.length, data })) {
      out.push({
        ruleName: rule.name,
        matches: [...hits.entries()].flatMap(([id, offsets]) => offsets.map((offset) => ({ id, offset }))),
      });
    }
  }
  return out;
}
