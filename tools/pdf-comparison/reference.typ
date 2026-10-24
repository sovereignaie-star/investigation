// P5-027 — النموذج الأولي: التقرير المرجعي العربي بمحرك Typst
// يُترجم بـ: npx typst compile reference.typ out.pdf (خطوط Noto في نفس المجلد)
#set page(paper: "a4", margin: 2cm)
#set text(font: ("Noto Naskh Arabic", "Noto Sans"), size: 11pt, lang: "ar")
#set par(justify: true)

#align(right)[
  #text(size: 18pt, weight: "bold")[تقرير فحص النطاق example.test]

  #text(size: 10pt, fill: rgb("#555"))[القضية: case-001 — التاريخ: 2026-10-24]
]

#v(1em)

== الملخص التنفيذي

النطاق example.test يسجّل سجل A عند 93.184.216.34 #link(<EV-1>)[1]. الصفحة الرئيسية موثقة بلقطة أرشيفية كاملة #link(<EV-2>)[2].

#v(1em)

== ملحق الأدلة

=== EV-1 — سجل DNS للنطاق <EV-1>

سجل A عند 93.184.216.34 — البصمة: aaaa...aa

=== EV-2 — لقطة WARC <EV-2>

أرشفة كاملة للصفحة الرئيسية — البصمة: bbbb...bb
