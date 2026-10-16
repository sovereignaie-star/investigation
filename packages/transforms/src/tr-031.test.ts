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
 * "2026:01:02 03:04:05" and GPS 21°29'81.2"N 39°11'44.9"E (DMS rationals),
 * which is 21.505889,39.195806 in decimal degrees.
 *
 * Red first: this test was written before the transform existed and failed on
 * the missing module (the failing test for the right reason).
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
 * A minimal JPEG whose APP1 segment carries an EXIF TIFF with Make, Model and
 * a GPS IFD (DMS rationals). Offsets are computed from the TIFF start:
 * header 8 | IFD0 42 (2 + 3*12 + 4) | data area 11 | GPS IFD 30 | rationals 48.
 */
function craftExifJpeg(): Buffer {
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
  entry(3, 0x8825, 4, 1, 8 + 54 + dataArea.length); // GPS IFD pointer

  const gpsIfd = Buffer.alloc(30);
  const gpsEntry = (i: number, tagId: number, typ: number, count: number, val: number) => {
    gpsIfd.writeUInt16BE(tagId, 2 + i * 12);
    gpsIfd.writeUInt16BE(typ, 4 + i * 12);
    gpsIfd.writeUInt32BE(count, 6 + i * 12);
    gpsIfd.writeUInt32BE(val, 10 + i * 12);
  };
  gpsIfd.writeUInt16BE(2, 0);
  const latOffset = 8 + 54 + dataArea.length + 30;
  const lngOffset = latOffset + 24;
  gpsEntry(0, 0x0002, 5, 3, latOffset); // GPSLatitude (DMS rationals)
  gpsEntry(1, 0x0004, 5, 3, lngOffset); // GPSLongitude
  gpsIfd.writeUInt32BE(0, 26); // next IFD = none

  const rationals = Buffer.alloc(48);
  const dms = (deg: [number, number], min: [number, number], sec: [number, number], at: number) => {
    [deg, min, sec].forEach((r, i) => {
      rationals.writeUInt32BE(r[0], at + i * 8);
      rationals.writeUInt32BE(r[1], at + i * 8 + 4);
    });
  };
  dms([21, 1], [29, 1], [812000, 10000], 0); // 21° 29' 81.2" N
  dms([39, 1], [11, 1], [449000, 10000], 24); // 39° 11' 44.9" E

  const tiff = Buffer.concat([tiffHeader, ifd, dataArea, gpsIfd, rationals]);
  const app1 = Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(app1.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xe1]), len, app1, Buffer.from([0xff, 0xd9])]);
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
    // 21 + 29/60 + 81.2/3600 = 21.505889; 39 + 11/60 + 44.9/3600 = 39.195806
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "captured_at",
        objectType: "geo_point",
        objectValue: "21.505889,39.195806",
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
