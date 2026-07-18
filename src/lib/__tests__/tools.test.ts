import { describe, it, expect, mock } from "bun:test";
import { createTools } from "../tools";
import {
  storeExtraction,
  storeSectionChunks,
  getStoredSectionChunks,
} from "../store";
import type { StoreExtractResult } from "../store";

// Mock the API module
mock.module("../api", () => ({
  compileTypst: async (_code: string, _inst: string) =>
    new Uint8Array([37, 80, 68, 70, 45]), // "%PDF-" header
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
      indices: [1, 2],
    });
    expect(result).toEqual({ ok: true, marker: "CH1" });
  });

  it("persists to session state", async () => {
    const tools = createTools("tools-2");
    await tools.record_section_chunks.execute({
      marker: "CH1",
      indices: [5, 6, 7],
    });
    expect(getStoredSectionChunks("tools-2")).toEqual({
      CH1: [5, 6, 7],
    });
  });

  it("accumulates multiple markers", async () => {
    const tools = createTools("tools-3");
    await tools.record_section_chunks.execute({
      marker: "CH1",
      indices: [1],
    });
    await tools.record_section_chunks.execute({
      marker: "ABSTRACT",
      indices: [3, 4],
    });
    expect(getStoredSectionChunks("tools-3")).toEqual({
      CH1: [1],
      ABSTRACT: [3, 4],
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

  it("reads stored section_chunks when omitted", async () => {
    seedExtraction("tools-4");
    storeSectionChunks("tools-4", "BODY", [0]);

    const tools = createTools("tools-4");
    const result = await tools.build_document.execute({
      typst_structure:
        '#set page(width: 100pt, height: 100pt); "test"',
      institutionId: "iu",
    });
    expect(result).toEqual({ success: true, pdfSize: 5 });
  });

  it("prefers explicit section_chunks over stored", async () => {
    seedExtraction("tools-5");
    storeSectionChunks("tools-5", "BODY", [99]);

    const tools = createTools("tools-5");
    const result = await tools.build_document.execute({
      typst_structure:
        '#set page(width: 100pt, height: 100pt); "test"',
      section_chunks: { BODY: [0] },
      institutionId: "iu",
    });
    expect(result).toEqual({ success: true, pdfSize: 5 });
  });

  it("bracket validation catches unclosed braces", async () => {
    seedExtraction("tools-6");
    storeSectionChunks("tools-6", "BODY", [0]);

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
