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
  };
  storeExtraction(sessionId, extraction);
}

describe("record_section_chunks tool", () => {
  it("returns ok with marker", async () => {
    const tools = createTools("tools-1");
    const result = await tools.record_section_chunks.execute({
      marker: "CH1",
      char_start: 1500,
    });
    expect(result).toEqual({ ok: true, marker: "CH1" });
  });

  it("persists to session state", async () => {
    const tools = createTools("tools-2");
    await tools.record_section_chunks.execute({
      marker: "CH1",
      char_start: 1500,
    });
    expect(getStoredSectionStarts("tools-2")).toEqual({
      CH1: 1500,
    });
  });

  it("accumulates multiple markers", async () => {
    const tools = createTools("tools-3");
    await tools.record_section_chunks.execute({
      marker: "CH1",
      char_start: 1500,
    });
    await tools.record_section_chunks.execute({
      marker: "ABSTRACT",
      char_start: 800,
    });
    expect(getStoredSectionStarts("tools-3")).toEqual({
      CH1: 1500,
      ABSTRACT: 800,
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
    storeSectionStart("tools-4", "BODY", 0);

    const tools = createTools("tools-4");
    const result = await tools.build_document.execute({
      typst_structure:
        '#set page(width: 100pt, height: 100pt); {BODY}',
      institutionId: "iu",
    });
    expect(result).toEqual({ success: true, pdfSize: 5 });
  });

  it("prefers explicit section_starts over stored", async () => {
    seedExtraction("tools-5");
    storeSectionStart("tools-5", "BODY", 99);

    const tools = createTools("tools-5");
    const result = await tools.build_document.execute({
      typst_structure:
        '#set page(width: 100pt, height: 100pt); {BODY}',
      section_starts: { BODY: 0 },
      institutionId: "iu",
    });
    expect(result).toEqual({ success: true, pdfSize: 5 });
  });

  it("bracket validation catches unclosed braces", async () => {
    seedExtraction("tools-6");
    storeSectionStart("tools-6", "BODY", 0);

    const tools = createTools("tools-6");
    const result = await tools.build_document.execute({
      typst_structure:
        '#set page(width: 100pt, height: 100pt); {BODY',
      institutionId: "iu",
    });
    expect(result).toHaveProperty("error");
    expect((result as any).error).toContain("Bracket balance");
  });
});

describe("assembleDocument", () => {
  it("first section includes pre-heading text (startPos=0)", () => {
    const result = assembleDocument(
      "{DED}",
      { DED: 100 },
      "0123456789 0123456789 0123456789 --- dedication text here --- rest of document goes on"
    );
    expect(result).toContain("[0123456789");
    expect(result).not.toContain("{DED}");
  });

  it("sections are sliced at boundaries (contiguous)", () => {
    const result = assembleDocument(
      "{A}{B}",
      { A: 0, B: 20 },
      "aaaa aaaa aaaa aaaa bbbb bbbb bbbb bbbb"
    );
    expect(result).not.toContain("{A}");
    expect(result).not.toContain("{B}");
    expect(result).toContain("[aaaa aaaa aaaa aaaa");
    expect(result).toContain("[bbbb bbbb bbbb bbbb");
  });

  it("orphaned sections are filtered before sorting", () => {
    const result = assembleDocument(
      "{A}",
      { A: 0, ORPHAN: 100 },
      "content for section A then more text"
    );
    expect(result).toContain("[content for section A then more text]");
    expect(result).not.toContain("{ORPHAN}");
    expect(result).not.toContain("{A}");
  });

  it("unmatched markers cleaned up on template skeleton", () => {
    const result = assembleDocument(
      "{A}{MISSING}",
      { A: 0 },
      "just section A content"
    );
    expect(result).not.toContain("{MISSING}");
    expect(result).toContain("[]");
    expect(result).toContain("[just section A content]");
  });

  it("cleanup regex does not match user content after substitution", () => {
    const result = assembleDocument(
      "{A}{B}",
      { A: 0, B: 50 },
      "text with {X_1} in it --- another part with {Y_2} stuff"
    );
    expect(result).toContain("{Y_2}");
    expect(result).toContain("{X_1}");
    expect(result).not.toContain("{A}");
    expect(result).not.toContain("{B}");
  });

  it("empty sections replaced with []", () => {
    const result = assembleDocument("{A}", { A: 0 }, "");
    expect(result).toContain("[]");
  });

  it("NaN position skipped", () => {
    const result = assembleDocument(
      "{A}",
      { A: NaN },
      "some document text"
    );
    expect(result).toContain("[]");
    expect(result).not.toContain("{A}");
  });

  it("sorts by position regardless of recording order", () => {
    const result = assembleDocument(
      "{A}{B}",
      { B: 20, A: 0 },
      "aaaa aaaa aaaa aaaa bbbb bbbb bbbb bbbb"
    );
    expect(result).toContain("[aaaa aaaa aaaa aaaa");
    expect(result).toContain("[bbbb bbbb bbbb bbbb");
  });
});
