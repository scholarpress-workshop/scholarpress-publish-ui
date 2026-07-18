# Positional Text Slicing for Section Substitution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace chunk-index-based text assembly with positional slicing so `build_document` extracts exact section text at heading boundaries, eliminating chunk overlap contamination.

**Architecture:** `get_document_chunks` surfaces the heading's absolute character position (`char_start`). `record_section_chunks` stores it. `assembleDocument` sorts all starts by position, filters orphans, cleans unmatched placeholders on the template skeleton, then slices `raw_text[start_A..start_B]` for each section using `split/join` for safe literal replacement.

**Tech Stack:** TypeScript (Next.js 15 API route, Vercel AI SDK), in-memory `Map<string, SessionState>`.

## Global Constraints

- `store.ts` and `tools.ts` type changes MUST be committed atomically (same commit) to avoid compilation breakage
- System prompt update committed alongside tool schema changes — never before
- Agent never touches raw text; builder extracts server-side
- `split().join()` for all marker substitution (no regex on marker names)
- Cleanup regex runs on template skeleton BEFORE substitution loop
- Workspace root: `/home/danriggi/scholarpress-workshop/scholarpress-publish-ui/`

---

### Task 1: Store type migration — `sectionChunks` → `sectionStarts`

**Files:**
- Modify: `src/lib/store.ts`

**Interfaces:**
- Consumes: existing `SessionState` with `sectionChunks: Record<string, number[]>`
- Produces: `sectionStarts: Record<string, number>`, `storeSectionStart(sessionId, marker, char_start)`, `getStoredSectionStarts(sessionId)`

- [ ] **Step 1: Replace `sectionChunks` with `sectionStarts` in SessionState**

In `src/lib/store.ts`, change the `SessionState` interface (around line 57):

```typescript
  sectionStarts: Record<string, number>;
```

In `getOrCreate` (around line 77), change:

```typescript
      sectionChunks: {},
```

to:

```typescript
      sectionStarts: {},
```

- [ ] **Step 2: Replace store/get functions**

Replace `storeSectionChunks`/`getStoredSectionChunks` (lines 110-124) with:

```typescript
export function storeSectionStart(
  sessionId: string,
  marker: string,
  char_start: number
) {
  const state = getOrCreate(sessionId);
  if (!state.sectionStarts) state.sectionStarts = {};
  state.sectionStarts[marker] = char_start;
}

export function getStoredSectionStarts(
  sessionId: string
): Record<string, number> {
  return store.get(sessionId)?.sectionStarts ?? {};
}
```

- [ ] **Step 3: Update `getState` return**

In `getState` (around line 151), change:

```typescript
    sectionChunks: state.sectionChunks,
```

to:

```typescript
    sectionStarts: state.sectionStarts,
```

- [ ] **Step 4: Verify compilation fails (Task 2 needed)**

```bash
cd /home/danriggi/scholarpress-workshop/scholarpress-publish-ui && bun run build 2>&1 | grep "error"
```

Expected: TypeScript errors in `tools.ts` — references to removed `storeSectionChunks` and `sectionChunks`. This is expected; Task 2 resolves them.

---

### Task 2: Tool rewrites — `get_document_chunks`, `record_section_chunks`, `build_document`, `assembleDocument`

**Files:**
- Modify: `src/lib/tools.ts`

**Interfaces:**
- Consumes: `storeSectionStart`, `getStoredSectionStarts` from Task 1
- Produces: `char_start` in heading return, `record_section_chunks` with `char_start` param, `build_document` with optional `section_starts`, new `assembleDocument`

- [ ] **Step 1: Update imports**

In `src/lib/tools.ts` line 4, change:

```typescript
import { storePdf, storeViolations, getPdf, getStoredExtraction, storeSectionChunks, getStoredSectionChunks } from "./store";
```

to:

```typescript
import { storePdf, storeViolations, getPdf, getStoredExtraction, storeSectionStart, getStoredSectionStarts } from "./store";
```

- [ ] **Step 2: Add `char_start` to `get_document_chunks` heading return**

In the heading-return block (around line 100-105), add `char_start: pos`:

```typescript
          heading: {
            text: match.text,
            level: match.level,
            page_number: match.page_number,
            char_start: pos,
          },
```

- [ ] **Step 3: Rewrite `recordSectionChunksTool`**

Replace the existing tool (lines 291-306) with:

```typescript
  const recordSectionChunksTool = tool({
    description:
      "Commit a section's starting character position after user confirmation. Stores server-side so build_document can slice the exact text. Use the char_start value from the get_document_chunks heading result.",
    inputSchema: z.object({
      marker: z
        .string()
        .describe("The {MARKER} name, e.g. 'CH1', 'ABSTRACT'"),
      char_start: z
        .number()
        .describe("The char_start value from the get_document_chunks heading result for this section"),
    }),
    execute: async ({ marker, char_start }) => {
      storeSectionStart(sessionId, marker, char_start);
      return { ok: true, marker };
    },
  });
```

- [ ] **Step 4: Update `buildDocumentTool` schema**

Change the `section_chunks` field (around line 250) to:

```typescript
      section_starts: z
        .record(z.number())
        .optional()
        .describe(
          "Optional. If omitted, uses previously recorded section_starts from record_section_chunks calls."
        ),
```

Change the execute function (around line 259) from `section_chunks` to `section_starts`:

```typescript
    execute: async ({ typst_structure, section_starts, institutionId }) => {
      const extraction = getStoredExtraction(sessionId);
      if (!extraction) {
        return {
          error:
            "No document has been extracted yet. Ask the student to upload their dissertation file first.",
        };
      }

      const starts = section_starts ?? getStoredSectionStarts(sessionId);

      const assembled = assembleDocument(
        typst_structure,
        starts,
        extraction.raw_text
      );
```

- [ ] **Step 5: Rewrite `assembleDocument`**

Replace the existing `assembleDocument` function (lines 389-404) and remove `getChunksFromText` (lines 364-387) with:

```typescript
function assembleDocument(
  typstStructure: string,
  sectionStarts: Record<string, number>,
  rawText: string
): string {
  const validSections: Array<[string, number]> = [];
  for (const [marker, pos] of Object.entries(sectionStarts)) {
    if (!typstStructure.includes(`{${marker}}`)) {
      console.warn(
        `[assembleDocument] orphaned section: ${marker} (no marker in template)`
      );
      continue;
    }
    const parsedPos = Number(pos);
    if (isNaN(parsedPos) || parsedPos < 0) continue;
    validSections.push([marker, Math.min(parsedPos, rawText.length)]);
  }

  validSections.sort((a, b) => {
    const pd = a[1] - b[1];
    return pd !== 0 ? pd : a[0].localeCompare(b[0]);
  });

  const validMarkers = new Set(validSections.map((s) => s[0]));
  let result = typstStructure.replace(
    /\{([A-Z0-9_]+)\}/g,
    (_match, name) => (validMarkers.has(name) ? _match : "[]")
  );

  for (let i = 0; i < validSections.length; i++) {
    const [marker, pos] = validSections[i];
    const startPos = i === 0 ? 0 : pos;
    const nextPos =
      i + 1 < validSections.length
        ? validSections[i + 1][1]
        : rawText.length;
    const text = rawText.slice(startPos, nextPos);
    const escaped = escapeTypstText(text);
    result = result.split(`{${marker}}`).join(`[${escaped}]`);
  }

  return result;
}
```

- [ ] **Step 6: Verify compilation**

```bash
cd /home/danriggi/scholarpress-workshop/scholarpress-publish-ui && bun run build
```

Expected: builds without errors.

- [ ] **Step 7: Commit (atomic with Task 1)**

```bash
git add src/lib/store.ts src/lib/tools.ts
git commit -m "feat: positional text slicing — char_start from headings replaces chunk indices for section assembly"
```

---

### Task 3: System prompt update

**Files:**
- Modify: `src/app/api/chat/route.ts`

**Interfaces:**
- Consumes: existing Phase B instructions
- Produces: updated instruction for `record_section_chunks` with `char_start`

- [ ] **Step 1: Update the Phase B instruction**

In `src/app/api/chat/route.ts`, find the line:

```
After the user confirms a section is correct, call record_section_chunks immediately with the marker name and confirmed chunk indices.
```

Replace with:

```
After the user confirms a section is correct, call record_section_chunks immediately with the marker name and the char_start value from the get_document_chunks heading result.
```

- [ ] **Step 2: Verify compilation**

```bash
bun run build
```

Expected: builds without errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: update prompt for record_section_chunks — char_start instead of chunk indices"
```

---

### Task 4: Test updates

**Files:**
- Modify: `src/lib/__tests__/store.test.ts`
- Modify: `src/lib/__tests__/tools.test.ts`

- [ ] **Step 1: Update store tests**

Replace all `storeSectionChunks` calls with `storeSectionStart` and `getStoredSectionChunks` with `getStoredSectionStarts`. The values change from `number[]` to `number`.

In `src/lib/__tests__/store.test.ts`, replace the import and all test bodies:

```typescript
import { describe, it, expect } from "bun:test";
import { storeSectionStart, getStoredSectionStarts } from "../store";

describe("storeSectionStart / getStoredSectionStarts", () => {
  it("stores and retrieves a single marker", () => {
    storeSectionStart("s1", "CH1", 1500);
    expect(getStoredSectionStarts("s1")).toEqual({ CH1: 1500 });
  });

  it("accumulates multiple markers", () => {
    storeSectionStart("s2", "CH1", 1500);
    storeSectionStart("s2", "ABSTRACT", 800);
    expect(getStoredSectionStarts("s2")).toEqual({
      CH1: 1500,
      ABSTRACT: 800,
    });
  });

  it("returns empty object for unknown session", () => {
    expect(getStoredSectionStarts("nonexistent")).toEqual({});
  });

  it("overwrites marker on second call", () => {
    storeSectionStart("s3", "CH1", 1500);
    storeSectionStart("s3", "CH1", 1600);
    expect(getStoredSectionStarts("s3")).toEqual({ CH1: 1600 });
  });

  it("does not collide across sessions", () => {
    storeSectionStart("sa", "CH1", 1500);
    storeSectionStart("sb", "CH1", 3000);
    expect(getStoredSectionStarts("sa")).toEqual({ CH1: 1500 });
    expect(getStoredSectionStarts("sb")).toEqual({ CH1: 3000 });
  });
});
```

- [ ] **Step 2: Update tools tests**

In `src/lib/__tests__/tools.test.ts`, update the import to use `storeSectionStart` and update all `record_section_chunks` calls to use `char_start: number` instead of `indices: number[]`.

Replace the import line:

```typescript
import {
  storeExtraction,
  storeSectionStart,
  getStoredSectionStarts,
} from "../store";
```

Update `record_section_chunks` test calls from `indices: [1, 2]` to `char_start: 1500`:

```typescript
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
```

Update `buildDocumentTool` tests — replace `storeSectionChunks` with `storeSectionStart` and `section_chunks` with `section_starts`:

```typescript
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
```

- [ ] **Step 3: Add `assembleDocument` unit tests**

In a new block at the bottom of `tools.test.ts` (or a new test file), add tests for the extracted `assembleDocument` function. These test the slicing logic directly without mocking:

```typescript
// assembleDocument is not currently exported. For testing, either:
// a) Export it from tools.ts, or
// b) Inline these tests in tools.ts's test module where assembleDocument is in scope.
//
// If exporting, add to tools.ts:
//   export function assembleDocument(...) { ... }

import { describe, it, expect } from "bun:test";

// NOTE: assembleDocument must be exported from tools.ts for these tests.
// Add `export` keyword before `function assembleDocument` in tools.ts.
import { assembleDocument } from "../tools";

function dummyEscape(text: string): string {
  return text.replace(/\\/g, "\\\\");
}

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
    // ORPHAN is filtered — its text falls into A
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
    // Template with BOTH a valid marker A and an unmatched marker {X_1}
    // After substitution, the [escaped content] for A should NOT lose {X_1} from its text
    const result = assembleDocument(
      "{A}{B}",
      { A: 0, B: 50 },
      "text with {X_1} in it --- another part with {Y_2} stuff"
    );
    // B gets the second half containing {Y_2}
    expect(result).toContain("{Y_2}");
    // A gets the first half containing {X_1}
    expect(result).toContain("{X_1}");
    // No leftover markers
    expect(result).not.toContain("{A}");
    expect(result).not.toContain("{B}");
  });

  it("empty sections replaced with []", () => {
    const result = assembleDocument(
      "{A}",
      { A: 0 },
      ""
    );
    expect(result).toContain("[]");
  });

  it("NaN position skipped", () => {
    const result = assembleDocument(
      "{A}",
      { A: NaN },
      "some document text"
    );
    // A skipped, unmatched cleanup replaces {A} with []
    expect(result).toContain("[]");
    expect(result).not.toContain("{A}");
  });

  it("sorts by position regardless of recording order", () => {
    const result = assembleDocument(
      "{A}{B}",
      { B: 20, A: 0 },
      "aaaa aaaa aaaa aaaa bbbb bbbb bbbb bbbb"
    );
    // A (pos 0) should come before B (pos 20) despite being recorded second
    expect(result).toContain("[aaaa aaaa aaaa aaaa");
    expect(result).toContain("[bbbb bbbb bbbb bbbb");
  });
});
```

- [ ] **Step 4: Export `assembleDocument` from tools.ts**

Add `export` before the function declaration in `tools.ts`:

```typescript
export function assembleDocument(
```

- [ ] **Step 5: Run tests**

```bash
cd /home/danriggi/scholarpress-workshop/scholarpress-publish-ui && bun test
```

Expected: all tests pass (previous 19 + new assembleDocument tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/__tests__/store.test.ts src/lib/__tests__/tools.test.ts src/lib/tools.ts
git commit -m "test: update store/tool tests for positional slicing; add assembleDocument unit tests"
```

---

### Task 5: Integration verification

**Files:**
- None (runtime verification)

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 2: Run full build**

```bash
bun run build
```

Expected: builds without errors.

- [ ] **Step 3: Push**

```bash
git push
```
