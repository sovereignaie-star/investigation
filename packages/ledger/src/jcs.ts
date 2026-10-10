/**
 * JSON Canonicalization Scheme, RFC 8785 (https://www.rfc-editor.org/rfc/rfc8785).
 * - object members sorted by UTF-16 code units of their names, no whitespace;
 * - numbers serialized as ECMAScript Number.prototype.toString (-0 -> 0), non-finite numbers rejected;
 * - strings escaped as in ECMAScript JSON.stringify; lone surrogates rejected (I-JSON, RFC 7493).
 * Anything that is not plain JSON (undefined, functions, symbols, bigint, Date, Map, class instances) is rejected
 * instead of being silently dropped or coerced, so a hash always covers exactly what was given.
 */
export class JcsError extends TypeError {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`JCS: ${reason} at ${path || "$"}`);
    this.name = "JcsError";
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function str(s: string, path: string): string {
  if (LONE_SURROGATE.test(s)) throw new JcsError(path, "lone surrogate in string");
  return JSON.stringify(s);
}

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function canonicalize(value: unknown): string {
  const seen = new Set<object>();
  const walk = (v: unknown, path: string): string => {
    if (v === null) return "null";
    switch (typeof v) {
      case "boolean":
        return v ? "true" : "false";
      case "number":
        if (!Number.isFinite(v)) throw new JcsError(path, `non-finite number ${v}`);
        return Object.is(v, -0) ? "0" : String(v);
      case "string":
        return str(v, path);
      case "object":
        break;
      default:
        throw new JcsError(path, `unsupported type ${typeof v}`);
    }
    if (seen.has(v)) throw new JcsError(path, "circular reference");
    seen.add(v);
    let out: string;
    if (Array.isArray(v)) {
      out = `[${v.map((x, i) => walk(x, `${path}[${i}]`)).join(",")}]`;
    } else if (isPlainObject(v)) {
      const rec = v as Record<string, unknown>;
      const keys = Object.keys(rec).sort(); // default sort = UTF-16 code unit order, as RFC 8785 3.2.3 requires
      out = `{${keys.map((k) => `${str(k, path)}:${walk(rec[k], `${path}.${k}`)}`).join(",")}}`;
    } else {
      throw new JcsError(path, `non-plain object ${Object.prototype.toString.call(v)}`);
    }
    seen.delete(v);
    return out;
  };
  return walk(value, "");
}
