import * as React from "react";
import { t } from "@ir/i18n";
import type { Graph } from "@ir/ledger/projections";

import { buildMapPoints, mapBounds, type MapPoint } from "./mapModel";
import { useSelection } from "../../store/selectionStore";

/**
 * P4-012: عرض الخريطة الجغرافية — MapLibre GL + بلاطات قابلة للتهيئة.
 *
 * الوضع المعزول (الافتراضي): لا بلاطات خارجية إطلاقاً — النقاط من إسقاط القضية
 * تُعرض كطبقة GeoJSON فوق خلفية نظيفة، فلا يغادر الطلب المتصفح أبداً. حقل
 * «رابط البلاطات» يسمح للمحقق بتهيئة مصدر بلاطات خاص به (رابط قالب
 * {z}/{x}/{y} لمخدم يختاره) — التهيئة صريحة وحالة عرض فقط ولا تُحفظ في
 * المتصفح (D-033: لا تخزين متصفح — البوابات تقيس storageWrites === 0).
 *
 * المكتبة تُستورد كسولاً (نمط sigma في InvestigationGraph — الترميز الساكن
 * يُعرض فوراً وMapLibre تُحمّل عند التركيب الفعلي). غياب WebGL يُعرض رسالة
 * صادقة (فشل-مغلق، لا فشل صامت) — والدليل الطرفي في map-view.spec.ts.
 *
 * بنية التركيب: قسم الخريطة التفاعلية مكوّن فرعي (`MapCanvasSection`) لا
 * يُركّب إلا عند وجود نقاط — فتأثيره يعمل والحاوية مضمونة الوجود (لو كان
 * التأثير في الجذر لحُمل قبل وصول نقاط القضية وعاد مبكراً بحاوية null ولا
 * يعاد تشغيله — علة واقعية كشفها e2e).
 *
 * الصدق: النقطة = ادعاء جغرافي واحد (لا دمج خفي)؛ «لا نقاط» تُقال كما هي؛
 * كل صف يحمل أدلته في title والنقر يختار العقدة (الترميز الساكن يُختبر في
 * الوحدة، والنقر الفعلي في e2e — عرف المستودع).
 */

/** Fitting padding (percent) around the points' bounds. */
const FIT_PADDING = 60;

function formatCoord(p: MapPoint): string {
  return `${p.lat},${p.lng}`;
}

function MapPointRow({ point, onSelect }: { point: MapPoint; onSelect?: (nodeId: string) => void }) {
  return (
    <li
      data-testid="map-point"
      data-node-id={point.nodeId}
      data-claim-id={point.claimId}
      title={t("workbench.map.evidenceTitle", { ids: point.evidenceIds.join(" · ") })}
      className="cursor-pointer border-b border-border py-2 text-sm last:border-b-0 hover:bg-muted/50"
      onClick={() => onSelect?.(point.nodeId)}
    >
      <span className="font-medium">{point.label}</span>{" "}
      <span dir="ltr" className="whitespace-nowrap text-muted-foreground">
        {formatCoord(point)}
      </span>
    </li>
  );
}

/** The interactive map — mounted ONLY when points exist (see the header note). */
function MapCanvasSection({
  points,
  appliedTiles,
  status,
  onSelectNode,
  onStatus,
}: {
  points: readonly MapPoint[];
  appliedTiles: string;
  status: "pending" | "ready" | "unavailable";
  onSelectNode?: (nodeId: string) => void;
  onStatus: (s: "pending" | "ready" | "unavailable") => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  // The circle layer's click handler needs the LATEST points and selection
  // callback without tearing the map down on every render (the same stability
  // rule as the graph's context menu).
  // The refs are synced AFTER render (lint forbids ref writes during render) —
  // the map's callbacks read the LATEST points/selection without tearing it down.
  const pointsRef = React.useRef(points);
  const onSelectRef = React.useRef(onSelectNode);
  React.useEffect(() => {
    pointsRef.current = points;
    onSelectRef.current = onSelectNode;
  });

  React.useEffect(() => {
    let disposed = false;
    let map: import("maplibre-gl").Map | null = null;
    // Lazy import — the static markup renders instantly; the GL library loads
    // on real mount only (sigma's pattern). A missing WebGL context is an
    // honest "unavailable", never a silent blank rectangle.
    import("maplibre-gl")
      .then((maplibre) => {
        if (disposed || !containerRef.current) return;
        const canvas = document.createElement("canvas");
        if (!canvas.getContext("webgl2") && !canvas.getContext("webgl")) {
          onStatus("unavailable");
          return;
        }
        // UMD interop (measured, not guessed): the built module exposes the API
        // either as named exports on the namespace or only on `default` — take
        // the shape that actually exposes the Map constructor (hard check).
        const withMap = (
          candidate: unknown,
        ): candidate is { Map: new (o: import("maplibre-gl").MapOptions) => import("maplibre-gl").Map } =>
          typeof (candidate as { Map?: unknown } | undefined)?.Map === "function";
        const ML = withMap(maplibre)
          ? maplibre
          : withMap((maplibre as { default?: unknown }).default)
            ? ((maplibre as { default: unknown }).default as typeof maplibre)
            : undefined;
        if (ML === undefined) {
          onStatus("unavailable");
          return;
        }
        const style: import("maplibre-gl").StyleSpecification = {
          version: 8,
          // Isolated mode's honest default: NO tiles — a clean background, the
          // case's own points render above it, and the browser issues no
          // external request. The raster source below is the investigator's
          // OWN configured tiles, added only when a URL is applied.
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "#0f172a" },
            },
          ],
          sources: {},
          // NOTE: `glyphs` is deliberately OMITTED — `glyphs: undefined` fails the
          // style spec's validation (measured in e2e), and no glyphs are needed:
          // the isolated style draws no symbol layers.
        };
        if (appliedTiles.trim() !== "") {
          style.sources = {
            tiles: {
              type: "raster",
              tiles: [appliedTiles.trim()],
              tileSize: 256,
              attribution: "",
            },
          };
          style.layers = [{ id: "tiles", type: "raster", source: "tiles", paint: {} }, ...style.layers];
        }
        const m = new ML.Map({
          container: containerRef.current,
          style,
          center: [39.8262, 21.4225], // replaced by fitBounds when there are points
          zoom: 1,
          attributionControl: false,
        });
        map = m;
        m.on("load", () => {
          if (disposed) return;
          m.addSource("case-points", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: pointsRef.current.map((p) => ({
                type: "Feature",
                properties: { nodeId: p.nodeId, label: p.label },
                geometry: { type: "Point", coordinates: [p.lng, p.lat] },
              })),
            },
          });
          m.addLayer({
            id: "case-points",
            type: "circle",
            source: "case-points",
            paint: {
              "circle-radius": 6,
              "circle-color": "#38bdf8",
              "circle-stroke-width": 1.5,
              "circle-stroke-color": "#e0f2fe",
            },
          });
          // Clicking a circle selects its node (the real interaction — the
          // same wiring as the timeline rows; the static markup tests readiness).
          m.on("click", "case-points", (e) => {
            const props = e.features?.[0]?.properties as { nodeId?: string } | undefined;
            if (typeof props?.nodeId === "string") onSelectRef.current?.(props.nodeId);
          });
          const b = mapBounds(pointsRef.current);
          if (b !== null) {
            m.fitBounds(
              [
                [b.minLng, b.minLat],
                [b.maxLng, b.maxLat],
              ],
              { padding: FIT_PADDING, maxZoom: 12, duration: 0 },
            );
          }
          onStatus("ready");
        });
      })
      .catch(() => {
        if (!disposed) onStatus("unavailable");
      });
    return () => {
      disposed = true;
      map?.remove();
    };
    // The effect intentionally depends only on the APPLIED tiles URL: a new map
    // is built when the tiles change, but the case's own point set is read
    // through the ref (a case refresh must not tear down a live map).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedTiles]);

  return <div ref={containerRef} data-testid="map-canvas" data-map-status={status} className="h-[320px] rounded border border-border" />;
}

export function MapView({ points, onSelectNode }: { points: readonly MapPoint[]; onSelectNode?: (nodeId: string) => void }) {
  const [tilesUrl, setTilesUrl] = React.useState("");
  const [appliedTiles, setAppliedTiles] = React.useState("");
  const [status, setStatus] = React.useState<"pending" | "ready" | "unavailable">("pending");

  return (
    <section aria-label={t("workbench.map.ariaLabel")} data-testid="map-view" className="rounded-md border border-border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("workbench.map.heading")}</h3>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="map-tiles-input">
            {t("workbench.map.tilesLabel")}
          </label>
          <input
            id="map-tiles-input"
            data-testid="map-tiles-input"
            type="url"
            className="w-64 rounded border border-border bg-background px-2 py-1 text-xs"
            placeholder={t("workbench.map.tilesPlaceholder")}
            value={tilesUrl}
            onChange={(e) => setTilesUrl(e.target.value)}
          />
          <button
            data-testid="map-tiles-apply"
            type="button"
            className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
            onClick={() => setAppliedTiles(tilesUrl)}
          >
            {t("workbench.map.tilesApply")}
          </button>
        </div>
      </div>
      {points.length === 0 ? (
        <div data-testid="map-no-points" className="py-6 text-sm text-muted-foreground">
          {t("workbench.map.noPoints")}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-[1fr_240px]">
          {status === "unavailable" ? (
            <div
              data-testid="map-unavailable"
              className="flex h-[320px] items-center justify-center rounded border border-border p-4 text-xs text-muted-foreground"
            >
              {t("workbench.map.unavailable")}
            </div>
          ) : (
            <MapCanvasSection
              points={points}
              appliedTiles={appliedTiles}
              status={status}
              onSelectNode={onSelectNode}
              onStatus={setStatus}
            />
          )}
          <ol className="max-h-72 overflow-auto">
            {points.map((p) => (
              <MapPointRow key={p.claimId} point={p} onSelect={onSelectNode} />
            ))}
          </ol>
        </div>
      )}
      {points.length > 0 && status === "unavailable" ? null : null}
    </section>
  );
}

export function MapViewContainer({ graph }: { graph: Graph }) {
  const points = React.useMemo(() => buildMapPoints(graph), [graph]);
  const selectNode = useSelection((s) => s.selectNode);
  return <MapView points={points} onSelectNode={selectNode} />;
}
