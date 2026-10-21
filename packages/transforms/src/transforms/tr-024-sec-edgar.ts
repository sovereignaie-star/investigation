/**
 * P2-011 — TR-024: SEC EDGAR (name/CIK → filings metadata).
 *
 * Source: data.sec.gov, public, no key (LC-B; evaluation docs/tools/evaluations/TL-c35f8b0a.md).
 * Two operations: look up a company's CIK from its ticker in `company_tickers.json`, then read its
 * recent filings metadata from `submissions/CIK##########.json`. The transform never downloads filing
 * documents in this batch — metadata only (accession number, form type, filing date).
 * All network I/O goes through `ctx.http` (egress gateway in production, ADR-08).
 *
 * Limits: rps 1 (SEC policy is ≤10/s; we stay far below), timeoutMs 15s, maxBytes 4MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { parseJson } from "./util.ts";

const SUBMISSIONS = (cik: string) => `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`;

interface EdgardRecent {
  form?: string[];
  filingDate?: string[];
  accessionNumber?: string[];
}
interface EdgarRecord {
  name?: string;
  tickers?: string[];
  exchanges?: string[];
  filings?: { recent?: EdgardRecent };
}

function registeredName(cik: string, name: string, requestId: number): TransformFinding {
  return {
    predicate: "has_registered_name",
    objectType: "cik_us",
    objectValue: cik,
    confidence: 0.95,
    explanation: `SEC EDGAR: CIK ${cik} is registered as "${name}"`,
    evidence: [requestId],
  };
}

function tickerOf(data: EdgarRecord): string | undefined {
  const t = data.tickers?.[0];
  return t && /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(t) ? t : undefined;
}

function hasTicker(cik: string, ticker: string, exchange: string | undefined, requestId: number): TransformFinding {
  return {
    predicate: "has_ticker",
    objectType: "stock_ticker",
    objectValue: ticker,
    confidence: 0.95,
    explanation: `SEC EDGAR: CIK ${cik} trades as ${ticker} on ${exchange ?? "a US exchange"}`,
    evidence: [requestId],
  };
}

function recentFilings(cik: string, data: EdgarRecord, requestId: number): TransformFinding[] {
  const recent = data.filings?.recent;
  const forms = recent?.form ?? [];
  const dates = recent?.filingDate ?? [];
  const accs = recent?.accessionNumber ?? [];
  const out: TransformFinding[] = [];
  for (let i = 0; i < Math.min(5, forms.length, dates.length, accs.length); i++) {
    const form = forms[i],
      date = dates[i],
      acc = accs[i];
    if (!form || !date || !acc) continue;
    out.push({
      predicate: "has_filing",
      objectType: "url",
      objectValue: `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, "")}/${form}-${date}.txt`,
      confidence: 0.9,
      explanation: `SEC EDGAR: ${form} filed on ${date} (accession ${acc})`,
      evidence: [requestId],
    });
  }
  return out;
}

export const secEdgar = defineTransform<{ cik: string }>(
  {
    id: "TR-024",
    version: "1.0.0",
    inputs: ["cik_us"],
    outputs: ["cik_us", "url"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 4_000_000 },
    sensitivity: "normal",
    license: "LC-B",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "A",
      credibility: 1,
      rationale: "نظام EDGAR لهيئة الأوراق المالية الأمريكية — الإفصاحات الرسمية المودعة إلزامياً",
    },
  },
  async (input, ctx) => {
    const cik = String(input.cik).trim();
    if (!/^\d{1,10}$/.test(cik)) throw new Error(`TR-024: invalid CIK "${input.cik}"`);
    const res = await ctx.http.get(SUBMISSIONS(cik));
    const data = parseJson(res.body, "SEC EDGAR") as EdgarRecord;
    if (!data.name) return { findings: [] };
    const findings: TransformFinding[] = [registeredName(cik, data.name, res.requestId)];
    const ticker = tickerOf(data);
    if (ticker) findings.push(hasTicker(cik, ticker, data.exchanges?.[0], res.requestId));
    findings.push(...recentFilings(cik, data, res.requestId));
    return { findings };
  },
);
