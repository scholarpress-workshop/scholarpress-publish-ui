import { describe, it, expect } from "bun:test";
import type { ModelMessage } from "ai";
import { pruneOldChunkResults } from "../prune-messages";

function makeChunkResult(toolCallId: string): object {
  return {
    type: "tool-result" as const,
    toolCallId,
    toolName: "get_document_chunks",
    result: { chunks: [{ index: 0, text: "some text" }] },
  };
}

function makeCommitResult(toolCallId: string): object {
  return {
    type: "tool-result" as const,
    toolCallId,
    toolName: "record_section_chunks",
    result: { ok: true, marker: "CH1" },
  };
}

function makeOtherResult(toolCallId: string): object {
  return {
    type: "tool-result" as const,
    toolCallId,
    toolName: "get_institution_spec",
    result: { yaml: "..." },
  };
}

function toolMsg(parts: object[]): ModelMessage {
  return { role: "tool" as const, content: parts } as ModelMessage;
}

describe("pruneOldChunkResults", () => {
  it("no commit → no pruning", () => {
    const msgs: ModelMessage[] = [
      toolMsg([makeChunkResult("c1")]),
      toolMsg([makeChunkResult("c2")]),
    ];
    const result = pruneOldChunkResults(msgs);
    const contents = result.map(
      (m) => (m.content as any)[0].result
    );
    expect(contents).toHaveLength(2);
    expect(contents[0]).toEqual({ chunks: [{ index: 0, text: "some text" }] });
    expect(contents[1]).toEqual({ chunks: [{ index: 0, text: "some text" }] });
  });

  it("commit present → tombstones earlier chunks", () => {
    const msgs: ModelMessage[] = [
      toolMsg([makeChunkResult("c1")]),
      toolMsg([makeChunkResult("c2")]),
      toolMsg([makeCommitResult("commit1")]),
      toolMsg([makeChunkResult("c3")]),
    ];
    const result = pruneOldChunkResults(msgs);
    const contents = result.map(
      (m) => (m.content as any)[0].result
    );
    // first two tombstones
    expect(typeof contents[0]).toBe("string");
    expect(contents[0]).toContain("Section text stored in server memory");
    expect(typeof contents[1]).toBe("string");
    // third is the commit itself (not a chunk)
    expect(contents[2]).toEqual({ ok: true, marker: "CH1" });
    // fourth is after commit — intact
    expect(contents[3]).toEqual({
      chunks: [{ index: 0, text: "some text" }],
    });
  });

  it("chunks after commit stay intact", () => {
    const msgs: ModelMessage[] = [
      toolMsg([makeCommitResult("commit1")]),
      toolMsg([makeChunkResult("c1")]),
    ];
    const result = pruneOldChunkResults(msgs);
    const contents = result.map(
      (m) => (m.content as any)[0].result
    );
    expect(contents[0]).toEqual({ ok: true, marker: "CH1" });
    expect(contents[1]).toEqual({
      chunks: [{ index: 0, text: "some text" }],
    });
  });

  it("parallel tool results preserved", () => {
    const msgs: ModelMessage[] = [
      toolMsg([makeChunkResult("c1"), makeOtherResult("o1")]),
      toolMsg([makeCommitResult("commit1")]),
    ];
    const result = pruneOldChunkResults(msgs);
    const content = result[0].content as any[];
    // chunk result tombstones
    expect(typeof content[0].result).toBe("string");
    expect(content[0].result).toContain("Section text stored");
    // other result passes through
    expect(content[1].result).toEqual({ yaml: "..." });
  });

  it("empty messages returns empty", () => {
    expect(pruneOldChunkResults([])).toEqual([]);
  });

  it("no chunk results in old messages leaves them untouched", () => {
    const msgs: ModelMessage[] = [
      toolMsg([makeOtherResult("o1")]),
      toolMsg([makeOtherResult("o2")]),
      toolMsg([makeCommitResult("commit1")]),
    ];
    const result = pruneOldChunkResults(msgs);
    const contents = result.map(
      (m) => (m.content as any)[0].result
    );
    expect(contents[0]).toEqual({ yaml: "..." });
    expect(contents[1]).toEqual({ yaml: "..." });
    expect(contents[2]).toEqual({ ok: true, marker: "CH1" });
  });
});
