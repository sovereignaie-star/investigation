/**
 * P2-037 — deterministic responses for the public connector batch (TR-001, TR-002, TR-003, TR-004, TR-006, TR-011),
 * in the real wire formats of each source:
 *
 * - dns.google JSON (`Status` is the DNS RCODE; `Answer[].type` is the RR type number; names end with a dot);
 * - IANA RDAP bootstraps (RFC 9224: `services: [[keys[], urls[]], ...]` — the URLs are a LIST);
 * - RDAP domain / ip network / autnum objects (RFC 9083; registrar and registrant are entities with roles and jCard
 *   `vcardArray`; ARIN-style `cidr0_cidrs`);
 * - crt.sh JSON (`name_value` holds newline-separated SAN names);
 * - Team Cymru origin TXT via DoH (`"ASN[ ASN...] | prefix | cc | registry | date"`);
 * - Wayback CDX JSON (header row first).
 *
 * Used by the unit tests (through `@ir/sim`) and by the CLI end-to-end tests (behind the real egress gateway with a
 * synthetic resolver and transport). No live network.
 */

export const HOSTS = {
  doh: "dns.google",
  iana: "data.iana.org",
  rdapCom: "rdap.verisign.com",
  rdapArin: "rdap.arin.net",
  crt: "crt.sh",
  wayback: "web.archive.org",
} as const;

/** A dns.google JSON answer (also used by tests that build their own DNS world). */
export const doh = (status: number, answers: Array<{ name: string; type: number; data: string }> = []) =>
  JSON.stringify({ Status: status, TC: false, RD: true, RA: true, AD: false, CD: false, Answer: answers.map((a) => ({ ...a, TTL: 300 })) });

/** TR-001 — dns.google answers for example.com, by RR type number. */
export const DNS_EXAMPLE: Readonly<Record<number, string>> = {
  1: doh(0, [{ name: "example.com.", type: 1, data: "93.184.216.34" }]),
  28: doh(0, [{ name: "example.com.", type: 28, data: "2606:2800:220:1:248:1893:25c8:1946" }]),
  15: doh(0, [
    { name: "example.com.", type: 15, data: "10 mail.example.com." },
    { name: "example.com.", type: 15, data: "20 mx2.example.net." },
  ]),
  2: doh(0, [
    { name: "example.com.", type: 2, data: "a.iana-servers.net." },
    { name: "example.com.", type: 2, data: "b.iana-servers.net." },
  ]),
  16: doh(0, [
    { name: "example.com.", type: 16, data: '"v=spf1 -all"' },
    // RFC 7208 §3.3: one record split into two character-strings is one value
    { name: "example.com.", type: 16, data: '"google-site-verification=" "abc123"' },
  ]),
  5: doh(0, []),
};

/** TR-001 — answers that must not become findings or a false negative. */
export const DNS_SERVFAIL = doh(2);
export const DNS_NXDOMAIN = doh(3);

export const IANA_DNS = JSON.stringify({
  version: "1.0",
  publication: "2026-10-01T00:00:00Z",
  services: [
    [["com", "net"], ["https://rdap.verisign.com/com/v1/"]],
    [["org"], ["https://rdap.publicinterestregistry.org/rdap/"]],
  ],
});

/** TR-002 — Verisign-style RDAP domain object (registrar entity without a jCard kind, as Verisign publishes it). */
export const RDAP_DOMAIN_EXAMPLE = JSON.stringify({
  objectClassName: "domain",
  ldhName: "EXAMPLE.COM",
  status: ["client delete prohibited", "client transfer prohibited", "client update prohibited"],
  events: [
    { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" },
    { eventAction: "expiration", eventDate: "2027-08-13T04:00:00Z" },
    { eventAction: "last update of RDAP database", eventDate: "2026-10-14T00:00:00Z" },
  ],
  entities: [
    {
      objectClassName: "entity",
      handle: "376",
      roles: ["registrar"],
      vcardArray: [
        "vcard",
        [
          ["version", {}, "text", "4.0"],
          ["fn", {}, "text", "RESERVED-Internet Assigned Numbers Authority"],
        ],
      ],
      entities: [
        {
          objectClassName: "entity",
          roles: ["abuse"],
          vcardArray: [
            "vcard",
            [
              ["version", {}, "text", "4.0"],
              ["fn", {}, "text", "Abuse Contact"],
              ["kind", {}, "text", "individual"],
            ],
          ],
        },
      ],
    },
    {
      objectClassName: "entity",
      roles: ["registrant"],
      // A natural person: must never become a finding.
      vcardArray: [
        "vcard",
        [
          ["version", {}, "text", "4.0"],
          ["fn", {}, "text", "Jane Doe"],
          ["kind", {}, "text", "individual"],
        ],
      ],
    },
  ],
  nameservers: [
    { objectClassName: "nameserver", ldhName: "A.IANA-SERVERS.NET" },
    { objectClassName: "nameserver", ldhName: "B.IANA-SERVERS.NET." },
  ],
});

export const IANA_IPV4 = JSON.stringify({
  version: "1.0",
  services: [
    [
      ["8.0.0.0/8", "23.0.0.0/8"],
      ["https://rdap.arin.net/registry/", "http://rdap.arin.net/registry/"],
    ],
    [["2.0.0.0/8"], ["https://rdap.db.ripe.net/"]],
  ],
});

export const IANA_IPV6 = JSON.stringify({
  version: "1.0",
  services: [[["2001:4800::/23", "2600::/12"], ["https://rdap.arin.net/registry/"]]],
});

export const IANA_ASN = JSON.stringify({
  version: "1.0",
  services: [
    [["13312-18431", "36864-37887"], ["https://rdap.arin.net/registry/"]],
    [["3154-3353"], ["https://rdap.db.ripe.net/"]],
  ],
});

const ORG_GOOGLE = {
  objectClassName: "entity",
  handle: "GOGL",
  roles: ["registrant"],
  vcardArray: [
    "vcard",
    [
      ["version", {}, "text", "4.0"],
      ["fn", {}, "text", "Google LLC"],
      ["kind", {}, "text", "org"],
    ],
  ],
};

/** TR-003 — ARIN-style RDAP ip network for 8.8.8.8 (with the cidr0 extension). */
export const RDAP_IP_8888 = JSON.stringify({
  objectClassName: "ip network",
  handle: "NET-8-8-8-0-2",
  startAddress: "8.8.8.0",
  endAddress: "8.8.8.255",
  ipVersion: "v4",
  name: "GOGL",
  type: "DIRECT ALLOCATION",
  cidr0_cidrs: [{ v4prefix: "8.8.8.0", length: 24 }],
  entities: [ORG_GOOGLE],
});

/** TR-003 — a network whose range is not one CIDR block (23.0.0.0 - 23.0.2.255 = /23 + /24), no cidr0. */
export const RDAP_IP_RANGE = JSON.stringify({
  objectClassName: "ip network",
  startAddress: "23.0.0.0",
  endAddress: "23.0.2.255",
  ipVersion: "v4",
  name: "RANGE-NET",
  entities: [],
});

/** TR-003 — an inconsistent answer: the network does not contain the queried address. */
export const RDAP_IP_WRONG = JSON.stringify({ objectClassName: "ip network", startAddress: "8.8.4.0", endAddress: "8.8.4.255", name: "X" });

/** TR-003 — IPv6 network (catalog cidr is IPv4-only: no cidr finding, name and owner still reported). */
export const RDAP_IP6 = JSON.stringify({
  objectClassName: "ip network",
  startAddress: "2001:4860::",
  endAddress: "2001:4860:ffff:ffff:ffff:ffff:ffff:ffff",
  ipVersion: "v6",
  name: "GOOGLE-IPV6",
  cidr0_cidrs: [{ v6prefix: "2001:4860::", length: 32 }],
  entities: [ORG_GOOGLE],
});

/** TR-003 — RDAP autnum for AS15169. */
export const RDAP_AS15169 = JSON.stringify({
  objectClassName: "autnum",
  handle: "AS15169",
  startAutnum: 15169,
  endAutnum: 15169,
  name: "GOOGLE",
  entities: [ORG_GOOGLE],
});

/** TR-004 — crt.sh JSON for %.example.com. */
export const CRT_EXAMPLE = JSON.stringify([
  {
    issuer_ca_id: 1,
    issuer_name: "C=US, O=Let's Encrypt, CN=R3",
    common_name: "www.example.com",
    name_value: "example.com\nwww.example.com",
    id: 1001,
    serial_number: "03ab5c1f0e2d",
  },
  {
    issuer_ca_id: 1,
    issuer_name: "C=US, O=Let's Encrypt, CN=R3",
    common_name: "*.api.example.com",
    name_value: "*.api.example.com\nWWW.example.com\nevilexample.com\nhostmaster@example.com\nbad_name.example.com",
    id: 1002,
    serial_number: "04cd",
  },
]);

/** TR-006 — Team Cymru origin TXT for 8.8.8.8 (plus a multi-origin announcement for 1.2.3.4). */
export const CYMRU_8888 = doh(0, [
  { name: "8.8.8.8.origin.asn.cymru.com.", type: 16, data: '"15169 | 8.8.8.0/24 | US | arin | 1992-12-01"' },
]);
export const CYMRU_MOAS = doh(0, [
  { name: "4.3.2.1.origin.asn.cymru.com.", type: 16, data: '"13335 15169 | 1.2.3.0/24 | AU | apnic | 2011-08-11"' },
]);

/** TR-011 — Wayback CDX JSON for https://example.com/. */
export const CDX_EXAMPLE = JSON.stringify([
  ["timestamp", "original", "statuscode"],
  ["20200101000000", "https://example.com/", "200"],
  ["20210615123456", "https://example.com/", "200"],
  ["2021", "https://example.com/", "200"],
]);
