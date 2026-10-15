/**
 * T-SBX (P2-005): hostile transforms against the real sandbox on this host.
 *
 * Every hostile attempt targets a LOCAL listener owned by the test (127.0.0.1 or a unix socket in a private temp
 * dir), never an internal service or the metadata address over a real socket. Each case checks BOTH what the
 * transform saw AND that the parent's listener received nothing. Negative controls run the same hostile code
 * without the sandbox and must succeed, so a pass is not vacuous.
 *
 * Levels: "network-only" (seccomp) is exercised everywhere Linux + a C compiler exist. "full" (seccomp +
 * bubblewrap namespaces) cases run only where the host allows unprivileged user namespaces; elsewhere they are
 * reported as skipped with the probe's reason — the file-read cases are NOT claimed on such hosts.
 */
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEgressGateway, type EgressAuditEvent } from "@ir/egress";
import { buildSeccompLauncher } from "./build.ts";
import { runAtLevel } from "./enforce.ts";
import {
  DEFAULT_RESOURCE_LIMITS,
  isAborted,
  isRefusal,
  probeIsolation,
  runSandboxedTransform,
  type IsolationReport,
  type SandboxOutcome,
  type SandboxResult,
} from "./index.ts";

let report: IsolationReport;
let tcp: net.Server;
let unix: net.Server;
let tcpPort = 0;
let tcpSeen = 0;
let unixSeen = 0;
const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tsbx-"));
const unixPath = path.join(dir, "parent.sock");
const canary = path.join(dir, "case-file.txt");

beforeAll(async () => {
  fs.writeFileSync(canary, "CONFIDENTIAL_CASE_DATA", { mode: 0o600 });
  tcp = net.createServer((s) => {
    tcpSeen++;
    s.destroy();
  });
  unix = net.createServer((s) => {
    unixSeen++;
    s.destroy();
  });
  await new Promise<void>((r) => tcp.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => unix.listen(unixPath, r));
  tcpPort = (tcp.address() as net.AddressInfo).port;
  report = await probeIsolation();
}, 60_000);

afterAll(() => {
  tcp.close();
  unix.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const linuxWithCompiler = process.platform === "linux" && spawnSync("cc", ["--version"]).status === 0;

function done(o: SandboxOutcome): SandboxResult {
  if (isRefusal(o)) throw new Error(`sandbox refused: ${o.reason} ${o.detail ?? ""}`);
  if (isAborted(o)) throw new Error(`sandbox aborted: ${o.reason}`);
  return o;
}

let helperPath: string | null | undefined;
/**
 * A tiny C helper: forks its OWN child (so Yama ptrace_scope=1, which allows tracing descendants, does not mask the
 * result), then tries process_vm_readv and PTRACE_ATTACH on it and prints the errno names.
 */
function ptraceHelper(): string | null {
  if (helperPath !== undefined) return helperPath;
  const src = path.join(dir, "ptrace-helper.c");
  const out = path.join(dir, "ptrace-helper");
  fs.writeFileSync(
    src,
    `#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <sys/ptrace.h>
#include <sys/uio.h>
#include <sys/wait.h>
#include <unistd.h>
static char probe[8] = "probe";
static const char *name(int e) { return e == 0 ? "OK" : e == EPERM ? "EPERM" : e == EACCES ? "EACCES" : e == ESRCH ? "ESRCH" : "OTHER"; }
int main(void) {
  pid_t child = fork();
  if (child == 0) { for (;;) pause(); }
  usleep(50000);
  char buf[8];
  struct iovec local = { buf, sizeof buf }, remote = { probe, sizeof probe };
  long n = process_vm_readv(child, &local, 1, &remote, 1, 0); int e1 = n < 0 ? errno : 0;
  long a = ptrace(PTRACE_ATTACH, child, 0, 0); int e2 = a < 0 ? errno : 0;
  kill(child, SIGKILL); waitpid(child, 0, 0);
  printf("vm_readv=%s attach=%s\\n", name(e1), name(e2));
  return 0;
}
`,
  );
  const built = spawnSync("cc", ["-O2", "-o", out, src], { encoding: "utf8" });
  if (built.status !== 0) console.info(`[T-SBX-008] helper build failed: ${built.stderr}`);
  helperPath = built.status === 0 ? out : null;
  return helperPath;
}

const env = () => ({ IR_PORT: String(tcpPort), IR_UNIX: unixPath, IR_CANARY: canary, IR_PARENT: String(process.pid) });

const HOSTILE_TCP = `
import * as net from "node:net";
const s = net.connect(Number(process.env.IR_PORT), "127.0.0.1");
s.on("connect", () => { console.log("CONNECTED"); process.exit(0); });
s.on("error", (e) => { console.log("ERR_" + e.code); process.exit(0); });
setTimeout(() => { console.log("TIMEOUT"); process.exit(0); }, 4000);
`;

/** Run hostile source with plain node (NO sandbox) — negative control. */
function unsandboxed(source: string): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--input-type=module", "--eval", source], { env: { ...process.env, ...env() } });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => resolve(out.trim()));
  });
}

describe.skipIf(!linuxWithCompiler)("T-SBX on this host", () => {
  it("probe report (informational): which levels this host can enforce", () => {
    expect(report.launcher).toBe(true);
    expect(report.networkOnly).toBe(true);
    console.info(`[T-SBX] full=${report.full} networkOnly=${report.networkOnly} ${report.detail.join("; ")}`);
  });

  for (const level of ["network-only", "full"] as const) {
    describe(`level ${level}`, () => {
      const skip = () => level === "full" && !report.full;
      const run = (src: string, extra: Record<string, string> = {}) =>
        runAtLevel(level, src, { env: { ...env(), ...extra }, timeoutMs: 20_000 });

      it("T-SBX-001: a direct TCP connect to a local listener is refused (EACCES) and the listener sees nothing", async (ctx) => {
        if (skip()) return ctx.skip();
        const before = tcpSeen;
        const r = done(await run(HOSTILE_TCP));
        expect(r.stdout.trim()).toBe("ERR_EACCES");
        expect(tcpSeen).toBe(before);
      });

      it("T-SBX-002: a connection attempt to 169.254.169.254 fails at socket creation (no packet can leave)", async (ctx) => {
        if (skip()) return ctx.skip();
        const r = done(
          await run(`
import * as net from "node:net";
const s = net.connect(80, "169.254.169.254");
s.on("connect", () => { console.log("CONNECTED"); process.exit(0); });
s.on("error", (e) => { console.log("ERR_" + e.code + "_" + e.syscall); process.exit(0); });
setTimeout(() => { console.log("TIMEOUT"); process.exit(0); }, 4000);
`),
        );
        // the socket() syscall itself is refused, so no SYN is ever sent
        expect(r.stdout.trim()).toBe("ERR_EACCES_connect");
      });

      it("T-SBX-003: fetch() and DNS resolution fail (getaddrinfo cannot open a socket either)", async (ctx) => {
        if (skip()) return ctx.skip();
        const r = done(
          await run(`
import * as dns from "node:dns/promises";
let d = "ok"; try { await dns.lookup("example.com"); } catch (e) { d = e.code; }
let f = "ok"; try { await fetch("https://example.com/"); } catch (e) { f = e.cause?.code ?? e.message; }
console.log(JSON.stringify({ d, f }));
`),
        );
        const o = JSON.parse(r.stdout.trim()) as { d: string; f: string };
        expect(o.d).not.toBe("ok");
        expect(o.f).not.toBe("ok");
      });

      it("T-SBX-004: an AF_UNIX connect to the parent's local socket is refused and the server sees nothing", async (ctx) => {
        if (skip()) return ctx.skip();
        const before = unixSeen;
        const r = done(
          await run(`
import * as net from "node:net";
const s = net.connect({ path: process.env.IR_UNIX });
s.on("connect", () => { console.log("CONNECTED"); process.exit(0); });
s.on("error", (e) => { console.log("ERR_" + e.code); process.exit(0); });
`),
        );
        // network-only: socket() refused (EACCES). full: the socket path is not even visible (ENOENT) — and socket()
        // is refused anyway.
        expect(r.stdout.trim()).toMatch(level === "full" ? /^ERR_(EACCES|ENOENT)$/ : /^ERR_EACCES$/);
        expect(unixSeen).toBe(before);
      });

      it("T-SBX-005: UDP send is refused", async (ctx) => {
        if (skip()) return ctx.skip();
        const r = done(
          await run(`
import * as dgram from "node:dgram";
try { const s = dgram.createSocket("udp4"); s.on("error", (e) => { console.log("ERR_" + e.code); process.exit(0); }); s.send("x", Number(process.env.IR_PORT), "127.0.0.1", (e) => { console.log(e ? "ERR_" + e.code : "SENT"); process.exit(0); }); }
catch (e) { console.log("ERR_" + e.code); }
`),
        );
        expect(r.stdout.trim()).toMatch(/^ERR_EACCES$/);
      });
      it(
        "T-SBX-019: a fork bomb is capped by RLIMIT_NPROC inside the user namespace (P2-003 isolation gap 1)",
        { timeout: 30_000 },
        async (ctx) => {
          if (skip()) return ctx.skip();
          // A classic fork bomb: 80 tiny single-threaded `sleep` children, all kept alive together.
          // Inside the "full" namespace the processes+threads cap (DEFAULT_RESOURCE_LIMITS.processes =
          // 64: the parent's own threads count too) is hit mid-loop and the kernel refuses the rest.
          // The same loop at "network-only" (no namespace, no cap by design) spawns them all — the
          // negative control proving the refusal is OUR cap, not the host's.
          const r = done(
            await run(`
import { spawn } from "node:child_process";
import * as fs from "node:fs";
let started = 0, refused = 0;
for (let i = 0; i < 80; i++) {
  try {
    const c = spawn("sleep", ["3"]);
    if (c.pid) started++; else refused++;
    c.on("error", () => {}); // swallowed: the living count below is the measured bound
  } catch { refused++; }
}
await new Promise((r) => setTimeout(r, 1000));
const alive = fs.readdirSync("/proc").filter((x) => /^[0-9]+$/.test(x) && x !== String(process.pid)).length;
console.log("FORKS started=" + started + " refused=" + refused + " alive=" + alive);
`),
          );
          const m = /^FORKS started=(\d+) refused=(\d+) alive=(\d+)$/.exec(r.stdout.trim());
          expect(m, r.stdout).not.toBeNull();
          const alive = m === null ? 0 : Number(m[3]);
          if (level === "full") {
            // The bomb is BOUNDED: fewer children alive than attempted, and never above the cap.
            expect(alive).toBeLessThan(80);
            expect(alive).toBeLessThanOrEqual(DEFAULT_RESOURCE_LIMITS.processes);
          } else {
            // Negative control: with no namespace cap (by design at this level) the same bomb
            // spawns them all — the bound above is OUR cap, not the host's.
            expect(alive).toBeGreaterThan(DEFAULT_RESOURCE_LIMITS.processes);
          }
        },
      );

      it(
        "T-SBX-020: a memory hog is bounded by RLIMIT_DATA (the committed-usage cap) at every level (P2-003 cgroup gap)",
        { timeout: 60_000 },
        async (ctx) => {
          if (skip()) return ctx.skip();
          const HOG = `
let total = 0;
const bufs = [];
try {
  for (let i = 0; i < 30; i++) {
    const b = Buffer.alloc(50 * 1024 * 1024, 1); // touched => committed anonymous pages
    bufs.push(b); total += 50;
  }
  console.log("HOG allocated " + total + "MB OK");
} catch (e) {
  console.log("HOG refused at " + total + "MB: " + String(e.message).slice(0, 40));
}
`;
          // Default limits: the hog is refused mid-way — a CATCHABLE allocation failure (clean
          // refusal), not a crash — well before the full 1500MB it asks for.
          const r = done(await run(HOG));
          const m = /^HOG refused at (\d+)MB/.exec(r.stdout.trim());
          expect(m, r.stdout).not.toBeNull();
          const refusedAt = m === null ? 1500 : Number(m[1]);
          expect(refusedAt).toBeGreaterThan(100); // the hog got somewhere before the cap
          expect(refusedAt).toBeLessThan(1500); // and was bounded before its full ask
          // Negative control: the SAME hog with the data cap raised (and AS raised with it, so only
          // the DATA cap could have stopped it) allocates the whole 1500MB — the refusal above is
          // OUR cap, not the host's.
          const nc = done(
            await runAtLevel(level, HOG, {
              env: env(),
              timeoutMs: 30_000,
              limits: { dataBytes: 8 * 1024 * 1024 * 1024, addressSpaceBytes: 4 * 1024 * 1024 * 1024 },
            }),
          );
          expect(nc.stdout.trim()).toMatch(/^HOG allocated 1500MB OK$/);
        },
      );

      it(
        "T-SBX-021: without a delegated cgroup subtree the group memory SUM is unbounded (the recorded P2-003 gap, demonstrated reproducibly)",
        { timeout: 90_000 },
        async (ctx) => {
          if (skip()) return ctx.skip();
          // The gap only exists where no delegated cgroup subtree is available. Where one IS delegated,
          // memory.max could bound the group (future work); this demonstration does not apply there.
          if (report.cgroupMemory) return ctx.skip();
          // The probe must RECORD the reason in every report — the gap stays visible outside this test.
          const cgroupLine = report.detail.find((d) => d.startsWith("cgroup: "));
          expect(cgroupLine, report.detail.join("; ")).toBeDefined();
          expect(cgroupLine).not.toMatch(/^cgroup: delegated cgroup subtree/); // it records WHY it is unavailable
          // Reproducible demonstration: six sandboxed children run CONCURRENTLY, each legitimately
          // under its own per-process DATA cap (768MB: ~600MB of V8 startup reservations + 144MB
          // allocated — measured: boots and allocates at 768MB, allocation refused at 640MB),
          // while the SUM of their allocations alone (864MB) already exceeds that cap, and each
          // child commits ~744MB so the group commits ~4.5GB — nothing bounds the sum. The only
          // userspace ceiling is the documented product: processes (64) x dataBytes.
          const CAP = 768 * 1024 * 1024;
          const child = `
const bufs = [];
try {
  for (let i = 0; i < 9; i++) bufs.push(Buffer.alloc(16 * 1024 * 1024, 1)); // touched => committed
  console.log("CHILD OK 9x16MB");
} catch (e) { console.log("CHILD refused: " + String(e.message).slice(0, 40)); }
`;
          const runs = await Promise.all(
            Array.from({ length: 6 }, () =>
              runAtLevel(level, child, {
                env: env(),
                timeoutMs: 30_000,
                limits: { dataBytes: CAP, addressSpaceBytes: 2 * 1024 * 1024 * 1024 },
              }),
            ),
          );
          for (const r of runs) {
            const res = done(r);
            expect(res.stdout.trim()).toBe("CHILD OK 9x16MB");
          }
          // Control: the SAME child under a 640MB cap boots but its allocation is refused —
          // per-process enforcement is intact; the gap is strictly the group SUM.
          const control = done(
            await runAtLevel(level, child, {
              env: env(),
              timeoutMs: 30_000,
              limits: { dataBytes: 640 * 1024 * 1024, addressSpaceBytes: 2 * 1024 * 1024 * 1024 },
            }),
          );
          expect(control.stdout.trim()).toMatch(/^CHILD refused/);
        },
      );

      it("T-SBX-006: a grandchild started with a CLEAN environment (no LD_PRELOAD, no NODE_OPTIONS) is still filtered", async (ctx) => {
        if (skip()) return ctx.skip();
        const before = tcpSeen;
        const r = done(
          await run(`
import { spawnSync } from "node:child_process";
const src = ${JSON.stringify(HOSTILE_TCP)};
const g = spawnSync(process.execPath, ["--input-type=module", "--eval", src], { env: { IR_PORT: process.env.IR_PORT, LD_PRELOAD: "" }, encoding: "utf8" });
console.log("GRANDCHILD " + (g.stdout || "").trim() + " status=" + g.status);
`),
        );
        expect(r.stdout.trim()).toBe("GRANDCHILD ERR_EACCES status=0");
        expect(tcpSeen).toBe(before);
      });

      it("T-SBX-007: Node's internal TCP binding (process.binding) hits the same kernel filter", async (ctx) => {
        if (skip()) return ctx.skip();
        const before = tcpSeen;
        const r = done(
          await run(`
const { TCP, TCPConnectWrap, constants } = process.binding("tcp_wrap");
const h = new TCP(constants.SOCKET);
const req = new TCPConnectWrap();
req.oncomplete = (status) => { console.log("STATUS_" + status); process.exit(0); };
const err = h.connect(req, "127.0.0.1", Number(process.env.IR_PORT));
if (err) { console.log("SYNC_" + err); process.exit(0); }
setTimeout(() => { console.log("TIMEOUT"); process.exit(0); }, 4000);
`),
        );
        expect(r.stdout.trim()).not.toMatch(/STATUS_0$/);
        expect(r.stdout.trim()).toMatch(/^(SYNC|STATUS)_-13$/); // -EACCES
        expect(tcpSeen).toBe(before);
      });

      it("T-SBX-008: ptrace / process_vm_readv are refused, even against the transform's own child", async (ctx) => {
        // under "full" the helper binary (in the test's temp dir) is not visible inside the sandbox
        if (skip() || level === "full") return ctx.skip();
        const helper = ptraceHelper();
        if (!helper) return ctx.skip();
        // negative control FIRST: outside the sandbox both calls succeed on the helper's own child, so the refusal
        // below comes from the filter, not from Yama or another host restriction
        const control = spawnSync(helper, [], { encoding: "utf8" });
        expect(control.stdout.trim()).toBe("vm_readv=OK attach=OK");
        const r = done(
          await run(
            `
import { spawnSync } from "node:child_process";
const g = spawnSync(process.env.IR_HELPER, [], { encoding: "utf8" });
console.log((g.stdout || "").trim());
`,
            { IR_HELPER: helper },
          ),
        );
        expect(r.stdout.trim()).toBe("vm_readv=EPERM attach=EPERM");
      });

      it("T-SBX-009: reading a case file of the parent / its /proc entries", async (ctx) => {
        if (skip()) return ctx.skip();
        const r = done(
          await run(`
import * as fs from "node:fs";
const out = {};
try { out.file = fs.readFileSync(process.env.IR_CANARY, "utf8"); } catch (e) { out.file = "ERR_" + e.code; }
try { out.environ = fs.readFileSync("/proc/" + process.env.IR_PARENT + "/environ", "utf8").length > 0 ? "READ" : "EMPTY"; } catch (e) { out.environ = "ERR_" + e.code; }
try { fs.writeFileSync(process.env.IR_CANARY, "tampered"); out.write = "WROTE"; } catch (e) { out.write = "ERR_" + e.code; }
console.log(JSON.stringify(out));
`),
        );
        const o = JSON.parse(r.stdout.trim()) as Record<string, string>;
        if (level === "full") {
          expect(o).toEqual({ file: "ERR_ENOENT", environ: "ERR_ENOENT", write: expect.stringMatching(/^ERR_(ENOENT|EROFS|EACCES)$/) });
          expect(fs.readFileSync(canary, "utf8")).toBe("CONFIDENTIAL_CASE_DATA");
        } else {
          // HONEST: seccomp alone does not isolate files. This assertion documents the gap instead of hiding it.
          expect(o.file).toBe("CONFIDENTIAL_CASE_DATA");
          fs.writeFileSync(canary, "CONFIDENTIAL_CASE_DATA", { mode: 0o600 });
        }
      });

      it("T-SBX-010: the legitimate path works — requests over IPC go through the parent's gateway; a metadata request is denied and audited", async (ctx) => {
        if (skip()) return ctx.skip();
        const audit: EgressAuditEvent[] = [];
        const transportCalls: string[] = [];
        const gateway = createEgressGateway({
          resolver: { resolve: async (h) => (h === "example.com" ? ["93.184.216.34"] : []) },
          transport: {
            fetch: async (r) => {
              transportCalls.push(`${r.host}@${r.pinnedIp}`);
              return { status: 200, body: "hello-from-gateway" };
            },
          },
          auditSink: { record: (e) => audit.push(e) },
        });
        const outcome = await runAtLevel(
          level,
          `
import * as readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
const answers = [];
rl.on("line", (l) => {
  answers.push(JSON.parse(l));
  if (answers.length === 2) { console.log("RESULT " + JSON.stringify(answers)); process.exit(0); }
});
console.log(JSON.stringify({ op: "fetch", id: 1, url: "https://example.com/x" }));
console.log(JSON.stringify({ op: "fetch", id: 2, url: "https://169.254.169.254/latest/meta-data/" }));
`,
          {
            timeoutMs: 20_000,
            ipcHandler: (msg, stdin) => {
              void gateway
                .request({
                  caseId: "c1",
                  purposeRef: "p1",
                  transform: "sbx.test@1",
                  url: String(msg["url"]),
                  sends: ["url"],
                  sensitivity: "normal",
                })
                .then((res) =>
                  stdin?.write(JSON.stringify({ id: msg["id"], ok: res.ok, reason: res.reason, body: res.response?.body }) + "\n"),
                );
            },
          },
        );
        const r = done(outcome);
        const line = r.stdout.split("\n").find((l) => l.startsWith("RESULT "));
        const answers = JSON.parse(String(line).slice(7)) as Array<{ id: number; ok: boolean; reason?: string; body?: string }>;
        answers.sort((a, b) => a.id - b.id);
        expect(answers).toEqual([
          { id: 1, ok: true, body: "hello-from-gateway" },
          { id: 2, ok: false, reason: "address_class" },
        ]);
        expect(transportCalls).toEqual(["example.com@93.184.216.34"]);
        expect(audit.some((e) => e.kind === "denied" && e.reason === "address_class" && e.transform === "sbx.test@1")).toBe(true);
      });

      it("T-SBX-012: the wall-clock limit kills the whole tree, including a detached grandchild", async (ctx) => {
        if (skip()) return ctx.skip();
        const pidFile = path.join(dir, `grandchild-${level}.pid`);
        const r = done(
          await runAtLevel(
            level,
            `
import { spawn } from "node:child_process";
const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
console.log("GRANDCHILD_PID " + g.pid);
setInterval(() => {}, 1000);
`,
            { timeoutMs: 1500, env: { PIDFILE: pidFile } },
          ),
        );
        expect(r.timedOut).toBe(true);
        expect(r.ok).toBe(false);
        await new Promise((res) => setTimeout(res, 300));
        // network-only: the grandchild PID is a host PID; it must be gone. full: it lived in the sandbox PID
        // namespace, which dies with its init.
        const m = /GRANDCHILD_PID (\d+)/.exec(r.stdout);
        if (level === "network-only" && m) {
          let alive = true;
          try {
            process.kill(Number(m[1]), 0);
          } catch {
            alive = false;
          }
          expect(alive).toBe(false);
        }
      });

      // P2-034: resource limits. None of these cases commits large memory: the address-space case ASKS for more
      // than the limit and the kernel refuses the mapping; the heap case uses a 32 MiB heap.
      it("T-SBX-013: an allocation above the address-space limit is refused inside the sandbox (RLIMIT_AS in force)", async (ctx) => {
        if (skip()) return ctx.skip();
        const r = done(
          await run(`
import * as fs from "node:fs";
const line = fs.readFileSync("/proc/self/limits", "utf8").split("\\n").find((l) => l.startsWith("Max address space"));
let alloc;
try { Buffer.alloc(3 * 1024 * 1024 * 1024); alloc = "ALLOCATED"; } catch (e) { alloc = "REFUSED_" + e.name; }
console.log(JSON.stringify({ line, alloc }));
`),
        );
        const out = JSON.parse(r.stdout.trim()) as { line: string; alloc: string };
        expect(out.line.split(/\s+/)).toContain(String(DEFAULT_RESOURCE_LIMITS.addressSpaceBytes));
        expect(out.alloc).toBe("REFUSED_RangeError");
        expect(r.limits.addressSpaceBytes).toBe(DEFAULT_RESOURCE_LIMITS.addressSpaceBytes);
      });

      it("T-SBX-014: the V8 heap cap stops a growing JS heap (fatal OOM, not host memory)", async (ctx) => {
        if (skip()) return ctx.skip();
        const r = await runAtLevel(level, `const keep = []; for (;;) keep.push(new Array(1e5).fill({ x: 1 }));`, {
          timeoutMs: 20_000,
          limits: { heapMb: 32 },
        });
        if (isRefusal(r) || isAborted(r)) throw new Error("unexpected refusal");
        expect(r.ok).toBe(false);
        expect(r.timedOut).toBe(false);
        expect(r.stderr).toMatch(/heap out of memory|Reached heap limit/i);
      });

      it("T-SBX-015: RLIMIT_FSIZE stops a file larger than the limit", async (ctx) => {
        if (skip()) return ctx.skip();
        const r = await runAtLevel(
          level,
          `
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
process.on("SIGXFSZ", () => {});
const f = path.join(os.tmpdir(), "big-" + process.pid);
try { fs.writeFileSync(f, Buffer.alloc(2 * 1024 * 1024)); console.log("WROTE " + fs.statSync(f).size); }
catch (e) { console.log("ERR_" + e.code); }
finally { try { fs.rmSync(f); } catch {} }
`,
          { timeoutMs: 20_000, limits: { fileSizeBytes: 1024 * 1024 } },
        );
        if (isRefusal(r) || isAborted(r)) throw new Error("unexpected refusal");
        // Either the write fails (EFBIG) or SIGXFSZ ends the process; it never writes the 2 MiB file.
        expect(r.stdout).not.toMatch(/WROTE 2097152/);
        if (r.exitCode === 0) expect(r.stdout.trim()).toBe("ERR_EFBIG");
      });

      it("T-SBX-016: RLIMIT_NOFILE caps open descriptors", async (ctx) => {
        if (skip()) return ctx.skip();
        const r = done(
          await runAtLevel(
            level,
            `
import * as fs from "node:fs";
const fds = [];
let code = "NONE";
try { for (let i = 0; i < 200; i++) fds.push(fs.openSync("/proc/self/stat", "r")); } catch (e) { code = e.code; }
console.log(code + " " + fds.length);
`,
            { timeoutMs: 20_000, limits: { openFiles: 64 } },
          ),
        );
        const [code, count] = r.stdout.trim().split(" ");
        expect(code).toBe("EMFILE");
        expect(Number(count)).toBeLessThan(64);
      });

      it("T-SBX-017: output beyond maxOutputBytes kills the tree and the parent keeps at most the cap", async (ctx) => {
        if (skip()) return ctx.skip();
        const r = await runAtLevel(
          level,
          // A fixed 1 MiB written synchronously (no async buffering in the child): the parent sees more than the cap
          // on every run unless it kills the tree first, so the outcome does not depend on scheduling.
          `import * as fs from "node:fs"; const chunk = Buffer.alloc(1024, 120); for (let i = 0; i < 1024; i++) fs.writeSync(1, chunk);`,
          { timeoutMs: 20_000, limits: { maxOutputBytes: 64 * 1024 } },
        );
        if (isRefusal(r) || isAborted(r)) throw new Error("unexpected refusal");
        const diag = `exit=${String(r.exitCode)} signal=${String(r.signal)} stdout=${r.stdout.length} stderr=${r.stderr.slice(0, 300)}`;
        expect(r.outputLimitExceeded, diag).toBe(true);
        expect(r.timedOut, diag).toBe(false);
        expect(r.ok, diag).toBe(false);
        expect(r.stdout.length + r.stderr.length, diag).toBeLessThanOrEqual(64 * 1024);
      });

      it("T-SBX-018: the /tmp tmpfs is size-limited where bubblewrap supports --size", async (ctx) => {
        if (skip() || level !== "full" || !report.tmpfsSize) return ctx.skip();
        const r = done(
          await runAtLevel(
            level,
            `
import * as fs from "node:fs";
let written = 0;
try { for (let i = 0; i < 64; i++) { fs.writeFileSync("/tmp/f" + i, Buffer.alloc(512 * 1024)); written += 512 * 1024; } console.log("OK " + written); }
catch (e) { console.log(e.code + " " + written); }
`,
            { timeoutMs: 20_000, limits: { tmpfsBytes: 4 * 1024 * 1024 } },
          ),
        );
        const [code, written] = r.stdout.trim().split(" ");
        expect(code).toBe("ENOSPC");
        expect(Number(written)).toBeLessThanOrEqual(4 * 1024 * 1024);
      });
    });
  }

  describe("negative controls (the same hostile code WITHOUT the sandbox succeeds, so the cases above are not vacuous)", () => {
    it("direct TCP connect reaches the listener", async () => {
      const before = tcpSeen;
      expect(await unsandboxed(HOSTILE_TCP)).toBe("CONNECTED");
      await new Promise((r) => setTimeout(r, 50));
      expect(tcpSeen).toBe(before + 1);
    });
    it("AF_UNIX connect reaches the parent's socket", async () => {
      const before = unixSeen;
      expect(
        await unsandboxed(
          `import * as net from "node:net"; const s = net.connect({ path: process.env.IR_UNIX }); s.on("connect", () => { console.log("CONNECTED"); process.exit(0); }); s.on("error", (e) => { console.log("ERR_" + e.code); process.exit(0); });`,
        ),
      ).toBe("CONNECTED");
      await new Promise((r) => setTimeout(r, 50));
      expect(unixSeen).toBe(before + 1);
    });
    it("without the launcher there is no address-space limit (so T-SBX-013 is not vacuous)", async () => {
      const out = await unsandboxed(
        `import * as fs from "node:fs"; console.log(fs.readFileSync("/proc/self/limits", "utf8").split("\\n").find((l) => l.startsWith("Max address space")));`,
      );
      expect(out).toMatch(/unlimited/);
    });

    it("the launcher refuses a malformed limit instead of running with weaker ones (exit 73)", () => {
      const launcher = report.launcher ? spawnSync("cc", ["--version"]).status === 0 : false;
      if (!launcher) return;
      const build = buildSeccompLauncher();
      expect(build.launcherPath).toBeTruthy();
      for (const bad of ["--rlimit=as:12x", "--rlimit=bogus:1", "--rlimit=as:", "--rlimit=:5"]) {
        const r = spawnSync(build.launcherPath as string, [bad, "/bin/true"], { encoding: "utf8" });
        expect(r.status, bad).toBe(73);
      }
    });

    it("the case file is readable", async () => {
      expect(await unsandboxed(`import * as fs from "node:fs"; console.log(fs.readFileSync(process.env.IR_CANARY, "utf8"));`)).toBe(
        "CONFIDENTIAL_CASE_DATA",
      );
    });
  });

  describe("T-SBX-011: fail-closed decisions", () => {
    it("requiring 'full' where the host cannot provide it is a refusal, never a lower-assurance run", async () => {
      const o = await runSandboxedTransform(`console.log("RAN")`, { requireAssurance: "full" });
      if (report.full) {
        expect(isRefusal(o)).toBe(false);
        expect((o as SandboxResult).assurance).toBe("full");
      } else {
        expect(o).toMatchObject({ refused: true, reason: "isolation_unavailable" });
      }
    });
    it("the default requirement is 'full'", async () => {
      const o = await runSandboxedTransform(`console.log("RAN")`);
      if (report.full) expect((o as SandboxResult).assurance).toBe("full");
      else expect(o).toMatchObject({ refused: true, reason: "isolation_unavailable" });
    });
    it("the transform does not inherit the parent's environment (secrets in env stay in the parent)", async () => {
      process.env["IR_TEST_PARENT_SECRET"] = "parent-only-value";
      try {
        const r = done(await runAtLevel("network-only", `console.log(JSON.stringify(Object.keys(process.env).sort()))`));
        expect(r.stdout).not.toContain("IR_TEST_PARENT_SECRET");
        expect(r.stdout).not.toContain("NODE_OPTIONS");
      } finally {
        delete process.env["IR_TEST_PARENT_SECRET"];
      }
    });
  });
});

describe.skipIf(linuxWithCompiler)("T-SBX on a host without Linux seccomp or a C compiler", () => {
  it("refuses to run any transform", async () => {
    const o = await runSandboxedTransform(`console.log("RAN")`, { requireAssurance: "network-only" });
    expect(isRefusal(o)).toBe(true);
  });
});
