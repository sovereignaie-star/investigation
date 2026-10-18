/**
 * P2-028 — the network-log projection carries the ROUTE of every event (ADR-31): the request rows,
 * the transport-call rows, and the liveness rows all surface the route recorded on the chain — no
 * exception. Red first: written before the route field exists in the projected rows.
 */
import { describe, expect, it } from "vitest";
import { isoNow, ulidFactory, manualClock } from "@ir/core";
import { type Entry, type Kind } from "../ledger.ts";
import { Projector } from "./state.ts";
import { networkLogView } from "./views.ts";

const clock = manualClock("2026-10-18T00:00:00.000Z");
const newId = ulidFactory(clock);
const ISO = isoNow(clock);

function entry(seq: number, kind: Kind, payload: unknown): Entry {
  return { seq, prevHash: null, entryHash: "h", kind, payload, at: ISO, actor: "test" } as Entry;
}

function auditEntry(seq: number, action: string, target: string, detail?: Record<string, unknown>): Entry {
  return entry(seq, "audit.event", {
    id: newId(),
    at: ISO,
    actor: "test",
    action,
    target,
    purposeRef: newId(),
    ...(detail ? { detail } : {}),
  });
}

describe("P2-028 route in the network-log projection (ADR-31 — every event, no exception)", () => {
  it("T-P2028-P01: the request rows carry the route (allowed through a proxy, denied direct)", () => {
    const p = new Projector();
    p.apply(
      auditEntry(0, "egress.allowed", "source.example", {
        transform: "TR-010@1.0.0",
        transportCalls: 1,
        route: "proxy-socks5",
      }),
    );
    p.apply(
      auditEntry(1, "egress.denied", "evil.example", {
        transform: "TR-010@1.0.0",
        reason: "host_not_allowed",
        transportCalls: 0,
        route: "direct",
      }),
    );
    const log = networkLogView(p);
    expect(log.requests).toHaveLength(2);
    expect(log.requests[0]).toMatchObject({ decision: "allowed", route: "proxy-socks5" });
    expect(log.requests[1]).toMatchObject({ decision: "denied", reason: "host_not_allowed", route: "direct" });
  });

  it("T-P2028-P02: the transport-call rows carry the route", () => {
    const p = new Projector();
    p.apply(
      auditEntry(0, "egress.transport", "source.example", {
        transform: "TR-010@1.0.0",
        transportCalls: 1,
        url: "https://source.example/x",
        attempt: 1,
        status: 200,
        route: "tor",
      }),
    );
    const log = networkLogView(p);
    expect(log.transportCalls).toHaveLength(1);
    expect(log.transportCalls[0]).toMatchObject({ url: "https://source.example/x", status: 200, route: "tor" });
  });

  it("T-P2028-P03: the liveness events are projected with their route (and the trigger/alive)", () => {
    const p = new Projector();
    p.apply(
      auditEntry(0, "egress.liveness", "proxy.example.net", {
        route: "proxy-socks5",
        trigger: "startup",
        alive: true,
        latencyMs: 23,
        proxyHost: "proxy.example.net",
        proxyPort: 1080,
      }),
    );
    p.apply(
      auditEntry(1, "egress.liveness", "proxy.example.net", {
        route: "proxy-socks5",
        trigger: "failure",
        alive: false,
        error: "ECONNREFUSED",
        proxyHost: "proxy.example.net",
      }),
    );
    const log = networkLogView(p);
    expect(log.liveness).toHaveLength(2);
    expect(log.liveness[0]).toMatchObject({ route: "proxy-socks5", trigger: "startup", alive: true });
    expect(log.liveness[1]).toMatchObject({ route: "proxy-socks5", trigger: "failure", alive: false });
  });
});
