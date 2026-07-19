# Markdown Heading-String Section Slicing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert DOCX to markdown on extraction, then slice sections from markdown by heading-string regex instead of raw_text character positions, wrapping each section in `#cmarker.render(...)` for Typst compilation.

**Architecture:** Two repos. Backend (`scholarpress-backend`): `anytomd-rs` converts DOCX to markdown, stored as `markdown_text: Option<String>` on `ParsedDocument`. Frontend (`scholarpress-publish-ui`): `record_section_chunks` stores heading text or position offset; `assembleDocument` regex-finds headings in markdown with sequential lastIndex for duplicates; single-pass `.replace()` substitutes `#cmarker.render("escaped markdown")` for each `{{MARKER}}`.

**Tech Stack:** Rust (anytomd-rs, sp-extract), TypeScript (Next.js 15, Vercel AI SDK, split/join, regex), Markdown + cmarker Typst package.

## Global Constraints

- Backend: `markdown_text` is `Option<String>` — `null` in JSON for PDFs
- Frontend: `record_section_chunks` accepts EITHER `heading: string` (DOCX) OR `position: number` (PDF)
- Templates: change `{MARKER}` → `{{MARKER}}` (double braces) to avoid Typst code block collision
- `escapeForTypstString` must NOT escape markdown syntax (`#`, `*`, `_`, `[`, `]`)
- Regex uses `mig` flags, `lastIndex` for sequential matching, ReDoS-safe prefix patterns
- Backend workspace: `/home/danriggi/scholarpress-workshop/scholarpress-backend/`
- Frontend workspace: `/home/danriggi/scholarpress-workshop/scholarpress-publish-ui/`

---

## Part A: Backend (Rust)

### Task A1: Add markdown conversion to DOCX extraction

**Files:**
- Modify: `scholarpress-backend/crates/sp-extract/Cargo.toml`
- Modify: `scholarpress-backend/crates/sp-extract/src/document.rs`
- Modify: `scholarpress-backend/crates/sp-extract/src/docx.rs`
- Modify: `scholarpress-backend/crates/sp-extract/src/pdf.rs`

**Interfaces:**
- Produces: `ParsedDocument.markdown_text: Option<String>`, serialized as JSON field

- [ ] **Step 1: Add `anytomd-rs` dependency**

In `crates/sp-extract/Cargo.toml`, add under `[dependencies]`:

```toml
anytomd = "0.1"
```

- [ ] **Step 2: Add `markdown_text` field to `ParsedDocument`**

In `crates/sp-extract/src/document.rs`, add to the `ParsedDocument` struct (after `metadata`):

```rust
    pub markdown_text: Option<String>,
```

- [ ] **Step 3: Convert DOCX to markdown in extraction**

In `crates/sp-extract/src/docx.rs`, in `extract_docx`, after reading the zip archive and before constructing the `ParsedDocument`, write the zip bytes to a temp file and call anytomd:

```rust
    let markdown_text = {
        let tmp = std::env::temp_dir().join(format!("scholarpress-docx-{}.docx", uuid::Uuid::new_v4()));
        std::fs::write(&tmp, bytes)?;
        let md = anytomd::convert(&tmp).unwrap_or_else(|e| {
            tracing::warn!(error = %e, "anytomd conversion failed, falling back to None");
            String::new()
        });
        std::fs::remove_file(&tmp).ok();
        if md.is_empty() { None } else { Some(md) }
    };
```

Add `use std::io::Read;` at the top if not already present. Add `uuid` to `Cargo.toml` dependencies if not already present. Alternatively, use a deterministic temp path based on a hash of the bytes.

Add `markdown_text` to the `ParsedDocument` constructor:

```rust
    Ok(ParsedDocument {
        raw_text: raw_text.clone(),
        pages: vec![ParsedPage { ... }],
        paragraphs,
        headings: Vec::new(),
        markdown_text,
        metadata: ParsedMetadata { ... },
    })
```

- [ ] **Step 4: Set `markdown_text: None` for PDFs**

In `crates/sp-extract/src/pdf.rs`, in `extract_pdf`, add to the `ParsedDocument` constructor:

```rust
    Ok(ParsedDocument {
        raw_text,
        pages,
        paragraphs: all_paragraphs,
        headings: Vec::new(),
        markdown_text: None,
        metadata: ParsedMetadata { ... },
    })
```

- [ ] **Step 5: Verify compilation**

```bash
cd /home/danriggi/scholarpress-workshop/scholarpress-backend
cargo check -p sp-extract
```

Expected: compiles without errors.

- [ ] **Step 6: Commit and push**

```bash
git add crates/sp-extract/
git commit -m "feat(sp-extract): convert DOCX to markdown via anytomd-rs, store as markdown_text"
git push
```

---

## Part B: Frontend (TypeScript)

### Task B1: Add `markdown_text` to type contracts

**Files:**
- Modify: `scholarpress-publish-ui/src/lib/store.ts`
- Modify: `scholarpress-publish-ui/src/lib/api.ts`
- Modify: `scholarpress-publish-ui/src/components/chat-panel.tsx`

- [ ] **Step 1: Add to `StoreExtractResult`**

In `src/lib/store.ts`, in the `StoreExtractResult` interface, add after `detected_fonts`:

```typescript
  markdown_text: string | null;
```

- [ ] **Step 2: Add to `ExtractResult`**

In `src/lib/api.ts`, in the `ExtractResult` interface, add after `detected_fonts`:

```typescript
  markdown_text: string | null;
```

- [ ] **Step 3: Pass `markdown_text` to `/api/state`**

In `src/components/chat-panel.tsx`, in the `handleFileSelected` function (around line 137), add to the extraction object:

```typescript
            extraction: {
              raw_text: text,
              headings: result.headings,
              page_count: result.metadata.page_count,
              page_count_estimated: result.metadata.page_count_estimated,
              detected_fonts: result.metadata.detected_fonts,
              markdown_text: result.markdown_text,
            },
```

- [ ] **Step 4: Verify compilation**

```bash
cd /home/danriggi/scholarpress-workshop/scholarpress-publish-ui
bun run build
```

Expected: builds without errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.ts src/lib/api.ts src/components/chat-panel.tsx
git commit -m "feat: add markdown_text field to extraction types and state storage"
```

---

### Task B2: Rewrite `record_section_chunks` and `assembleDocument`

**Files:**
- Modify: `scholarpress-publish-ui/src/lib/tools.ts`

- [ ] **Step 1: Rewrite `recordSectionChunksTool`**

Replace the existing tool with dual-mode schema:

```typescript
  const recordSectionChunksTool = tool({
    description:
      "Commit section boundaries after user confirmation. Pass heading text for DOCX markdown slicing, or position offset for PDF positional slicing.",
    inputSchema: z.object({
      marker: z.string().describe("The marker name, e.g. 'CH1', 'ABSTRACT'"),
      heading: z
        .string()
        .optional()
        .describe("Heading text (for DOCX/Markdown slicing)"),
      position: z
        .number()
        .optional()
        .describe("Character offset (for PDF positional slicing)"),
    }),
    execute: async ({ marker, heading, position }) => {
      storeSectionStart(sessionId, marker, { heading, position } as any);
      return { ok: true, marker };
    },
  });
```

- [ ] **Step 2: Update `storeSectionStart` to accept object**

In `src/lib/store.ts`, change `storeSectionStart` to store `{ heading?, position? }` instead of just `number`:

```typescript
export function storeSectionStart(
  sessionId: string,
  marker: string,
  value: { heading?: string; position?: number }
) {
  const state = getOrCreate(sessionId);
  if (!state.sectionStarts) state.sectionStarts = {};
  state.sectionStarts[marker] = value as any;
}
```

And update `sectionStarts` type in `SessionState`:

```typescript
  sectionStarts: Record<string, { heading?: string; position?: number }>;
```

And `getState` returns it as-is.

- [ ] **Step 3: Rewrite `assembleDocument`**

Replace the existing `assembleDocument` export with the production-ready version from the spec. Key elements:

- `escapeForTypstString` (call before adding text, only escapes string delimiters)
- If `markdownText` is null/empty → fall back to `positionalSlice` using `.position` values
- Sequential regex matching with `headingSearchIndices` map
- Single-pass `.replace()` with `markerContent` Map
- Double-brace `{{MARKER}}` template syntax

Full code (paste from the spec, 70 lines).

- [ ] **Step 4: Update `buildDocumentTool`**

Change `section_starts` to `section_starts` and update the `getStoredSectionStarts` call. Update `execute` to pass `markdown_text` from the extraction:

```typescript
    execute: async ({ typst_structure, section_starts, institutionId }) => {
      const extraction = getStoredExtraction(sessionId);
      if (!extraction) { /* existing error */ }

      const starts = section_starts ?? getStoredSectionStarts(sessionId);

      const assembled = assembleDocument(
        typst_structure,
        starts,
        extraction.markdown_text,
        extraction.raw_text
      );
      // ... rest unchanged
    },
```

- [ ] **Step 5: Add `escapeForTypstString` function**

Add the function above `assembleDocument` in `tools.ts`:

```typescript
function escapeForTypstString(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, (c) =>
      `\\u{${c.charCodeAt(0).toString(16)}}`);
}
```

- [ ] **Step 6: Verify compilation and existing tests**

```bash
bun run build
bun test
```

Expected: builds without errors. Existing 26 tests pass. Any type mismatches from `sectionStarts` type change in store.ts should be caught here.

- [ ] **Step 7: Commit**

```bash
git add src/lib/store.ts src/lib/tools.ts
git commit -m "feat: heading-string-based section slicing from markdown with cmarker.render"
```

---

### Task B3: System prompt update

**Files:**
- Modify: `scholarpress-publish-ui/src/app/api/chat/route.ts`

- [ ] **Step 1: Update prompt**

Find the line containing "After the user confirms a section" and replace with:

```
After the user confirms a section is correct, call record_section_chunks immediately with the marker name and heading text (for DOCX) or position offset (for PDF).
```

- [ ] **Step 2: Verify compilation**

```bash
bun run build
```

Expected: builds without errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: update prompt for dual-mode record_section_chunks (heading or position)"
```

---

### Task B4: Test updates

**Files:**
- Modify: `scholarpress-publish-ui/src/lib/__tests__/store.test.ts`
- Modify: `scholarpress-publish-ui/src/lib/__tests__/tools.test.ts`

- [ ] **Step 1: Update store tests**

`sectionStarts` now stores `{ heading?, position? }` objects instead of bare numbers. Update tests:

```typescript
import { describe, it, expect } from "bun:test";
import { storeSectionStart, getStoredSectionStarts } from "../store";

describe("storeSectionStart / getStoredSectionStarts", () => {
  it("stores and retrieves heading text", () => {
    storeSectionStart("s1", "CH1", { heading: "Introduction" });
    expect(getStoredSectionStarts("s1")).toEqual({ CH1: { heading: "Introduction" } });
  });

  it("stores and retrieves position offset", () => {
    storeSectionStart("s1", "CH1", { position: 1500 });
    expect(getStoredSectionStarts("s1")).toEqual({ CH1: { position: 1500 } });
  });

  it("returns empty for unknown session", () => {
    expect(getStoredSectionStarts("nonexistent")).toEqual({});
  });
});
```

- [ ] **Step 2: Update tools test for `record_section_chunks`**

Update calls from `{ marker, char_start: 1500 }` to `{ marker, heading: "Chapter 1" }` or `{ marker, position: 1500 }`.

- [ ] **Step 3: Add `assembleDocument` markdown-slicing tests**

Add tests for:
- Heading found, section sliced with `#cmarker.render(...)` wrapper
- PDF fallback when `markdownText` is null
- Duplicate heading sequential matching
- Empty `markdownText` delegates to positional slicing
- Escape function preserves markdown syntax
- Single-pass replacement prevents template injection

- [ ] **Step 4: Run tests**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/__tests__/
git commit -m "test: update store/tools/assembleDocument tests for markdown heading slicing"
```

---

### Task B5: Integration verification

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
