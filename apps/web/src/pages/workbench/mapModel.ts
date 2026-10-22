import type { Graph, GraphNode } from "@ir/ledger/projections";
import { detectBest } from "@ir/core/identifiers";

/**
 * P4-012: النموذج النقي لعرض الخريطة الجغرافية — استخراج النقاط من إسقاط القضية.
 *
 * الصدق أولاً: القيمة الحرفية تُقبل كنقطة جغرافية فقط إذا كان نوعها `geo_point`
 * في كتالوج المعرّفات الحقيقي (الكشف بمحرك @ir/core نفسه الذي تستخدمه الواجهة —
 * لا نمط منسوخ ولا تخمين). أي قيمة يرفضها الكتالوج لا تُعرض على الخريطة.
 * ادعاءات جغرافية متعددة لنفس العقدة تبقى متعددة (لا دمج خفي للادعاءات) —
 * كل نقطة تحمل أدلتها وثقتها، والعرض مربوط بالدليل.
 *
 * الترتيب حتمي: بترتيب إدراج العقد ثم إدراج الادعاءات (كما يفرزها الإسقاط).
 */

/** One geographic point on the map — one geo claim of one node (not one node). */
export interface MapPoint {
  nodeId: string;
  claimId: string;
  label: string;
  lat: number;
  lng: number;
  confidence: number;
  evidenceIds: string[];
}

/** Is this attribute's literal value a `geo_point` per the real catalog? */
function geoOf(a: GraphNode["attributes"][number]): { lat: number; lng: number } | null {
  if (typeof a.value !== "string") return null;
  const best = detectBest(a.value);
  if (best?.type !== "geo_point") return null;
  // The catalog's own examples are "lat,lng" in decimal degrees (WGS84); the
  // positive pattern guarantees the shape — parse defensively anyway (fail-safe:
  // a value that no longer parses is not a point, never a crash).
  const m = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(a.value.trim());
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

const labelOf = (n: GraphNode): string => n.labels.ar ?? n.labels.en ?? n.canonicalKey;

/** All geographic points of the projection — every geo claim, in insertion order. */
export function buildMapPoints(graph: Graph): MapPoint[] {
  const points: MapPoint[] = [];
  for (const n of graph.nodes) {
    for (const a of n.attributes) {
      const geo = geoOf(a);
      if (geo === null) continue;
      points.push({
        nodeId: n.id,
        claimId: a.claimId,
        label: labelOf(n),
        lat: geo.lat,
        lng: geo.lng,
        confidence: a.confidence,
        evidenceIds: a.evidenceIds,
      });
    }
  }
  return points;
}

/** The map's fit-bounds rectangle — null when there is nothing to fit. */
export function mapBounds(points: readonly MapPoint[]): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} | null {
  if (points.length === 0) return null;
  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLng = points[0].lng;
  let maxLng = points[0].lng;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}
