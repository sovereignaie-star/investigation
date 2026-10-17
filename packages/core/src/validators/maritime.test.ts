/**
 * P2-031 — maritime identifier validators (red-first).
 *
 * MMSI (ITU-R M.585 / RR Article 19, Appendix 43): a nine-digit ship-station
 * identity MIDXXXXXX whose first three digits are Maritime Identification
 * Digits in the structural range 201–775 (first digit 2–7). No checksum: the
 * MID is an assigned country code, not a checkable value.
 *
 * IMO ship number (IMO resolution A.1078(28)): seven digits whose seventh
 * digit is a check digit — multiply the first six digits by the weights
 * 7,6,5,4,3,2 (left to right), sum, and the units digit of the sum must equal
 * the seventh digit.
 */
import { describe, expect, it } from "vitest";
import { validate } from "./index.ts";

describe("P2-031: maritime identifier validation", () => {
  it("T-P2031-001: a valid ship MMSI passes (MID in 201–775)", () => {
    // 366 is a United States MID (ITU RR Appendix 43); 353 Panama; 636 Liberia.
    expect(validate("mmsi", "366123456")).toMatchObject({ valid: true });
    expect(validate("mmsi", "353123456")).toMatchObject({ valid: true });
    expect(validate("mmsi", "636123456")).toMatchObject({ valid: true });
  });

  it("T-P2031-002: an MMSI with an out-of-range MID is rejected", () => {
    // 123 is below the MID range (starts with 1); 781 is above it (775 max).
    expect(validate("mmsi", "123456789")).toMatchObject({ valid: false, reason: "mid_range" });
    expect(validate("mmsi", "781123456")).toMatchObject({ valid: false, reason: "mid_range" });
  });

  it("T-P2031-003: an MMSI of the wrong length is rejected", () => {
    expect(validate("mmsi", "36612345")).toMatchObject({ valid: false });
    expect(validate("mmsi", "3661234560")).toMatchObject({ valid: false });
    expect(validate("mmsi", "36612345a")).toMatchObject({ valid: false });
  });

  it("T-P2031-004: a valid IMO ship number passes the checksum", () => {
    // 1234567: 7*1+6*2+5*3+4*4+3*5+2*6 = 77 → units digit 7 = seventh digit.
    expect(validate("imo_ship_number", "1234567")).toMatchObject({ valid: true });
    // 9074729: 63+0+35+16+21+4 = 139 → units digit 9 = seventh digit.
    expect(validate("imo_ship_number", "9074729")).toMatchObject({ valid: true });
  });

  it("T-P2031-005: an IMO ship number with a wrong check digit is rejected", () => {
    expect(validate("imo_ship_number", "1234568")).toMatchObject({ valid: false, reason: "checksum" });
    expect(validate("imo_ship_number", "9074728")).toMatchObject({ valid: false, reason: "checksum" });
  });

  it("T-P2031-006: an IMO ship number of the wrong shape is rejected", () => {
    expect(validate("imo_ship_number", "123456")).toMatchObject({ valid: false });
    expect(validate("imo_ship_number", "12345678")).toMatchObject({ valid: false });
    expect(validate("imo_ship_number", "123456a")).toMatchObject({ valid: false });
  });
});
