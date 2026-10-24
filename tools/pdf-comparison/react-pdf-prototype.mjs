// P5-027 — النموذج الأولي: نفس التقرير بمحرك @react-pdf/renderer
// يعمل بـ: npm i react @react-pdf/renderer && node react-pdf-prototype.mjs
// (يتطلب NotoNaskhArabic-Regular.ttf في نفس المجلد)
import { createElement as h } from "react";
import { Document, Page, Text, Link, StyleSheet, Font, renderToFile } from "@react-pdf/renderer";

Font.register({ family: "NotoNaskhArabic", src: "NotoNaskhArabic-Regular.ttf" });

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "NotoNaskhArabic" },
  title: { fontSize: 18, bold: true, textAlign: "right" },
  h2: { fontSize: 14, marginTop: 12, textAlign: "right" },
  p: { fontSize: 11, marginTop: 4, textAlign: "right" },
});

const Report = () =>
  h(
    Document,
    null,
    h(
      Page,
      { size: "A4", style: styles.page },
      h(Text, { style: styles.title }, "تقرير فحص النطاق example.test"),
      h(Text, { style: { fontSize: 10, color: "#555555", textAlign: "right" } }, "القضية: case-001"),
      h(Text, { style: styles.h2 }, "الملخص التنفيذي"),
      h(
        Text,
        { style: styles.p },
        "النطاق example.test يسجّل سجل A عند 93.184.216.34 ",
        h(Link, { src: "#EV-1", style: { fontSize: 8 } }, "[1]"),
        ".",
      ),
      h(
        Text,
        { style: styles.p },
        "الصفحة الرئيسية موثقة بلقطة أرشيفية كاملة ",
        h(Link, { src: "#EV-2", style: { fontSize: 8 } }, "[2]"),
        ".",
      ),
      h(Text, { style: styles.h2 }, "ملحق الأدلة"),
      h(Text, { style: styles.p }, "EV-1 — سجل DNS للنطاق: aaaa...aa"),
      h(Text, { style: styles.p }, "EV-2 — لقطة WARC: bbbb...bb"),
    ),
  );

await renderToFile(Report(), "out-reactpdf.pdf");
console.log("done");
