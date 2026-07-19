# Heading-String-Based Section Slicing from Markdown — Design Spec

**Goal:** Replace positional text slicing with heading-string-based matching so `build_document` searches `markdown_text` by section heading, extracts exact sections, and wraps them in `cmarker.render()` for Typst compilation.

**Architecture:** Two-pass flow. Pass 1 (agent): structure inference using chunked raw_text — unchanged from current system. Pass 2 (builder): DOCX → markdown conversion via `anytomd-rs`; agent records `{marker, heading}` pairs; builder regex-finds headings in markdown, slices between adjacent headings, substitutes via single-pass `.replace()`.

**Tech Stack:** Rust (sp-extract, anytomd-rs), TypeScript (Next.js 15, Vercel AI SDK), Markdown + cmarker Typst package.

## Design

### Backend Changes

1. Add `anytomd-rs` to `sp-extract` dependencies
2. In `extract_docx`, after reading the zip: write bytes to temp file, call `anytomd::convert(temp_path)`, produce `markdown_text: Some(string)`
3. `extract_pdf` sets `markdown_text: None`
4. `ParsedDocument` gains `pub markdown_text: Option<String>` (serialized as null in JSON when None)

### Frontend Types

- `StoreExtractResult` gains `markdown_text: string | null`
- `ExtractResult` in `api.ts` gains `markdown_text: string | null`
- `chat-panel.tsx` passes `markdown_text` to `/api/state`

### System Prompt

```
After the user confirms a section is correct, call record_section_chunks immediately with the marker name and heading text (for DOCX) or position offset (for PDF).
```

### Template Format

Change markers from `{MARKER}` to `{{MARKER}}` (double braces). Single braces `{...}` are valid Typst syntax for code blocks and dictionaries — double braces prevent collision.

### record_section_chunks Schema (Dual Mode)

```typescript
inputSchema: z.object({
  marker: z.string().describe("The {{MARKER}} name"),
  heading: z.string().optional().describe("Heading text for DOCX markdown slicing"),
  position: z.number().optional().describe("Character offset for PDF positional slicing"),
}),
```

### assembleDocument

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

function assembleDocument(
  typstStructure: string,
  sectionStarts: Record<string, any>,
  markdownText: string | null | undefined,
  rawText: string
): string {
  const useMarkdown = markdownText && markdownText.length > 0;

  if (!useMarkdown) {
    // PDF fallback: positional slicing on rawText
    return positionalSlice(typstStructure, sectionStarts, rawText);
  }

  // DOCX: regex-find headings sequentially in markdown
  const valid: Array<[string, number]> = [];
  const headingSearchIndices = new Map<string, number>();

  for (const [marker, item] of Object.entries(sectionStarts)) {
    const heading = item && typeof item === "object" ? item.heading : item;
    if (typeof heading !== "string" || heading.trim() === "") continue;

    const escaped = heading.trim()
      .replace(/[.*+?^${}()|\[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");

    const fmt = "(?:\\*\\*\\*|___|\\*\\*|__|\\*|_)?";

    // Numbered/lettered outline prefix: 1., (1), A-, IV., 1.2.3, etc.
    // ReDoS-safe — mandatory separators for sub-parts
    const prefix = "(?:\\(?(?:\\d+(?:[-.]\\d+)*|[A-Za-z]\\d*(?:[-.]\\d+)*|[IVXLCDMivxlcdm]+)\\)?[.:-]?\\s+)?";

    const pattern = `^#+\\s+${fmt}${prefix}${fmt}${escaped}${fmt}\\s*#*\\s*$`;
    const re = new RegExp(pattern, "mig");

    const searchKey = heading.trim().toLowerCase();
    const startIndex = headingSearchIndices.get(searchKey) || 0;
    re.lastIndex = startIndex;

    const match = re.exec(markdownText);
    if (!match) {
      console.warn("heading not found in markdown: " + heading);
      continue;
    }

    valid.push([marker, match.index]);
    headingSearchIndices.set(searchKey, match.index + match[0].length);
  }

  valid.sort((a, b) => a[1] - b[1]);

  // Single-pass replacement
  const markerContent = new Map<string, string>();
  for (let i = 0; i < valid.length; i++) {
    const [marker, pos] = valid[i];
    const nextPos = i + 1 < valid.length ? valid[i + 1][1] : markdownText.length;
    const text = markdownText.slice(pos, nextPos);
    markerContent.set(marker, escapeForTypstString(text));
  }

  return typstStructure.replace(
    /\{\{([a-zA-Z0-9_]+)\}\}/g,
    (_match, name) => {
      if (markerContent.has(name)) {
        return `#cmarker.render("${markerContent.get(name)}")`;
      }
      return "[]";
    }
  );
}
```

## Key Properties

- **Regex anchored to line start after `#`** — no false positives from body text
- **Sequential matching with `lastIndex`** — handles duplicate heading titles
- **Single-pass `.replace()`** — prevents template injection from section content
- **`escapeForTypstString`** — only escapes string delimiters/control chars, preserves markdown syntax for cmarker
- **Double braces `{{MARKER}}`** — avoids collision with Typst code block syntax
- **PDF fallback** — positional slicing on rawText when markdownText is null
- **ReDoS-safe** — mandatory separators in sub-patterns, O(N) linear matching

## Files Changed

| File | Change |
|------|--------|
| `crates/sp-extract/Cargo.toml` | Add `anytomd-rs` |
| `crates/sp-extract/src/document.rs` | Add `markdown_text: Option<String>` to `ParsedDocument` |
| `crates/sp-extract/src/docx.rs` | Call `anytomd::convert` after extraction |
| `crates/sp-extract/src/pdf.rs` | Set `markdown_text: None` |
| `src/lib/store.ts` | Add `markdown_text` to `StoreExtractResult` |
| `src/lib/api.ts` | Add `markdown_text` to `ExtractResult` |
| `src/components/chat-panel.tsx` | Pass `markdown_text` to `/api/state` |
| `src/lib/tools.ts` | Rewrite `record_section_chunks`, `assembleDocument`, `buildDocumentTool` |
| `src/app/api/chat/route.ts` | Update system prompt |
| `institutions/*/template/**/*.typ` | Change `{MARKER}` → `{{MARKER}}` |
| Tests | Update store, tools, and pruning tests |

## Peer Review History

24 issues resolved across 8 review rounds: heading prefix preservation, duplicate heading handling, false positive prevention, PDF fallback, proper anytomd archive usage, double-escaping fix, sequential duplicate matching, inline heading formatting, outline numbering, case-insensitive cleanup, preamble exclusion, cmarker quote wrapping, regex formatting placement, parentheses in prefix, curly brace collision, whitespace normalization, sequence ordering, word boundary → line-end anchor, regex performance optimization, null type guard, CJK/punctuation boundary fix, plain-word-as-prefix fix, global flag duplicate handling, recursive replacement injection fix, prefix syntax error, boolean type guard, triple formatting support, ReDoS O(N²)→O(N), case-insensitive search state, symmetrical parentheses support, empty heading guard.
