/**
 * P2-011 — TR-030: Nominatim (address ↔ coordinates; the OSM public geocoder).
 *
 * Source: nominatim.openstreetmap.org, public, no key (LC-B; evaluation docs/tools/evaluations/TL-82f1b0d7.md).
 * Two directions: forward (a street address → the best OSM feature with its coordinates) and reverse
 * (a "lat,lng" pair → the nearest OSM feature and its address). The Nominatim usage policy caps the public
 * service at 1 request/second — the manifest declares rps 1 and the gateway enforces it per host.
 * All network I/O goes through `ctx.http` (egress gateway in production, ADR-08).
 *
 * Limits: rps 1 (usage policy), timeoutMs 15s, maxBytes 1MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { parseJson } from "./util.ts";

const API = "https://nominatim.openstreetmap.org";

type Http = { http: { get(url: string): Promise<{ body: string; requestId: number }> } };

function requireAddress(raw: string | undefined): string | undefined {
  const a = raw?.trim();
  if (!a) return undefined;
  if (a.length < 5 || a.length > 300) throw new Error(`TR-030: invalid address "${raw}"`);
  return a;
}

function requirePoint(raw: string | undefined): string | undefined {
  const p = raw?.trim();
  if (!p) return undefined;
  if (!/^-?\d{1,2}(?:\.\d{1,8})?,\s*-?\d{1,3}(?:\.\d{1,8})?$/.test(p)) throw new Error(`TR-030: invalid point "${raw}"`);
  return p.replace(/\s+/g, "");
}

/** Forward geocoding: an address → the best OSM feature's coordinates. */
async function forward(address: string, ctx: Http) {
  const res = await ctx.http.get(`${API}/search?q=${encodeURIComponent(address)}&format=json&limit=1`);
  const data = parseJson(res.body, "Nominatim") as NominatimPlace[];
  const first = Array.isArray(data) ? data[0] : undefined;
  if (!first?.lat || !first?.lon) return { findings: [] };
  return {
    findings: [
      { ...pointFinding(first.lat, first.lon, 0.8, `Nominatim: "${first.display_name ?? address}" is at`), evidence: [res.requestId] },
    ],
  };
}

/** Reverse geocoding: a "lat,lng" pair → the nearest OSM feature's display name. */
async function reverse(point: string, ctx: Http) {
  const [lat, lon] = point.split(",").map((p) => p.trim());
  const res = await ctx.http.get(`${API}/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&format=json`);
  const data = parseJson(res.body, "Nominatim") as NominatimPlace & { error?: string };
  if (!data?.display_name) return { findings: [] };
  return {
    findings: [{ ...nameFinding(data.display_name, 0.8, `Nominatim: (${lat}, ${lon}) is at`), evidence: [res.requestId] }],
  };
}

interface NominatimPlace {
  place_id?: number;
  lat?: string;
  lon?: string;
  display_name?: string;
  type?: string;
  class?: string;
}

function pointFinding(lat: string, lon: string, confidence: number, explanation: string): TransformFinding {
  return {
    predicate: "has_coordinates",
    objectType: "geo_point",
    objectValue: `${lat},${lon}`,
    confidence,
    explanation,
  };
}

function nameFinding(displayName: string, confidence: number, explanation: string): TransformFinding {
  return {
    predicate: "has_display_name",
    objectType: "street_address",
    objectValue: displayName,
    confidence,
    explanation,
  };
}

export const nominatimGeocode = defineTransform<{ address?: string; point?: string }>(
  {
    id: "TR-030",
    version: "1.0.0",
    inputs: ["street_address", "geo_point"],
    outputs: ["geo_point", "street_address"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-B",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "C",
      credibility: 4,
      rationale: "Nominatim/بيانات OpenStreetMap مجتمعية التحرير — تغطية جغرافية ممتازة نسبياً مع أخطاء تحرير فردية واردة",
    },
  },
  async (input, ctx) => {
    const address = requireAddress(input.address);
    const point = requirePoint(input.point);
    if (address) return forward(address, ctx);
    if (point) return reverse(point, ctx);
    throw new Error("TR-030: an address or a point is required");
  },
);
