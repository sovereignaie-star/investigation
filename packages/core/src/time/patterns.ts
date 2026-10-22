/**
 * P4-019 — time patterns over a case's events: activity periods, sudden
 * silence, escalation and repetition. Every detected pattern carries the
 * evidence ids of the events that constitute it (acceptance: "كل نمط يُعرض مع
 * أدلته"). Pure and deterministic: the same events and parameters always
 * produce the same patterns in the same order.
 *
 * The reference of record is `fixtures/time/reference-timeline.json`, whose
 * expected values were computed by an INDEPENDENT Python implementation
 * (`tools/time/reference_timeline.py`) and frozen — the tests pin it.
 *
 * Documented rules (exercised by hand-written boundary tests):
 * - activity periods: events merge while the gap is STRICTLY below `gapMs` —
 *   a gap of exactly `gapMs` separates two periods;
 * - sudden silences: gaps BETWEEN consecutive events of at least `quietMs` —
 *   the case's boundaries (before the first event, after the last) are not
 *   silences, only gaps inside the observed lifespan are;
 * - escalations: events bucketed by absolute UTC boundaries of `bucketMs`;
 *   two ADJACENT non-empty buckets where the later count is at least `factor`
 *   times the earlier one — an empty bucket between them cancels escalation;
 * - repetitions: per value, sorted events; a maximal run whose total span is
 *   at most `withinMs` and whose length is at least `minTimes`.
 */

/** One timestamped event — the timeline's atom. `value` participates in repetition. */
export interface TimePatternEvent {
  at: string;
  value?: string;
  /** The evidence backing this event — patterns never lose it. */
  evidenceIds: string[];
}

const epoch = (at: string): number => Date.parse(at);

const byTime = (a: TimePatternEvent, b: TimePatternEvent): number => epoch(a.at) - epoch(b.at);

export interface ActivityPeriod {
  start: string;
  end: string;
  count: number;
  evidenceIds: string[];
}

/** P4-019 — periods of activity: bursts separated by gaps of at least `gapMs`. */
export function activityPeriods(events: readonly TimePatternEvent[], opts: { gapMs: number }): ActivityPeriod[] {
  const sorted = [...events].sort(byTime);
  const out: ActivityPeriod[] = [];
  let run: TimePatternEvent[] = [];
  for (const e of sorted) {
    const last = run[run.length - 1];
    if (run.length === 0 || epoch(e.at) - epoch(last.at) < opts.gapMs) {
      run.push(e);
    } else {
      out.push(periodOf(run));
      run = [e];
    }
  }
  if (run.length > 0) out.push(periodOf(run));
  return out;
}

function periodOf(run: readonly TimePatternEvent[]): ActivityPeriod {
  return {
    start: run[0].at,
    end: run[run.length - 1].at,
    count: run.length,
    evidenceIds: run.flatMap((e) => e.evidenceIds),
  };
}

export interface SuddenSilence {
  from: string;
  to: string;
  gapMs: number;
  beforeEvidenceIds: string[];
  afterEvidenceIds: string[];
}

/** P4-019 — sudden silences: gaps inside the observed lifespan of at least `quietMs`. */
export function suddenSilences(events: readonly TimePatternEvent[], opts: { quietMs: number }): SuddenSilence[] {
  const sorted = [...events].sort(byTime);
  const out: SuddenSilence[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = epoch(sorted[i + 1].at) - epoch(sorted[i].at);
    if (gap >= opts.quietMs) {
      out.push({
        from: sorted[i].at,
        to: sorted[i + 1].at,
        gapMs: gap,
        beforeEvidenceIds: sorted[i].evidenceIds,
        afterEvidenceIds: sorted[i + 1].evidenceIds,
      });
    }
  }
  return out;
}

export interface Escalation {
  from: string;
  to: string;
  previousCount: number;
  count: number;
  evidenceIds: string[];
}

/** P4-019 — escalations: adjacent non-empty buckets where the rate jumps by `factor`. */
export function escalations(events: readonly TimePatternEvent[], opts: { bucketMs: number; factor: number }): Escalation[] {
  const sorted = [...events].sort(byTime);
  const buckets = new Map<number, TimePatternEvent[]>();
  for (const e of sorted) {
    const key = Math.floor(epoch(e.at) / opts.bucketMs);
    const list = buckets.get(key) ?? [];
    list.push(e);
    buckets.set(key, list);
  }
  const out: Escalation[] = [];
  for (const key of [...buckets.keys()].sort((a, b) => a - b)) {
    const next = buckets.get(key + 1);
    const current = buckets.get(key);
    if (!next || !current) continue;
    if (next.length < opts.factor * current.length) continue;
    out.push({
      from: current[0].at,
      to: next[0].at,
      previousCount: current.length,
      count: next.length,
      evidenceIds: [...current, ...next].flatMap((e) => e.evidenceIds),
    });
  }
  return out;
}

export interface Repetition {
  value: string;
  times: number;
  from: string;
  to: string;
  evidenceIds: string[];
}

/** P4-019 — repetitions: the same value `minTimes` times within `withinMs`. */
export function repetitions(events: readonly TimePatternEvent[], opts: { withinMs: number; minTimes: number }): Repetition[] {
  const byValue = new Map<string, TimePatternEvent[]>();
  for (const e of events) {
    if (e.value === undefined) continue;
    const list = byValue.get(e.value) ?? [];
    list.push(e);
    byValue.set(e.value, list);
  }
  const out: Repetition[] = [];
  for (const value of [...byValue.keys()].sort()) {
    const group = [...(byValue.get(value) ?? [])].sort(byTime);
    let i = 0;
    while (i < group.length) {
      const run = [group[i]];
      let j = i + 1;
      while (j < group.length && epoch(group[j].at) - epoch(run[0].at) <= opts.withinMs) {
        run.push(group[j]);
        j++;
      }
      if (run.length >= opts.minTimes) {
        out.push({
          value,
          times: run.length,
          from: run[0].at,
          to: run[run.length - 1].at,
          evidenceIds: run.flatMap((e) => e.evidenceIds),
        });
      }
      i = j;
    }
  }
  return out;
}
