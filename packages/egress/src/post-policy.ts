/**
 * ADR-30 (owner decision 2026-10-17): the declarative POST body schema — the generic shape a
 * provider's POST body must match EXACTLY. The walker below enforces it; the values it walks
 * are never echoed into a denial detail (only the expected shape is named).
 */

/** The fixed POST body schema: a closed descriptor of fields, types and length caps. */
export type PostBodySchema =
  | { type: "string"; maxLength?: number; enum?: readonly string[] }
  | { type: "literal"; value: string }
  | { type: "object"; exactKeys: readonly string[]; fields: Record<string, PostBodySchema> }
  | { type: "keysFrom"; allowed: readonly string[]; min: number; max: number; value: PostBodySchema }
  | { type: "array"; length: number; item: PostBodySchema };

/** ADR-30: one complete declared POST policy record (see providers/post-policies.ts for the table). */
export interface PostPolicy {
  /** The pinned host (exact, after normalisation). */
  readonly host: string;
  /** The exact request path this policy covers. */
  readonly path: string;
  /** The request kind: token (an OAuth2 credential exchange), match (a screening), search. */
  readonly kind: "token" | "match" | "search";
  /** The body format: x-www-form-urlencoded or JSON. */
  readonly format: "form" | "json";
  /** The FIXED body schema the gateway enforces. */
  readonly schema: PostBodySchema;
  /** The body size cap in bytes (defaults to 4096 — ADR-30). */
  readonly maxBodyBytes?: number;
  /** The field-by-field source in the provider's official docs (the review record). */
  readonly fieldsSource: string;
  /** The provider's contractual terms summary (what it permits and forbids). */
  readonly terms: string;
}

/** The ADR-30 default body cap. */
export const POST_POLICY_DEFAULT_MAX_BODY_BYTES = 4096;

interface ShapeError {
  readonly message: string;
}

function shapeError(message: string): ShapeError {
  return { message };
}

/** Each schema type's check, kept small (the walker dispatches; each branch is its own function). */
function stringSchemaError(schema: Extract<PostBodySchema, { type: "string" }>, value: unknown, what: string): ShapeError | null {
  if (typeof value !== "string" || value === "") return shapeError(`${what} must be a non-empty string`);
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    return shapeError(`${what} must be at most ${schema.maxLength} characters`);
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    return shapeError(`${what} must be one of the declared values (${schema.enum.join("/")})`);
  }
  return null;
}

function objectSchemaError(schema: Extract<PostBodySchema, { type: "object" }>, value: unknown, what: string): ShapeError | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return shapeError(`${what} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [...schema.exactKeys].sort();
  if (keys.join(",") !== expected.join(",")) {
    return shapeError(`${what} must have exactly the fields [${expected.join(",")}]`);
  }
  for (const key of schema.exactKeys) {
    const err = jsonSchemaError(schema.fields[key], record[key], `${what}.${key}`);
    if (err) return err;
  }
  return null;
}

function keysFromSchemaError(schema: Extract<PostBodySchema, { type: "keysFrom" }>, value: unknown, what: string): ShapeError | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return shapeError(`${what} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length < schema.min || keys.length > schema.max) {
    return shapeError(`${what} must have ${schema.min} to ${schema.max} fields`);
  }
  for (const key of keys) {
    if (!schema.allowed.includes(key)) {
      return shapeError(`${what} fields must come from [${schema.allowed.join(",")}]`);
    }
    const err = jsonSchemaError(schema.value, record[key], `${what}.${key}`);
    if (err) return err;
  }
  return null;
}

function arraySchemaError(schema: Extract<PostBodySchema, { type: "array" }>, value: unknown, what: string): ShapeError | null {
  if (!Array.isArray(value) || value.length !== schema.length) {
    return shapeError(`${what} must be an array of exactly ${schema.length} item(s)`);
  }
  for (const item of value) {
    const err = jsonSchemaError(schema.item, item, `${what}[]`);
    if (err) return err;
  }
  return null;
}

/** A schema walk over a JSON value — the error names the expected shape, never the actual value. */
export function jsonSchemaError(schema: PostBodySchema, value: unknown, what: string): ShapeError | null {
  if (schema.type === "string") return stringSchemaError(schema, value, what);
  if (schema.type === "literal") return value === schema.value ? null : shapeError(`${what} must be exactly the declared value`);
  if (schema.type === "object") return objectSchemaError(schema, value, what);
  if (schema.type === "keysFrom") return keysFromSchemaError(schema, value, what);
  return arraySchemaError(schema, value, what);
}

/** A schema walk over a form-urlencoded body (an exact key set with per-field constraints). */
export function formSchemaError(schema: PostBodySchema, body: string, what: string): ShapeError | null {
  if (schema.type !== "object") return shapeError(`${what} must be a form body of fixed fields`);
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(body);
  } catch {
    return shapeError(`${what} must be application/x-www-form-urlencoded`);
  }
  const keys = [...params.keys()].sort();
  const expected = [...schema.exactKeys].sort();
  if (keys.join(",") !== expected.join(",")) {
    return shapeError(`${what} must have exactly the fields [${expected.join(",")}]`);
  }
  for (const key of schema.exactKeys) {
    const err = jsonSchemaError(schema.fields[key], params.get(key) ?? "", `${what}.${key}`);
    if (err) return err;
  }
  return null;
}
