/**
 * P2-008 — @ir/sim: deterministic simulation world for transforms.
 *
 * The sim is a scripted `HttpTransport` (see ./server.ts) that exercises
 * transform behaviour with deterministic responses and NO external connections.
 * It is the test/training world (D11) the roadmap requires: every transform has
 * a simulation path that is reproducible and never depends on a changing public
 * service.
 *
 * Scope boundary: the sim simulates the NETWORK, not the sandbox. Transform
 * isolation is P2-005 / G-15 and keeps its own acceptance; P2-009 depends on
 * both P2-005 and P2-008.
 */
export * from "./server.ts";
