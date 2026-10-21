/**
 * P4-003 (ROADMAP 6.4) — independence detection: the rules that decide when two
 * "sources" are actually ONE original. The 5.13 model never lets repetition
 * raise confidence, so the grouping key is the source's CANONICAL identity:
 *
 * Rules (declarative, all tested):
 * 1. Host-level identity: scheme, credentials, default ports, path, query and
 *    fragment are NOT part of a source's identity — `https://www.example.com/a?x`
 *    and `example.com` are ONE source (the outlet), not two.
 * 2. `www.` is not part of the host identity.
 * 3. Host identity is case-insensitive (DNS is).
 * 4. Known mirrors/aliases are declared as DATA (the alias table): a mirror of
 *    an original IS that original for grouping (aliases resolve transitively,
 *    cycle-safe). Registering an alias is a reviewed decision — never inferred
 *    from content (two outlets independently reporting the same fact is
 *    CORROBORATION and must raise confidence; only a declared mirror is
 *    repetition).
 * 5. A plain source name (not a URL) is normalized as-is (an outlet name).
 *
 * The acceptance (التكرار لا يرفع الثقة): claimConfidence groups observations
 * by this canonical key, and merged repetitions are REPORTED (result.repetitions),
 * never silently counted.
 */

/** A declared mirror: `alias` is (a part of) the same original as `canonical`. */
const SOURCE_ALIASES = new Map<string, string>();

/** Register a mirror/alias: observations from `alias` group under `canonical`. */
export function registerSourceAlias(alias: string, canonical: string): void {
  SOURCE_ALIASES.set(hostKey(alias), hostKey(canonical));
}

/** Test hook: clear the alias table. Production code registers aliases once at startup. */
export function resetSourceAliases(): void {
  SOURCE_ALIASES.clear();
}

/** The host part of a source string, or the normalized name if it is not a URL. */
function hostKey(source: string): string {
  return canonicalSource(source);
}

/**
 * Resolve an alias transitively (a mirror of a mirror), cycle-safe: a cycle in
 * the declared data can never loop forever — the first repeated host wins.
 */
function resolveAlias(host: string): string {
  const seen = new Set<string>();
  let current = host;
  while (SOURCE_ALIASES.has(current) && !seen.has(current)) {
    seen.add(current);
    current = SOURCE_ALIASES.get(current) as string;
  }
  return current;
}

const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
/** host(“labels joined by dots”), optionally followed by a path/query — a scheme-less URL. */
const BARE_HOST = /^[\w-]+(\.[\w-]+)+([/:?#].*)?$/;

/**
 * The canonical identity of a source — the grouping key of the 5.13 model.
 * Pure, total (never throws, never returns a different value for equal inputs).
 */
export function canonicalSource(source: string): string {
  const trimmed = source.trim();
  if (trimmed === "") return "";
  let candidate = trimmed;
  if (!URL_SCHEME.test(candidate) && !candidate.startsWith("//")) {
    if (!BARE_HOST.test(candidate)) {
      // a plain outlet/registry name — normalize conservatively (case, shape)
      return trimmed.toLowerCase();
    }
    candidate = `https://${candidate}`;
  } else if (!URL_SCHEME.test(candidate)) {
    candidate = `https:${candidate}`;
  }
  let host: string;
  try {
    host = new URL(candidate).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return trimmed.toLowerCase();
  }
  const bare = host.replace(/^www\./, "");
  return resolveAlias(bare);
}
