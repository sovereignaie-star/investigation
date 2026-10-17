/**
 * P2-031 — maritime identifier checks.
 *
 * MMSI (Recommendation ITU-R M.585; ITU Radio Regulations Article 19 with the
 * MID table in Appendix 43): a ship station is assigned a nine-digit identity
 * MIDXXXXXX whose first three digits are the Maritime Identification Digits of
 * the assigning administration. MIDs are three-digit codes in the structural
 * range 201–775 (the first digit is 2–7 by region). There is no check digit:
 * the MID is an assigned code, not a checksummable value, so validation is
 * structural only.
 *
 * IMO ship identification number (IMO resolution A.1078(28)): a permanent
 * seven-digit number for a hull. The seventh digit is a check digit computed
 * from the first six: multiply each digit by the weights 7,6,5,4,3,2 from
 * left to right, sum the products, and the units digit of the sum must equal
 * the seventh digit.
 */

/** Structural range of assigned Maritime Identification Digits (ITU RR Appendix 43). */
export const MID_MIN = 201;
export const MID_MAX = 775;

/** Returns true when `mmsi` is a nine-digit ship-station MMSI whose MID (first three digits) lies in 201–775. */
export function isShipMmsi(mmsi: string): boolean {
  if (!/^\d{9}$/.test(mmsi)) return false;
  const mid = Number(mmsi.slice(0, 3));
  return mid >= MID_MIN && mid <= MID_MAX;
}

/** Returns the MID of a nine-digit MMSI, or null when the value is not nine digits. */
export function mmsiMid(mmsi: string): number | null {
  if (!/^\d{9}$/.test(mmsi)) return null;
  return Number(mmsi.slice(0, 3));
}

/** Returns true when `imo` is a seven-digit IMO ship number with a valid check digit. */
export function isImoShipNumber(imo: string): boolean {
  if (!/^\d{7}$/.test(imo)) return false;
  const digits = [...imo].map(Number);
  const weights = [7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += digits[i] * weights[i];
  return sum % 10 === digits[6];
}
