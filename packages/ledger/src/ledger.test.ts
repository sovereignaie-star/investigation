import { describe, expect, it } from "vitest";
import { manualClock } from "@ir/core";
import { hashEntry, Ledger, memoryStore, verify, type Entry } from "./index.ts";

const ULID = "01J00000000000000000000001";

function chain(n = 6): Entry[] {
  const clock = manualClock("2026-10-10T08:00:00.000Z");
  const l = new Ledger({ clock, actor: "analyst" });
  l.append("case.created", { id: ULID, purpose: "العناية الواجبة قبل التعاقد" });
  for (let i = 1; i < n; i++) {
    clock.advance(1000);
    l.append("observation.added", { i, transformId: "tr-001", value: `example-${i}.com`, kind: "positive" });
  }
  return l.entries().map((e) => structuredClone(e)); // mutable copies, as an attacker with file access would have
}

const codes = (entries: unknown[], opts = {}) => verify(entries, opts).errors.map((e) => `${e.index}:${e.code}`);

describe("@ir/ledger hash chain (P1-009)", () => {
  it("a fresh chain verifies, starts at seq 0 with prevHash null and links every entry", () => {
    const c = chain();
    const r = verify(c);
    expect(r).toMatchObject({ ok: true, length: 6, firstBad: null, errors: [] });
    expect(c[0]).toMatchObject({ seq: 0, prevHash: null });
    for (let i = 1; i < c.length; i++) expect(c[i]?.prevHash).toBe(c[i - 1]?.entryHash);
    expect(r.head).toBe(c[5]?.entryHash);
  });

  it("is deterministic with an injected clock (same inputs, same hashes)", () => {
    expect(chain().map((e) => e.entryHash)).toEqual(chain().map((e) => e.entryHash));
  });

  it("T-LED-001 a changed byte in the payload of a middle entry fails and names the entry", () => {
    const c = chain();
    (c[3]?.payload as { value: string }).value = "example-3.con";
    const r = verify(c);
    expect(r.ok).toBe(false);
    expect(r.firstBad).toBe(3);
    expect(codes(c)).toEqual(["3:entry_hash"]);
  });

  it("T-LED-002 a changed kind, time or actor is detected", () => {
    for (const edit of [
      (e: Entry) => (e.kind = "note.added"),
      (e: Entry) => (e.at = "2026-10-10T08:00:02.001Z"),
      (e: Entry) => (e.actor = "someone-else"),
    ]) {
      const c = chain();
      edit(c[2] as Entry);
      expect(codes(c)).toEqual(["2:entry_hash"]);
    }
  });

  it("T-LED-003 re-hashing an edited entry breaks the link to the next one", () => {
    const c = chain();
    const e = c[2] as Entry;
    (e.payload as { value: string }).value = "forged.example";
    e.entryHash = hashEntry(e);
    expect(codes(c)).toEqual(["3:prev_hash"]);
  });

  it("T-LED-004 a changed prevHash is detected", () => {
    const c = chain();
    (c[4] as Entry).prevHash = "0".repeat(64);
    expect(codes(c)).toEqual(["4:prev_hash", "4:entry_hash"]);
  });

  it("T-LED-005 a deleted entry is detected as a gap", () => {
    const c = chain();
    c.splice(2, 1);
    const r = verify(c);
    expect(r.ok).toBe(false);
    expect(r.firstBad).toBe(2);
    expect(codes(c)).toContain("2:seq");
    expect(codes(c)).toContain("2:prev_hash");
  });

  it("T-LED-006 reordered entries are detected", () => {
    const c = chain();
    [c[1], c[2]] = [c[2] as Entry, c[1] as Entry];
    expect(verify(c).firstBad).toBe(1);
    expect(codes(c)).toEqual(expect.arrayContaining(["1:seq", "1:prev_hash", "2:seq", "2:prev_hash"]));
  });

  it("T-LED-007 an inserted forged entry is detected even if it is internally consistent", () => {
    const c = chain();
    const prev = c[2] as Entry;
    const body = {
      seq: 3,
      prevHash: prev.entryHash,
      kind: "note.added" as const,
      payload: { forged: true },
      at: prev.at,
      actor: "analyst",
    };
    c.splice(3, 0, { ...body, entryHash: hashEntry(body) });
    expect(codes(c)).toEqual(expect.arrayContaining(["4:seq", "4:prev_hash"]));
  });

  it("T-LED-008 truncation is detected against a known head or length", () => {
    const full = chain();
    const head = full[5]?.entryHash ?? "";
    const cut = full.slice(0, 4);
    expect(verify(cut).ok).toBe(true); // a prefix is a valid chain on its own ...
    expect(codes(cut, { expectedHead: head })).toEqual(["-1:head"]); // ... so a published/signed head is needed (P1-011)
    expect(codes(cut, { expectedLength: 6 })).toEqual(["-1:length"]);
    expect(verify(full, { expectedHead: full[3]?.entryHash ?? "" }).ok).toBe(true); // growth after a checkpoint is fine
  });

  it("T-LED-001..008 exhaustive: changing any single character of any entry is detected", () => {
    const c = chain(4);
    let mutations = 0;
    c.forEach((entry, i) => {
      const text = JSON.stringify(entry);
      for (let p = 0; p < text.length; p++) {
        const ch = text[p] === "a" ? "b" : "a";
        let edited: unknown;
        try {
          edited = JSON.parse(text.slice(0, p) + ch + text.slice(p + 1));
        } catch {
          continue; // the file no longer parses: tampering is evident without the ledger
        }
        const copy: unknown[] = c.slice();
        copy[i] = edited;
        mutations++;
        expect(verify(copy).ok, `entry ${i}, char ${p} ("${text[p]}" -> "${ch}")`).toBe(false);
      }
    });
    expect(mutations).toBeGreaterThan(500);
    console.log(`T-LED exhaustive: ${mutations} single-character edits, all detected`);
  });

  it("T-LED-010 (part 2) entries are immutable, payloads are snapshotted, corrupt stores are refused", () => {
    const l = new Ledger({ clock: manualClock(0), actor: "a" });
    const payload = { list: [1, 2] };
    const e = l.append("note.added", payload);
    payload.list.push(3); // caller mutates after append
    expect(e.payload).toEqual({ list: [1, 2] });
    expect(Object.isFrozen(e) && Object.isFrozen(e.payload)).toBe(true);
    expect(() => {
      (e as { seq: number }).seq = 9;
    }).toThrow(TypeError);
    expect("update" in l || "delete" in l || "remove" in l).toBe(false);
    expect(() => l.append("note.added", { bad: Number.NaN })).toThrow();
    expect(l.length).toBe(1);

    const tampered = chain();
    (tampered[1]?.payload as { i: number }).i = 99;
    expect(() => new Ledger({ store: memoryStore(tampered), actor: "a" })).toThrow(/corrupt/);
    const resumed = new Ledger({ store: memoryStore(chain()), clock: manualClock("2026-10-10T09:00:00Z"), actor: "a" });
    expect(resumed.append("note.added", { resumed: true }).seq).toBe(6);
    expect(verify(resumed.entries()).ok).toBe(true);
  });
});
