// P5-027 — تحقق موحد من مخرجات المحركات الثلاثة (pdfjs-dist):
// استخراج النص (قبل/بعد NFKC) + عدّ توضيحات الروابط الداخلية.
// يعمل بـ: npm i pdfjs-dist && node verify.mjs <file.pdf>
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFile } from "node:fs/promises";

const path = process.argv[2];
const data = new Uint8Array(await readFile(path));
const doc = await getDocument({ data, useSystemFonts: false }).promise;
const page = await doc.getPage(1);
const content = await page.getTextContent();
const raw = content.items.map((i) => i.str ?? "").join("");
const nfkc = raw.normalize("NFKC");
const arabicBase = [...nfkc].filter((c) => /[\u0600-\u06FF]/.test(c)).length;
const latinOk = raw.includes("example.test") || nfkc.includes("example.test");
const annotations = await page.getAnnotations();
const links = annotations.filter((a) => a.subtype === "Link");
const dests = links.map((l) => String(l.dest ?? l.url ?? ""));
console.log(
  JSON.stringify(
    {
      pages: doc.numPages,
      arabicCodepointsAfterNfkc: arabicBase,
      latinPresent: latinOk,
      linkAnnotations: links.length,
      linkDests: dests.slice(0, 6),
    },
    null,
    2,
  ),
);
