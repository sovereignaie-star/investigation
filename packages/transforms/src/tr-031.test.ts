/**
 * P2-012 — TR-031 contract test (T-RULE-06). Image metadata (EXIF/XMP/GPS),
 * LOCAL ONLY (owner decision 2026-10-16: ExifReader, MPL-2.0 — see DECLARED_LIMITS
 * L-16; replaces the ROADMAP's exifr/ExifTool note). The transform takes a
 * base64-encoded image and extracts EXIF facts — camera make+model, GPS
 * coordinates, capture time — with ZERO network requests (findings cite
 * `derivedFrom: "input"`; the runner refuses evidence citations in a run that
 * made no request).
 *
 * Library behavior MEASURED 2026-10-16 before the transform existed:
 *   - a valid JPEG without EXIF => { FileType: "JPEG" } — no tags, no throw
 *     (a photo without metadata is a legitimate empty result, like TR-039's
 *     absent username);
 *   - random bytes => throws "Invalid image format" (fail-closed material).
 *
 * The test image is crafted in the helper: a minimal JPEG (SOI + APP1 EXIF +
 * EOI) carrying Make="TestCam", Model="X100", DateTimeOriginal
 * "2026:01:02 03:04:05" and GPS 21°29'8.12"N 39°11'4.49"E (valid DMS
 * rationals — seconds below 60 — with hemisphere refs), which is
 * 21.485589,39.184581 in decimal degrees.
 *
 * The acceptance review (2026-10-16) added: a southern/western variant (S/W
 * refs make both coordinates negative), a GPS-without-refs case (the
 * transform must NOT guess the hemisphere — no geo finding is emitted), and
 * an XMP-only image (CreatorTool → "created_with"/"application").
 *
 * Red first: the original tests were written before the transform existed and
 * failed on the missing module. The no-refs and XMP tests were red against
 * the first implementation (it assumed N/E and had no XMP finding — the
 * failing tests for the right reasons before the corrective fix).
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { exifMetadata } from "./transforms/tr-031-exif-metadata.ts";
import { runTransform } from "./runner.ts";

/** The sim server's transport shape — the counting wrapper keeps it. */
type SimTransport = ReturnType<typeof createSimServer>["transport"];

/** A transport that counts every fetch: the local analysis must issue none. */
function counting(t: SimTransport): { transport: SimTransport; calls: () => number } {
  let n = 0;
  return {
    calls: () => n,
    transport: {
      ...t,
      fetch: (...args: Parameters<SimTransport["fetch"]>) => {
        n++;
        return t.fetch(...args);
      },
    },
  };
}

/**
 * Hemisphere refs: "N"/"S" for latitude, "E"/"W" for longitude, or null to omit
 * the ref entries entirely (the transform must not guess the hemisphere).
 */
interface GpsRefs {
  lat: "N" | "S" | null;
  lng: "E" | "W" | null;
}

/**
 * A minimal JPEG whose APP1 segment carries an EXIF TIFF with Make, Model and
 * a GPS IFD (DMS rationals + hemisphere refs when provided). Offsets are
 * computed from the TIFF start: header 8 | IFD0 54 (2 + 4*12 + 4) | data area
 * 11 | GPS IFD (54 with refs, 30 without) | rationals 48. Refs are 2-byte
 * ASCII values written inline into the 4-byte IFD value field.
 */
function craftExifJpeg(refs: GpsRefs = { lat: "N", lng: "E" }): Buffer {
  const tiffHeader = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]);
  const ifd = Buffer.alloc(54); // 2 + 4*12 + 4
  const makeVal = Buffer.from("TestCam\0");
  const modelVal = Buffer.from("X100\0");
  const dateVal = Buffer.from("2026:01:02 03:04:05\0");
  const dataArea = Buffer.concat([makeVal, modelVal, dateVal]);
  const entry = (i: number, tagId: number, typ: number, count: number, val: number) => {
    ifd.writeUInt16BE(tagId, 2 + i * 12);
    ifd.writeUInt16BE(typ, 4 + i * 12);
    ifd.writeUInt32BE(count, 6 + i * 12);
    ifd.writeUInt32BE(val, 10 + i * 12);
  };
  ifd.writeUInt16BE(4, 0);
  entry(0, 0x010f, 2, makeVal.length, 8 + 54); // Make -> data area
  entry(1, 0x0110, 2, modelVal.length, 8 + 54 + makeVal.length); // Model
  entry(2, 0x9003, 2, dateVal.length, 8 + 54 + makeVal.length + modelVal.length); // DateTimeOriginal
  const gpsIfdOffset = 8 + 54 + dataArea.length;
  entry(3, 0x8825, 4, 1, gpsIfdOffset); // GPS IFD pointer

  const hasLatRef = refs.lat !== null;
  const hasLngRef = refs.lng !== null;
  const gpsEntryCount = (hasLatRef ? 1 : 0) + 1 + (hasLngRef ? 1 : 0) + 1;
  const gpsIfd = Buffer.alloc(2 + gpsEntryCount * 12 + 4);
  const gpsEntry = (i: number, tagId: number, typ: number, count: number, val: number) => {
    gpsIfd.writeUInt16BE(tagId, 2 + i * 12);
    gpsIfd.writeUInt16BE(typ, 4 + i * 12);
    gpsIfd.writeUInt32BE(count, 6 + i * 12);
    gpsIfd.writeUInt32BE(val, 10 + i * 12);
  };
  gpsIfd.writeUInt16BE(gpsEntryCount, 0);
  const latOffset = gpsIfdOffset + gpsIfd.length;
  const lngOffset = latOffset + 24;
  let i = 0;
  if (hasLatRef) {
    gpsEntry(i, 0x0001, 2, 2, 0); // GPSLatitudeRef — ASCII fits inline
    gpsIfd.write(refs.lat + "\0", 10 + i * 12);
    i++;
  }
  gpsEntry(i, 0x0002, 5, 3, latOffset); // GPSLatitude (DMS rationals)
  i++;
  if (hasLngRef) {
    gpsEntry(i, 0x0003, 2, 2, 0); // GPSLongitudeRef — ASCII fits inline
    gpsIfd.write(refs.lng + "\0", 10 + i * 12);
    i++;
  }
  gpsEntry(i, 0x0004, 5, 3, lngOffset); // GPSLongitude
  gpsIfd.writeUInt32BE(0, 2 + gpsEntryCount * 12); // next IFD = none

  const rationals = Buffer.alloc(48);
  const dms = (deg: [number, number], min: [number, number], sec: [number, number], at: number) => {
    [deg, min, sec].forEach((r, j) => {
      rationals.writeUInt32BE(r[0], at + j * 8);
      rationals.writeUInt32BE(r[1], at + j * 8 + 4);
    });
  };
  dms([21, 1], [29, 1], [812, 100], 0); // 21° 29' 8.12" — valid seconds < 60
  dms([39, 1], [11, 1], [449, 100], 24); // 39° 11' 4.49" — valid seconds < 60

  const tiff = Buffer.concat([tiffHeader, ifd, dataArea, gpsIfd, rationals]);
  const app1 = Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(app1.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xe1]), len, app1, Buffer.from([0xff, 0xd9])]);
}

/** A JPEG whose only metadata is an XMP APP1 segment (no EXIF at all). */
function craftXmpJpeg(): Buffer {
  const xmp =
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreatorTool>XmpTestTool</xmp:CreatorTool></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  const payload = Buffer.concat([Buffer.from("http://ns.adobe.com/xap/1.0/\0"), Buffer.from(xmp)]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xe1]), len, payload, Buffer.from([0xff, 0xd9])]);
}

describe("TR-031 image EXIF metadata (local, no network)", () => {
  it("extracts camera and GPS from EXIF — zero requests, findings cite the input", async () => {
    const sim = createSimServer([]);
    const counted = counting(sim.transport);
    const input = { content: craftExifJpeg().toString("base64") };
    const result = await runTransform(exifMetadata, { transport: counted.transport, input });
    expect(result.requestCount).toBe(0);
    expect(counted.calls()).toBe(0);
    const findings = result.output.findings;
    // 21 + 29/60 + 8.12/3600 = 21.485589; 39 + 11/60 + 4.49/3600 = 39.184581
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "captured_at",
        objectType: "geo_point",
        objectValue: "21.485589,39.184581",
        derivedFrom: "input",
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "captured_with",
        objectType: "camera",
        objectValue: "TestCam X100",
        derivedFrom: "input",
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "captured_at_time",
        objectType: "date",
        objectValue: "2026-01-02 03:04:05",
        derivedFrom: "input",
      }),
    );
    for (const f of findings) expect(f.evidence).toBeUndefined();
  });

  it("S/W hemisphere refs make both coordinates negative", async () => {
    const sim = createSimServer([]);
    const counted = counting(sim.transport);
    const input = { content: craftExifJpeg({ lat: "S", lng: "W" }).toString("base64") };
    const result = await runTransform(exifMetadata, { transport: counted.transport, input });
    expect(result.requestCount).toBe(0);
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({
        predicate: "captured_at",
        objectType: "geo_point",
        objectValue: "-21.485589,-39.184581",
        derivedFrom: "input",
      }),
    );
  });

  it("GPS coordinates WITHOUT hemisphere refs emit NO geo finding (the hemisphere is never guessed)", async () => {
    const sim = createSimServer([]);
    const counted = counting(sim.transport);
    const input = { content: craftExifJpeg({ lat: null, lng: null }).toString("base64") };
    const result = await runTransform(exifMetadata, { transport: counted.transport, input });
    expect(result.requestCount).toBe(0);
    const findings = result.output.findings;
    expect(findings.find((f) => f.predicate === "captured_at")).toBeUndefined();
    // The other EXIF facts are still emitted — only the geo finding is withheld.
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "captured_with", objectType: "camera", objectValue: "TestCam X100" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "captured_at_time", objectType: "date", objectValue: "2026-01-02 03:04:05" }),
    );
  });

  it("extracts the creation tool from an XMP-only image (CreatorTool)", async () => {
    const sim = createSimServer([]);
    const counted = counting(sim.transport);
    const input = { content: craftXmpJpeg().toString("base64") };
    const result = await runTransform(exifMetadata, { transport: counted.transport, input });
    expect(result.requestCount).toBe(0);
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({
        predicate: "created_with",
        objectType: "application",
        objectValue: "XmpTestTool",
        derivedFrom: "input",
      }),
    );
  });

  it("a valid image WITHOUT EXIF is a legitimate empty result (not an error)", async () => {
    const sim = createSimServer([]);
    const counted = counting(sim.transport);
    // A minimal JPEG with no APP1 segment at all: SOI + EOI.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const result = await runTransform(exifMetadata, { transport: counted.transport, input: { content: jpeg.toString("base64") } });
    expect(result.requestCount).toBe(0);
    expect(result.output.findings).toHaveLength(0);
  });

  it("rejects non-image bytes before anything runs (fail-closed, zero transport calls)", async () => {
    const sim = createSimServer([]);
    const counted = counting(sim.transport);
    for (const bad of ["aGVsbG8gd29ybGQgbm90IGFuIGltYWdl", ""]) {
      await expect(runTransform(exifMetadata, { transport: counted.transport, input: { content: bad } })).rejects.toThrow(
        /not a valid image|is required/,
      );
    }
    expect(counted.calls()).toBe(0);
  });
});
