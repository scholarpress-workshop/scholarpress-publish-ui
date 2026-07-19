import { describe, it, expect, mock } from "bun:test";
import { createTools, assembleDocument } from "../tools";
import {
  storeExtraction,
  storeSectionStart,
  getStoredSectionStarts,
} from "../store";
import type { StoreExtractResult } from "../store";

mock.module("../api", () => ({
  compileTypst: async (_code: string, _inst: string) =>
    new Uint8Array([37, 80, 68, 70, 45]),
  validatePdf: async () => ({
    violations: [],
    pass_count: 1,
    fail_count: 0,
    error_count: 0,
  }),
  fetchInstitutionSpec: async () => ({ raw: {}, summary: {} }),
  fetchTemplate: async () => ({ files: [], entry: "template.typ" }),
  fetchInstitutions: async () => [],
}));

function seedExtraction(sessionId: string) {
  const extraction: StoreExtractResult = {
    raw_text:
      "First paragraph.\n\nSecond paragraph.\n\nChapter 1 text.\n\nMore text.",
    headings: [{ text: "Chapter 1", level: 1, page_number: 1 }],
    page_count: 3,
    page_count_estimated: true,
    detected_fonts: ["Times New Roman"],
    markdown_text: null,
  };
  storeExtraction(sessionId, extraction);
}

describe("record_section_chunks tool", () => {
  it("stores heading text", async () => {
    const tools = createTools("tools-1");
    const result = await tools.record_section_chunks.execute({
      marker: "CH1",
      heading: "Introduction",
    });
    expect(result).toEqual({ ok: true, marker: "CH1" });
    expect(getStoredSectionStarts("tools-1")).toEqual({
      CH1: { heading: "Introduction", position: undefined },
    });
  });

  it("stores position offset", async () => {
    const tools = createTools("tools-2");
    await tools.record_section_chunks.execute({
      marker: "CH1",
      position: 1500,
    });
    expect(getStoredSectionStarts("tools-2")).toEqual({
      CH1: { heading: undefined, position: 1500 },
    });
  });

  it("accumulates multiple markers", async () => {
    const tools = createTools("tools-3");
    await tools.record_section_chunks.execute({
      marker: "CH1",
      heading: "Intro",
    });
    await tools.record_section_chunks.execute({
      marker: "ABSTRACT",
      heading: "Abstract",
    });
    expect(getStoredSectionStarts("tools-3")).toEqual({
      CH1: { heading: "Intro", position: undefined },
      ABSTRACT: { heading: "Abstract", position: undefined },
    });
  });
});

describe("build_document tool", () => {
  it("errors when no extraction stored", async () => {
    const tools = createTools("tools-noext");
    const result = await tools.build_document.execute({
      typst_structure:
        '#set page(width: 100pt, height: 100pt); "hello"',
      institutionId: "iu",
    });
    expect(result).toHaveProperty("error");
    expect((result as any).error).toContain(
      "No document has been extracted"
    );
  });

  it("reads stored section_starts when omitted", async () => {
    seedExtraction("tools-4");
    storeSectionStart("tools-4", "BODY", { heading: "Body" });

    const tools = createTools("tools-4");
    const result = await tools.build_document.execute({
      typst_structure:
        '#set page(width: 100pt, height: 100pt); {{BODY}}',
      institutionId: "iu",
    });
    expect(result).toEqual({ success: true, pdfSize: 5 });
  });

  it("prefers explicit section_starts over stored", async () => {
    seedExtraction("tools-5");
    storeSectionStart("tools-5", "BODY", { heading: "Wrong" });

    const tools = createTools("tools-5");
    const result = await tools.build_document.execute({
      typst_structure:
        '#set page(width: 100pt, height: 100pt); {{BODY}}',
      section_starts: { BODY: { heading: "Correct" } },
      institutionId: "iu",
    });
    expect(result).toEqual({ success: true, pdfSize: 5 });
  });
});

describe("assembleDocument", () => {
  it("positional slicing on raw text (PDF fallback)", () => {
    const result = assembleDocument(
      "{DED}",
      { DED: { position: 100 } },
      null,
      "0123456789 0123456789 0123456789 --- dedication text here --- rest of document goes on"
    );
    expect(result).toContain("[0123456789");
    expect(result).not.toContain("{DED}");
  });

  it("positional slicing contiguous sections", () => {
    const result = assembleDocument(
      "{A}{B}",
      { A: { position: 0 }, B: { position: 20 } },
      null,
      "aaaa aaaa aaaa aaaa bbbb bbbb bbbb bbbb"
    );
    expect(result).not.toContain("{A}");
    expect(result).not.toContain("{B}");
    expect(result).toContain("[aaaa aaaa aaaa aaaa");
  });

  it("markdown heading slicing with cmarker.render", () => {
    const md = "# DEDICATION\nFor the young people.\n\n# ACKNOWLEDGEMENTS\nMany thanks.\n";
    const result = assembleDocument(
      "{{DED}}{{ACK}}",
      { DED: { heading: "DEDICATION" }, ACK: { heading: "ACKNOWLEDGEMENTS" } },
      md,
      ""
    );
    expect(result).toContain('#cmarker.render("');
    expect(result).toContain("For the young people");
    expect(result).toContain("Many thanks");
    expect(result).not.toContain("{{DED}}");
    expect(result).not.toContain("{{ACK}}");
  });

  it("markdown duplicate heading sequential matching", () => {
    const md = "# Summary\nFirst summary.\n\n# Summary\nSecond summary.\n";
    const result = assembleDocument(
      "{{S1}}{{S2}}",
      { S1: { heading: "Summary" }, S2: { heading: "Summary" } },
      md,
      ""
    );
    expect(result).toContain("First summary");
    expect(result).toContain("Second summary");
    expect(result).not.toContain("{{S1}}");
    expect(result).not.toContain("{{S2}}");
  });

  it("unmatched markers cleaned up on template skeleton", () => {
    const md = "# INTRO\nIntro text.\n";
    const result = assembleDocument(
      "{{INTRO}}{{MISSING}}",
      { INTRO: { heading: "INTRO" } },
      md,
      ""
    );
    expect(result).not.toContain("{{MISSING}}");
    expect(result).toContain("[]");
    expect(result).toContain("#cmarker.render");
  });

  it("cleanup regex does not match user content after substitution", () => {
    const md = "# A\nhas {X_1} in it.\n\n# B\nhas {Y_2} in it.\n";
    const result = assembleDocument(
      "{{A}}{{B}}",
      { A: { heading: "A" }, B: { heading: "B" } },
      md,
      ""
    );
    expect(result).toContain("{Y_2}");
    expect(result).toContain("{X_1}");
    expect(result).not.toContain("{{A}}");
    expect(result).not.toContain("{{B}}");
  });

  it("NaN position skipped in positional mode", () => {
    const result = assembleDocument(
      "{A}",
      { A: { position: NaN } },
      null,
      "some document text"
    );
    expect(result).toContain("[]");
    expect(result).not.toContain("{A}");
  });

  it("empty markdownText falls back to positional", () => {
    const result = assembleDocument(
      "{A}",
      { A: { position: 0 } },
      "",
      "raw text content"
    );
    expect(result).toContain("[raw text content]");
    expect(result).not.toContain("{A}");
  });
});
