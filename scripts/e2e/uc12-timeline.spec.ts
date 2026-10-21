/**
 * P4-007 / UC-08 — «بناء خط زمني لحدث» (ROADMAP D4): the bitemporal timeline,
 * driven through the REAL app. The acceptance's «ترتيب صحيح مع عدم اليقين الزمني»
 * is asserted END-TO-END on a case whose known truth mixes every uncertainty shape:
 * a closed window («تقريباً 2019» = the whole year), an open-start window
 * («قبل 2020-03»), and an unknown window — dated events render BEFORE the
 * undated one, open bounds say «غير محددة» honestly, and both dimensions are
 * visible (the occurrence window AND each observation's own time and kind).
 * The row is the selection affordance: clicking it selects the subject node
 * and the detail panel opens — the real interaction, not just the markup.
 *
 * The case is seeded with real claims (ADR-33 occurrence windows) and real
 * observations (multiple evidence) appended through the case store's write
 * path — the same path the server routes use.
 */
import { expect, test } from "@playwright/test";
import { openCase as openCaseStore } from "@ir/store";
import { caseDirOf, createCaseViaApi, openCase } from "./helpers.ts";

const PERSON = "01CCCCCCCCCCCCCCCCCCCCCCCC";
const TARGET = "01DDDDDDDDDDDDDDDDDDDDDDDD";

/** Creates a case and seeds the timeline's known truth: three claims with
 *  three uncertainty shapes, two of them backed by real observations. */
async function seededCase(): Promise<string> {
  const caseId = await createCaseViaApi("قضية الخط الزمني", "التحقق من الخط الزمني ثنائي البعد مع عدم اليقين الزمني في بيئة المحاكاة");
  const c = openCaseStore(caseDirOf(caseId), { actor: "e2e" });
  try {
    for (const [id, key, label] of [
      [PERSON, "person:e2e-timeline-subject", "أحمد الشامي"],
      [TARGET, "person:e2e-timeline-target", "سعيد العمري"],
    ] as const) {
      c.append("entity.added", {
        id,
        type: "person",
        canonicalKey: key,
        labels: { ar: label },
        props: {},
      });
    }
    const sha = "cd".repeat(32);
    c.append("evidence.stored", {
      id: "01EEEEEEEEEEEEEEEEEEEEEEEE",
      sha256: sha,
      mime: "application/json",
      size: 2,
      blobRef: `blobs/cd/${sha}`,
      fetchedAt: "2026-03-01T00:00:00Z",
      request: { method: "LOCAL", url: "local://e2e", headers: {} },
      transformId: "tr-dns",
      version: "1",
    });
    // «تقريباً 2019»: the whole year IS the honest uncertainty window (closed).
    // Registration is DELIBERATELY REVERSED relative to occurrence: this event's
    // observations (2026-03/2026-04) are LATER than the 2020 event's observation
    // (2026-03-02) — proving the timeline orders by OCCURRENCE, never by registration.
    c.append("claim.added", {
      id: "01FFFFFFFFFFFFFFFFFFFFFFF1",
      subjectId: PERSON,
      predicate: "knows",
      objectId: TARGET,
      confidence: 0.8,
      explanation: "e2e",
      validFrom: null,
      validTo: null,
      occurredFrom: "2019-01-01T00:00:00Z",
      occurredTo: "2019-12-31T23:59:59Z",
    });
    // two observations appended in REVERSE moment order (later first): the projection
    // sorts by moment, so the display must show the earlier (2026-03-15) FIRST.
    c.append("observation.added", {
      id: "01FFFFFFFFFFFFFFFFFFFFFFF2",
      claimId: "01FFFFFFFFFFFFFFFFFFFFFFF1",
      transformId: "tr-dns",
      evidenceId: "01EEEEEEEEEEEEEEEEEEEEEEEE",
      observedAt: "2026-04-01T00:00:00Z",
      kind: "positive",
    });
    c.append("observation.added", {
      id: "01FFFFFFFFFFFFFFFFFFFFFFF6",
      claimId: "01FFFFFFFFFFFFFFFFFFFFFFF1",
      transformId: "tr-dns",
      evidenceId: "01EEEEEEEEEEEEEEEEEEEEEEEE",
      observedAt: "2026-03-15T12:00:00Z",
      kind: "negative",
    });
    // «قبل 2020-03»: open start — the upper bound is all we know. Its observation
    // (2026-03-02) is the EARLIEST registration in the case — earlier than the 2019
    // event's — yet the 2019 event renders FIRST (occurrence is the primary key).
    c.append("claim.added", {
      id: "01FFFFFFFFFFFFFFFFFFFFFFF3",
      subjectId: TARGET,
      predicate: "mentions",
      objectId: PERSON,
      confidence: 0.7,
      explanation: "e2e",
      validFrom: null,
      validTo: null,
      occurredFrom: null,
      occurredTo: "2020-03-01T00:00:00Z",
    });
    c.append("observation.added", {
      id: "01FFFFFFFFFFFFFFFFFFFFFFF4",
      claimId: "01FFFFFFFFFFFFFFFFFFFFFFF3",
      transformId: "tr-dns",
      evidenceId: "01EEEEEEEEEEEEEEEEEEEEEEEE",
      observedAt: "2026-03-02T09:00:00-05:00",
      kind: "error",
    });
    // unknown window — no occurrence data at all
    c.append("claim.added", {
      id: "01FFFFFFFFFFFFFFFFFFFFFFF5",
      subjectId: PERSON,
      predicate: "communicates_with",
      objectId: TARGET,
      confidence: 0.6,
      explanation: "e2e",
      validFrom: null,
      validTo: null,
      occurredFrom: null,
      occurredTo: null,
    });
  } finally {
    c.close();
  }
  return caseId;
}

/** The rows, as a helper the reversed-order assertions reuse before the count check. */
function items2(page: import("@playwright/test").Page) {
  return page.getByTestId("timeline-item");
}

test("UC-08: bitemporal timeline — correct ordering with temporal uncertainty, both dimensions, real selection", async ({ page }) => {
  const caseId = await seededCase();
  await openCase(page, caseId);

  const timeline = page.getByTestId("timeline");
  await expect(timeline).toBeVisible();

  // both dimensions are visible per event: the occurrence window label AND
  // the observations' own times with their kinds
  await expect(timeline).toContainText("من 2019-01-01T00:00:00Z إلى 2019-12-31T23:59:59Z");
  await expect(timeline).toContainText("2026-03-15T12:00:00Z");
  await expect(timeline).toContainText("2026-04-01T00:00:00Z");
  await expect(timeline).toContainText("رصد خطأ");
  await expect(timeline).toContainText("2026-03-02T09:00:00-05:00");

  // the SECOND dimension's own order (within an event, by registration moment):
  // the two observations of the 2019 event were appended LATER-first, yet the
  // display shows the earlier moment (2026-03-15) BEFORE the later (2026-04-01)
  const firstRowText = (await items2(page).nth(0).textContent()) ?? "";
  expect(firstRowText.indexOf("2026-03-15T12:00:00Z")).toBeLessThan(firstRowText.indexOf("2026-04-01T00:00:00Z"));

  // OCCURRENCE is the primary order — registration NEVER overrides it: the 2019
  // event's registrations (2026-03-15, 2026-04-01) are LATER than the 2020 event's
  // registration (2026-03-02), yet the 2019 event renders FIRST.
  const secondRowText = (await items2(page).nth(1).textContent()) ?? "";
  expect(firstRowText).toContain("2019-01-01T00:00:00Z");
  expect(secondRowText).toContain("2026-03-02T09:00:00-05:00");

  // honest uncertainty: the open bound says «غير محددة» — never a faked bound
  await expect(timeline).toContainText("البداية غير محددة — حتى 2020-03-01T00:00:00Z");
  // the unknown window says so honestly
  await expect(timeline).toContainText("غير محدد");

  // correct ordering with uncertainty: the two dated events render BEFORE the
  // unknown-window one (dated first, by known bounds; undated last, never mixed in)
  const items = page.getByTestId("timeline-item");
  await expect(items).toHaveCount(3);
  const dated1 = await items.nth(0).textContent();
  const dated2 = await items.nth(1).textContent();
  const undated = await items.nth(2).textContent();
  expect(dated1).toContain("2019-01-01T00:00:00Z"); // earliest known bound first
  expect(dated2).toContain("2020-03-01T00:00:00Z");
  expect(undated).toContain("غير محدد");

  // the row is the selection affordance — clicking it selects the subject
  // node and the detail panel opens (the real interaction)
  await items.nth(0).click();
  await expect(page.getByTestId("node-detail-panel")).toBeVisible();
});
