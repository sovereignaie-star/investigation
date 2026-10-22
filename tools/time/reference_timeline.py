#!/usr/bin/env python3
"""P4-019 — frozen reference timeline for the time-pattern module.

Builds a deterministic timeline with PLANTED patterns (bursts of activity, a sudden
long silence, day-over-day escalation, a repeated value) and freezes the expected
detections computed by this tool's own INDEPENDENT implementation (double-entry:
the TypeScript module in `packages/core/src/time/patterns.ts` must reproduce
these exact values — its tests pin the committed fixture; `--check` verifies a
fresh computation reproduces the committed file byte-for-byte).

The rules are the module's documented contract:
- activity periods: consecutive events (sorted by time) merge while the gap is
  strictly below `gapMs`;
- sudden silences: a gap between consecutive events of at least `quietMs` (the
  case's boundaries are not silences — only gaps INSIDE the observed lifespan);
- escalations: events bucketed by `bucketMs` (absolute UTC boundaries); two
  ADJACENT non-empty buckets where the later count is at least `factor` times
  the earlier one;
- repetitions: per value, sorted events; a maximal run of events whose total
  span is at most `withinMs` and whose length is at least `minTimes`.

Usage: python3 tools/time/reference_timeline.py [--check]
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "fixtures" / "time" / "reference-timeline.json"

HOUR = 3_600_000
DAY = 86_400_000
PARAMS = {
    "gapMs": 6 * HOUR,
    "quietMs": 72 * HOUR,
    "bucketMs": DAY,
    "factor": 2,
    "withinMs": HOUR,
    "minTimes": 3,
}


def iso(day, h, m=0):
    d = datetime(2026, 10, day, h, m, tzinfo=timezone.utc)
    return d.isoformat().replace("+00:00", ".000Z")


def build_events():
    """16 events in 5 bursts, with a planted 8-day silence and a repeated value."""
    events = []

    def add(at, value=None):
        n = len(events) + 1
        events.append(
            {"at": at, **({"value": value} if value else {}), "evidenceIds": [f"ev-{n:02d}"]}
        )

    # Burst 1: three hourly events on Oct 1 (an activity period).
    add(iso(1, 9))
    add(iso(1, 10))
    add(iso(1, 11))
    # Burst 2: two hourly events on Oct 2 (a separate period; the 23h gap is not a silence).
    add(iso(2, 9))
    add(iso(2, 10))
    # SUDDEN SILENCE: nothing for over a week (Oct 2 10:00 -> Oct 10 09:00).
    # Burst 3: one event on Oct 10.
    add(iso(10, 9))
    # Burst 4: two events on Oct 11 (2 >= 2x1 — escalation).
    add(iso(11, 9))
    add(iso(11, 15))
    # Burst 5: eight events on Oct 12 (8 >= 2x2 — escalation), four of which repeat
    # the SAME value within 50 minutes (a repetition).
    add(iso(12, 9), "login-failed")
    add(iso(12, 9, 5), "login-failed")
    add(iso(12, 9, 20), "login-failed")
    add(iso(12, 9, 40), "login-failed")
    add(iso(12, 11))
    add(iso(12, 12))
    add(iso(12, 13))
    add(iso(12, 14))
    return events


def epoch_ms(at):
    return int(datetime.fromisoformat(at.replace("Z", "+00:00")).timestamp() * 1000)


def activity_periods(events, gap_ms):
    out = []
    run = None
    for e in events:
        if run is not None and epoch_ms(e["at"]) - epoch_ms(run[-1]["at"]) < gap_ms:
            run.append(e)
        else:
            if run is not None:
                out.append(run)
            run = [e]
    if run is not None:
        out.append(run)
    return [
        {
            "start": r[0]["at"],
            "end": r[-1]["at"],
            "count": len(r),
            "evidenceIds": [ev for e in r for ev in e["evidenceIds"]],
        }
        for r in out
    ]


def sudden_silences(events, quiet_ms):
    out = []
    for a, b in zip(events, events[1:]):
        gap = epoch_ms(b["at"]) - epoch_ms(a["at"])
        if gap >= quiet_ms:
            out.append(
                {
                    "from": a["at"],
                    "to": b["at"],
                    "gapMs": gap,
                    "beforeEvidenceIds": a["evidenceIds"],
                    "afterEvidenceIds": b["evidenceIds"],
                }
            )
    return out


def escalations(events, bucket_ms, factor):
    buckets = {}
    for e in events:
        buckets.setdefault(epoch_ms(e["at"]) // bucket_ms, []).append(e)
    out = []
    for i in sorted(buckets):
        j = i + 1
        if j in buckets and len(buckets[j]) >= factor * len(buckets[i]):
            out.append(
                {
                    "from": buckets[i][0]["at"],
                    "to": buckets[j][0]["at"],
                    "previousCount": len(buckets[i]),
                    "count": len(buckets[j]),
                    "evidenceIds": [ev for k in (i, j) for e in buckets[k] for ev in e["evidenceIds"]],
                }
            )
    return out


def repetitions(events, within_ms, min_times):
    by_value = {}
    for e in events:
        if "value" in e:
            by_value.setdefault(e["value"], []).append(e)
    out = []
    for value in sorted(by_value):
        group = sorted(by_value[value], key=lambda e: e["at"])
        i = 0
        while i < len(group):
            run = [group[i]]
            j = i + 1
            while j < len(group) and epoch_ms(group[j]["at"]) - epoch_ms(run[0]["at"]) <= within_ms:
                run.append(group[j])
                j += 1
            if len(run) >= min_times:
                out.append(
                    {
                        "value": value,
                        "times": len(run),
                        "from": run[0]["at"],
                        "to": run[-1]["at"],
                        "evidenceIds": [ev for e in run for ev in e["evidenceIds"]],
                    }
                )
            i = j
    return out


def main():
    events = build_events()
    fixture = {
        "generator": "tools/time/reference_timeline.py",
        "params": PARAMS,
        "events": events,
        "expected": {
            "activityPeriods": activity_periods(events, PARAMS["gapMs"]),
            "suddenSilences": sudden_silences(events, PARAMS["quietMs"]),
            "escalations": escalations(events, PARAMS["bucketMs"], PARAMS["factor"]),
            "repetitions": repetitions(events, PARAMS["withinMs"], PARAMS["minTimes"]),
        },
    }
    if "--check" in sys.argv:
        committed = json.loads(OUT.read_text(encoding="utf-8"))
        if committed != fixture:
            print("time-pattern reference fixture is stale", file=sys.stderr)
            return 1
        print("time-pattern reference fixture is up to date")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(events)} events)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
