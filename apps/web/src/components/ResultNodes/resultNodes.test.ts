import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";

// P3-016 red-first: the eight result-node renderers rewritten over the new view
// model. The acceptance criterion is «كل نوع عقدة بلقطة» — each node type with
// a snapshot: below, every one of the eight renders with representative data
// and is captured by an inline snapshot plus explicit assertions on the new
// contract (unrolled one it() per type — an inline snapshot needs its own call
// site):
//
// - typed data (no Record<string, unknown> soup) — fields a node does not
//   declare are simply not rendered, and INVALID data fails closed to an honest
//   shell (never a half-rendered node);
// - the @ir/ui token palette only (bg-card / border-border / text-*-foreground)
//   — the hardcoded zinc/blue/emerald legacy palette is gone, so the nodes work
//   in BOTH themes (light and dark) and stay readable;
// - evidence references: a node whose data carries evidenceIds shows them
//   (the P3-008 rule — what is shown links to its evidence);
// - P1-023 preserved: VideoNode embeds only real YouTube hosts (hostname
//   parsed, never a substring match) — a non-YouTube URL renders no iframe.
import { DefaultNode } from "./DefaultNode";
import { FileNode } from "./FileNode";
import { ImageNode } from "./ImageNode";
import { LinkNode } from "./LinkNode";
import { LocationNode } from "./LocationNode";
import { MapNode } from "./MapNode";
import { TextNode } from "./TextNode";
import { VideoNode } from "./VideoNode";
import { parseNodeData } from "./contract";

/** Renders one node inside the provider xyflow's Handle needs. */
const renderNode = (element: React.ReactElement): string => renderToStaticMarkup(React.createElement(ReactFlowProvider, null, element));

/** The shared assertions of every node type's snapshot test. */
function expectNodeSnapshot(html: string, value: string): void {
  expect(html).toContain("bg-card");
  expect(html).not.toMatch(/zinc-\d|bg-blue-\d|border-blue-\d|emerald-\d|pink-\d|cyan-\d|amber-\d|teal-\d|green-\d/);
  expect(html).toContain(value);
  expect(html).not.toContain("بيانات عقدة غير صالحة");
}

describe("P3-016 — كل نوع عقدة بلقطة (the eight result nodes on the new view model)", () => {
  it("(default) renders with its typed data — a snapshot per node type", () => {
    const html = renderNode(
      React.createElement(DefaultNode, { data: { label: "example.com", value: "example.com", identifierType: "domain" }, selected: false }),
    );
    expectNodeSnapshot(html, "example.com");
    expect(html).toMatchInlineSnapshot(
      `"<div class="bg-card text-foreground border rounded-lg shadow min-w-[200px] max-w-[300px] border-border" data-selected="false"><div data-handlepos="top" data-id="1-null-null-target" class="react-flow__handle react-flow__handle-top nodrag nopan !bg-primary !w-2 !h-2 target connectable connectablestart connectableend connectionindicator"></div><div class="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50 rounded-t-lg"><span class="text-primary"><span class="text-base">🌍</span></span><span class="text-xs font-medium truncate">اسم النطاق</span></div><div class="p-3"><p class="text-sm font-mono break-all leading-tight" dir="ltr">example.com</p></div><div class="border-t border-border"><button type="button" class="w-full flex items-center justify-center gap-1 py-1.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg><span class="text-xs">نسخ</span></button></div><div data-handlepos="bottom" data-id="1-null-null-source" class="react-flow__handle react-flow__handle-bottom nodrag nopan !bg-primary !w-2 !h-2 source connectable connectablestart connectableend connectionindicator"></div></div>"`,
    );
  });

  it("(text) renders with its typed data — a snapshot per node type", () => {
    const html = renderNode(React.createElement(TextNode, { data: { label: "نص", value: "عينة نص مستخرج" }, selected: false }));
    expectNodeSnapshot(html, "عينة نص مستخرج");
    expect(html).toMatchInlineSnapshot(
      `"<div class="bg-card text-foreground border rounded-lg shadow min-w-[200px] max-w-[300px] border-border" data-selected="false"><div data-handlepos="top" data-id="1-null-null-target" class="react-flow__handle react-flow__handle-top nodrag nopan !bg-primary !w-2 !h-2 target connectable connectablestart connectableend connectionindicator"></div><div class="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50 rounded-t-lg"><span class="text-primary"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path></svg></span><span class="text-xs font-medium truncate">نص</span></div><div class="p-3"><p class="text-sm whitespace-pre-wrap break-words leading-relaxed">عينة نص مستخرج</p></div><div class="border-t border-border"><button type="button" class="w-full flex items-center justify-center gap-1 py-1.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg><span class="text-xs">نسخ النص</span></button></div><div data-handlepos="bottom" data-id="1-null-null-source" class="react-flow__handle react-flow__handle-bottom nodrag nopan !bg-primary !w-2 !h-2 source connectable connectablestart connectableend connectionindicator"></div></div>"`,
    );
  });

  it("(link) renders with its typed data — a snapshot per node type", () => {
    const html = renderNode(
      React.createElement(LinkNode, { data: { label: "رابط", url: "https://example.com", domain: "example.com" }, selected: false }),
    );
    expectNodeSnapshot(html, "https://example.com");
    expect(html).toMatchInlineSnapshot(
      `"<div class="bg-card text-foreground border rounded-lg shadow min-w-[200px] max-w-[300px] border-border" data-selected="false"><div data-handlepos="top" data-id="1-null-null-target" class="react-flow__handle react-flow__handle-top nodrag nopan !bg-primary !w-2 !h-2 target connectable connectablestart connectableend connectionindicator"></div><div class="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50 rounded-t-lg"><span class="text-primary"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-link" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></span><span class="text-xs font-medium truncate">رابط</span></div><div class="p-3"><p class="text-xs font-mono break-all text-primary" dir="ltr">https://example.com</p><p class="text-xs text-muted-foreground mt-1" dir="ltr">example.com</p></div><div class="border-t border-border"><a href="https://example.com" class="w-full flex items-center justify-center gap-1 py-1.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" target="_blank" rel="noopener noreferrer"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-external-link" aria-hidden="true"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg><span class="text-xs">فتح</span></a></div><div data-handlepos="bottom" data-id="1-null-null-source" class="react-flow__handle react-flow__handle-bottom nodrag nopan !bg-primary !w-2 !h-2 source connectable connectablestart connectableend connectionindicator"></div></div>"`,
    );
  });

  it("(file) renders with its typed data — a snapshot per node type", () => {
    const html = renderNode(
      React.createElement(FileNode, { data: { label: "ملف", name: "report.pdf", size: 1024, mime: "application/pdf" }, selected: false }),
    );
    expectNodeSnapshot(html, "report.pdf");
    expect(html).toMatchInlineSnapshot(
      `"<div class="bg-card text-foreground border rounded-lg shadow min-w-[200px] max-w-[300px] border-border" data-selected="false"><div data-handlepos="top" data-id="1-null-null-target" class="react-flow__handle react-flow__handle-top nodrag nopan !bg-primary !w-2 !h-2 target connectable connectablestart connectableend connectionindicator"></div><div class="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50 rounded-t-lg"><span class="text-primary"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path></svg></span><span class="text-xs font-medium truncate">ملف</span></div><div class="p-3"><div class="flex items-start gap-2"><div class="w-10 h-12 bg-muted rounded flex items-center justify-center shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file text-primary" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path></svg></div><div class="min-w-0"><p class="text-sm font-medium truncate" dir="ltr">report.pdf</p><p class="text-xs text-muted-foreground" dir="ltr">application/pdf</p><p class="text-xs text-muted-foreground" dir="ltr">1.0 KB</p></div></div></div><div data-handlepos="bottom" data-id="1-null-null-source" class="react-flow__handle react-flow__handle-bottom nodrag nopan !bg-primary !w-2 !h-2 source connectable connectablestart connectableend connectionindicator"></div></div>"`,
    );
  });

  it("(image) renders with its typed data — a snapshot per node type", () => {
    const html = renderNode(
      React.createElement(ImageNode, { data: { label: "صورة", src: "https://example.com/photo.jpg" }, selected: false }),
    );
    expectNodeSnapshot(html, "photo.jpg");
    expect(html).toMatchInlineSnapshot(
      `"<div class="bg-card text-foreground border rounded-lg shadow min-w-[200px] max-w-[300px] border-border" data-selected="false"><div data-handlepos="top" data-id="1-null-null-target" class="react-flow__handle react-flow__handle-top nodrag nopan !bg-primary !w-2 !h-2 target connectable connectablestart connectableend connectionindicator"></div><div class="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50 rounded-t-lg"><span class="text-primary"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-image" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path></svg></span><span class="text-xs font-medium truncate">صورة</span></div><div class="p-3"><img src="https://example.com/photo.jpg" alt="صورة" loading="lazy" class="w-full rounded object-cover max-h-40"/><p class="text-xs text-muted-foreground mt-1 truncate" dir="ltr">صورة</p></div><div class="border-t border-border"><a href="https://example.com/photo.jpg" class="w-full flex items-center justify-center gap-1 py-1.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" target="_blank" rel="noopener noreferrer"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download" aria-hidden="true"><path d="M12 15V3"></path><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="m7 10 5 5 5-5"></path></svg><span class="text-xs">تحميل</span></a></div><div data-handlepos="bottom" data-id="1-null-null-source" class="react-flow__handle react-flow__handle-bottom nodrag nopan !bg-primary !w-2 !h-2 source connectable connectablestart connectableend connectionindicator"></div></div>"`,
    );
  });

  it("(video) renders with its typed data — a snapshot per node type", () => {
    const html = renderNode(
      React.createElement(VideoNode, { data: { label: "فيديو", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, selected: false }),
    );
    expectNodeSnapshot(html, "dQw4w9WgXcQ");
    expect(html).toMatchInlineSnapshot(
      `"<div class="bg-card text-foreground border rounded-lg shadow min-w-[200px] max-w-[300px] border-border" data-selected="false"><div data-handlepos="top" data-id="1-null-null-target" class="react-flow__handle react-flow__handle-top nodrag nopan !bg-primary !w-2 !h-2 target connectable connectablestart connectableend connectionindicator"></div><div class="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50 rounded-t-lg"><span class="text-primary"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-play" aria-hidden="true"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"></path></svg></span><span class="text-xs font-medium truncate">فيديو</span></div><div class="p-3"><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="فيديو" class="w-full aspect-video rounded border-0" allowFullScreen=""></iframe></div><div class="border-t border-border"><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" class="w-full flex items-center justify-center gap-1 py-1.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" target="_blank" rel="noopener noreferrer"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-external-link" aria-hidden="true"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg><span class="text-xs">فتح</span></a></div><div data-handlepos="bottom" data-id="1-null-null-source" class="react-flow__handle react-flow__handle-bottom nodrag nopan !bg-primary !w-2 !h-2 source connectable connectablestart connectableend connectionindicator"></div></div>"`,
    );
  });

  it("(map) renders with its typed data — a snapshot per node type", () => {
    const html = renderNode(
      React.createElement(MapNode, { data: { label: "خريطة", geo: "51.5074,-0.1278", city: "London", country: "GB" }, selected: false }),
    );
    expectNodeSnapshot(html, "51.5074,-0.1278");
    expect(html).toMatchInlineSnapshot(
      `"<div class="bg-card text-foreground border rounded-lg shadow min-w-[200px] max-w-[300px] border-border" data-selected="false"><div data-handlepos="top" data-id="1-null-null-target" class="react-flow__handle react-flow__handle-top nodrag nopan !bg-primary !w-2 !h-2 target connectable connectablestart connectableend connectionindicator"></div><div class="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50 rounded-t-lg"><span class="text-primary"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle></svg></span><span class="text-xs font-medium truncate">خريطة</span><span class="text-xs text-muted-foreground" dir="ltr">London, GB</span></div><div class="p-3"><iframe src="https://www.openstreetmap.org/export/embed.html?bbox=-0.2278,51.407399999999996,-0.02779999999999999,51.6074&amp;layer=mapnik&amp;marker=51.5074,-0.1278" class="w-full h-32 rounded border-0" title="خريطة"></iframe><p class="text-xs text-muted-foreground mt-1 font-mono" dir="ltr">51.5074,-0.1278</p></div><div class="border-t border-border"><a href="https://www.openstreetmap.org/?mlat=51.5074&amp;mlon=-0.1278&amp;zoom=10" class="w-full flex items-center justify-center gap-1 py-1.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" target="_blank" rel="noopener noreferrer"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-external-link" aria-hidden="true"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg><span class="text-xs">فتح الخريطة</span></a></div><div data-handlepos="bottom" data-id="1-null-null-source" class="react-flow__handle react-flow__handle-bottom nodrag nopan !bg-primary !w-2 !h-2 source connectable connectablestart connectableend connectionindicator"></div></div>"`,
    );
  });

  it("(location) renders with its typed data — a snapshot per node type", () => {
    const html = renderNode(
      React.createElement(LocationNode, {
        data: { label: "موقع", loc: "AS15169", city: "Mountain View", region: "CA", country: "US", org: "Google LLC" },
        selected: false,
      }),
    );
    expectNodeSnapshot(html, "Mountain View");
    expect(html).toMatchInlineSnapshot(
      `"<div class="bg-card text-foreground border rounded-lg shadow min-w-[200px] max-w-[300px] border-border" data-selected="false"><div data-handlepos="top" data-id="1-null-null-target" class="react-flow__handle react-flow__handle-top nodrag nopan !bg-primary !w-2 !h-2 target connectable connectablestart connectableend connectionindicator"></div><div class="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50 rounded-t-lg"><span class="text-primary"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-navigation" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg></span><span class="text-xs font-medium truncate">موقع</span></div><div class="p-3"><p class="text-sm font-medium truncate" dir="ltr">Mountain View</p><p class="text-xs text-muted-foreground font-mono" dir="ltr">AS15169</p><p class="text-xs text-muted-foreground" dir="ltr">CA, US</p><p class="text-xs text-muted-foreground truncate" dir="ltr">Google LLC</p></div><div data-handlepos="bottom" data-id="1-null-null-source" class="react-flow__handle react-flow__handle-bottom nodrag nopan !bg-primary !w-2 !h-2 source connectable connectablestart connectableend connectionindicator"></div></div>"`,
    );
  });

  it("a selected node is marked through the theme tokens (no legacy palette)", () => {
    const html = renderNode(
      React.createElement(DefaultNode, { data: { label: "x", value: "x", identifierType: "domain" }, selected: true }),
    );
    expect(html).toContain("border-primary");
  });

  it("evidence references render when the data carries them (the P3-008 rule)", () => {
    const html = renderNode(
      React.createElement(TextNode, { data: { label: "نص", value: "أثر", evidenceIds: ["ev-1", "ev-2"] }, selected: false }),
    );
    expect(html).toContain('data-testid="node-evidence-refs"');
    expect(html).toContain("ev-1");
  });

  it("invalid data fails closed: an honest shell, never a half-rendered node", () => {
    const textHtml = renderNode(React.createElement(TextNode, { data: { label: "نص" } as never, selected: false }));
    expect(textHtml).toContain("بيانات عقدة غير صالحة");
    const linkHtml = renderNode(React.createElement(LinkNode, { data: { label: "رابط", url: 42 } as never, selected: false }));
    expect(linkHtml).toContain("بيانات عقدة غير صالحة");
  });

  it("P1-023 preserved: a non-YouTube video URL renders no embed (hostname gate, not substring)", () => {
    const html = renderNode(
      React.createElement(VideoNode, { data: { label: "فيديو", url: "https://evl.example.com/watch?v=abc123xyz" }, selected: false }),
    );
    expect(html).not.toMatch(/<iframe/);
  });
});

describe("parseNodeData (the typed contract, fail-closed)", () => {
  it("accepts the declared shape and keeps unknown fields out of the render", () => {
    const parsed = parseNodeData("file", { label: "ملف", name: "a.pdf", size: 5, evil: "<script>" });
    expect(parsed).toMatchObject({ label: "ملف", name: "a.pdf", size: 5 });
    expect(parsed).not.toHaveProperty("evil");
  });

  it("rejects wrong types and missing required fields with null", () => {
    // A file node's only required field is its label — name/size/mime stay optional.
    expect(parseNodeData("file", { label: 42 })).toBeNull();
    expect(parseNodeData("text", {})).toBeNull();
    expect(parseNodeData("link", { label: "x", url: 42 })).toBeNull();
    expect(parseNodeData("unknown-kind" as never, { label: "x", value: "x" })).toBeNull();
  });
});
