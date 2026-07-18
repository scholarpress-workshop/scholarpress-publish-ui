# Positional Text Slicing for Section Substitution — Design Spec

**Goal:** Replace chunk-index-based text assembly with positional slicing so `build_document` extracts exact section text from `raw_text` at heading boundaries, eliminating chunk overlap contamination.

**Problem:** `record_section_chunks` stores chunk indices (e.g., `[0]`), but chunks are 5K-character slices that don't align with section boundaries. When `build_document` re-fetches chunk text via `getChunksFromText(indices)`, it pulls the entire chunk — including text from adjacent sections. For example, chunk 0 contains title page → committee → copyright → dedication. Recording `{ DEDICATION: [0] }` causes the dedication marker to render with all of chunk 0's content.

**Root Cause:** The `get_document_chunks` tool already computes the heading's absolute character position in `raw_text` (line 85: `const pos = extraction.raw_text.indexOf(match.text)`), but discards it before returning results to the LLM. The builder has no way to extract the exact section text — it only knows which coarse-grained chunk held the heading.

**Architecture:** Surface the heading position from `get_document_chunks` as `char_start`. `record_section_chunks` stores this position instead of chunk indices. `assembleDocument` uses positional slicing: for each section marker, extract `raw_text[start_A .. start_B]` where `start_B` is the next section's start position (or end-of-document for the last section).

**Tech Stack:** TypeScript (server-side tool implementations), existing in-memory `Map<string, SessionState>`.

## Design

### 1. `get_document_chunks` — return `char_start` in heading

The tool already computes `pos = extraction.raw_text.indexOf(match.text)` at line 85 to find which chunk contains the heading. Add `char_start: pos` to the returned heading object:

```typescript
// In the heading-return block (line 101-105), add char_start:
heading: {
  text: match.text,
  level: match.level,
  page_number: match.page_number,
  char_start: pos,  // NEW: absolute character position in raw_text
},
```

The agent receives this alongside `chunks`, `start_index`, etc. No new computation.

### 2. `record_section_chunks` — store `char_start` instead of `indices`

Change the tool from chunk indices to a single integer position:

```typescript
inputSchema: z.object({
  marker: z.string().describe("The {MARKER} name, e.g. 'CH1', 'ABSTRACT'"),
  char_start: z
    .number()
    .describe("The char_start value from the get_document_chunks heading result for this section"),
}),
execute: async ({ marker, char_start }) => {
  storeSectionStart(sessionId, marker, char_start);
  return { ok: true, marker };
},
```

### 3. `SessionState` and `store.ts` — change `sectionChunks` type

Change from `Record<string, number[]>` to `Record<string, number>`:

```typescript
// SessionState field:
sectionStarts: Record<string, number>;

// New exports (replace storeSectionChunks / getStoredSectionChunks):
export function storeSectionStart(sessionId: string, marker: string, char_start: number) {
  const state = getOrCreate(sessionId);
  if (!state.sectionStarts) state.sectionStarts = {};
  state.sectionStarts[marker] = char_start;
}

export function getStoredSectionStarts(sessionId: string): Record<string, number> {
  return store.get(sessionId)?.sectionStarts ?? {};
}
```

### 4. `assembleDocument` — positional slicing

Replace the chunk-index-based lookup with positional slicing. Sort all section starts, then slice `raw_text` between adjacent positions:

```typescript
function assembleDocument(
  typstStructure: string,
  sectionStarts: Record<string, number>,
  rawText: string
): string {
  // 1. Filter orphans and invalid positions BEFORE sorting
  const validSections: Array<[string, number]> = [];
  for (const [marker, pos] of Object.entries(sectionStarts)) {
    if (!typstStructure.includes(`{${marker}}`)) {
      console.warn(`[assembleDocument] orphaned section: ${marker} (no marker in template)`);
      continue; // skip sorting — prevents text-stealing from adjacent sections
    }
    const parsedPos = Number(pos);
    if (isNaN(parsedPos) || parsedPos < 0) {
      continue; // skip invalid positions
    }
    const safePos = Math.min(parsedPos, rawText.length);
    validSections.push([marker, safePos]);
  }

  // 2. Stable sort by position, then marker name
  validSections.sort((a, b) => {
    const pd = a[1] - b[1];
    return pd !== 0 ? pd : a[0].localeCompare(b[0]);
  });

  let result = typstStructure;

  // 3. Clean up unmatched placeholders FIRST — on the template skeleton,
  //    not on substituted content (avoids matching user text after substitution)
  const validMarkers = new Set(validSections.map((s) => s[0]));
  result = result.replace(/\{([A-Z0-9_]+)\}/g, (_match, name) =>
    validMarkers.has(name) ? _match : "[]"
  );

  // 4. Slice and substitute
  for (let i = 0; i < validSections.length; i++) {
    const [marker, pos] = validSections[i];
    const startPos = i === 0 ? 0 : pos;
    const nextPos = i + 1 < validSections.length ? validSections[i + 1][1] : rawText.length;
    const text = rawText.slice(startPos, nextPos);
    const escaped = escapeTypstText(text);
    result = result.split(`{${marker}}`).join(`[${escaped}]`);
  }

  return result;
}
```

The marker order from the LLM's `typst_structure` is irrelevant — sections are sliced in document order by their absolute character position. If the agent records `{ CH1: 5000, CH2: 12000, DEDICATION: 800 }`, the builder processes them as: dedication (800..5000), chapter 1 (5000..12000), chapter 2 (12000..end).

### 5. `build_document` — update signature

Change from `section_chunks: Record<string, number[]>` (optional) to `section_starts: Record<string, number>` (optional):

```typescript
inputSchema: z.object({
  typst_structure: z.string(),
  section_starts: z.record(z.number()).optional()
    .describe("Optional. If omitted, uses previously recorded section_starts from record_section_chunks calls."),
  institutionId: z.string(),
}),
execute: async ({ typst_structure, section_starts, institutionId }) => {
  const starts = section_starts ?? getStoredSectionStarts(sessionId);
  const assembled = assembleDocument(typst_structure, starts, extraction.raw_text);
  // ... rest unchanged
},
```

### 6. System Prompt — update instruction

Change the Phase B closing instruction from:

```
After the user confirms a section is correct, call record_section_chunks immediately with the marker name and confirmed chunk indices.
```

to:

```
After the user confirms a section is correct, call record_section_chunks immediately with the marker name and the char_start value from the get_document_chunks heading result.
```

### 7. Message Pruning — update `get_document_chunks` result tombstoning

The pruning logic in `prune-messages.ts` tombstones only `get_document_chunks` results. After this change, those results carry `char_start` in the heading, which is an integer — the tombstoning logic is unchanged since it operates on `part.toolName === "get_document_chunks"` not on the result content.

## Key Properties

- **Agent operates in chunk space during verification.** It sees chunks, presents previews, confirms with user. It never interprets or computes character positions — it just passes `char_start` through from the tool result.
- **Agent never touches raw text.** The builder extracts `raw_text[start..end]` entirely server-side. The LLM's output contains only marker names and integer positions.
- **Exact boundaries.** Sections are sliced at their detected heading position, not at arbitrary chunk boundaries. DEDICATION → `raw_text[1500..1680]` gives exactly the verified 180 characters.
- **No overlapping content.** Each section's text range is exclusive — end of one section is the start of the next.
- **Document-order processing.** Builder sorts by position regardless of order in `typst_structure`.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/store.ts` | Replace `sectionChunks: Record<string, number[]>` with `sectionStarts: Record<string, number>`. Replace `storeSectionChunks`/`getStoredSectionChunks` with `storeSectionStart`/`getStoredSectionStarts`. |
| `src/lib/tools.ts` | Add `char_start` to `get_document_chunks` heading return. Change `record_section_chunks` from `indices: number[]` to `char_start: number`. Change `build_document` from `section_chunks` to `section_starts`. Rewrite `assembleDocument` for positional slicing. Remove `getChunksFromText`. |
| `src/app/api/chat/route.ts` | Update prompt: `record_section_chunks` takes `char_start` from heading result. |
| `src/lib/prune-messages.ts` | No changes needed. |

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Agent records wrong `char_start` | The value comes verbatim from the heading field of a `get_document_chunks` result the agent just received. If the heading lookup was correct, the position is correct. |
| Section order changes in raw text between tool calls | Raw text is immutable after extraction. Positions are stable for the session lifetime. |
| First section includes pre-heading text (title page, blank lines) | Covered by the LLM's front matter inference in Phase A. The builder will include `raw_text[0..first_heading]` if a marker exists for the front matter section, or skip it if no marker is recorded. |
| Last section content overflow | The last section extends to `raw_text.length` — all remaining text is included. Sections are always recorded in document order, so the last recorded section gets everything from its heading to EOF. |
| Missing sections leave gaps | If the agent skips a section, the gap text falls into the previous recorded section (since positions are sorted). The user sees this during Phase B verification and can flag it. |
| Orphaned markers (section stored but not in typst_structure) | `console.warn` logged; text is silently dropped from output rather than corrupting the document. |
| Implementation ordering breaks compilation | `store.ts` and `tools.ts` type changes must be committed atomically (same commit). System prompt update committed alongside or after tool schema changes — never before. |

## Second Peer Review Corrections

### 1. Pre-first-section text capture

The first section's `pos` may not be 0. Override it explicitly:

```typescript
const startPos = i === 0 ? 0 : safePos;
```

### 2. Out-of-bounds position clamp

Guard against NaN, negative, or oversized positions:

```typescript
const safePos = Math.min(Math.max(0, pos), rawText.length);
```

### 3. Stable sort for identical positions

Two sections at the same position (duplicate headings) could produce unstable ordering. Sort by position, then marker name:

```typescript
const sorted = Object.entries(starts).sort((a, b) => {
  const pd = a[1] - b[1];
  return pd !== 0 ? pd : a[0].localeCompare(b[0]);
});
```

### 4. Orphaned section warning

If a section start is recorded but no `{MARKER}` exists in `typst_structure`, the text would be silently dropped. Add a warning to catch this:

```typescript
for (const [marker] of sorted) {
  if (!typstStructure.includes(`{${marker}}`)) {
    console.warn(`orphaned section: ${marker}`);
  }
}
```

### 5. Additional tests from second review

| Test | Description |
|------|-------------|
| Pre-first-section text preserved | First section at pos 150 → output includes `raw_text[0..150]` |
| NaN/negative/beyond-length position | All clamped to safe range |
| Identical positions → stable ordering | Two markers at same position sorted by name |
| Orphaned section logged | Section start stored but not in typst_structure → warn, no output corruption |


## Peer Review Corrections

### 1. Immutable string bug

`result.replace(...)` returns a new string, does not mutate. Fix:

```typescript
result = result.replace(regex, () => `[${escaped}]`);
```

### 2. JavaScript replace pattern injection

`$&`, `$'`, `$$` etc. in the replacement string are interpreted as special patterns, corrupting text containing currency symbols or backreference-like sequences. Use a replacer function:

```typescript
result = result.replace(`{${marker}}`, () => `[${escapeTypstText(text)}]`);
```

### 3. Negative position from failed indexOf

If `indexOf(match.text)` returns `-1` (heading not found in raw text), storing that as `char_start` produces `rawText.slice(-1, ...)` which slices from the end. Validate:

```typescript
// In get_document_chunks execute():
const pos = extraction.raw_text.indexOf(match.text);
if (pos === -1) {
  return { error: "Heading not found in document text." };
}
// heading.char_start = pos;  // guaranteed >= 0
```

### 4. Pre-first-section text

Text before `sorted[0][1]` (position of first recorded section) is discarded unless explicitly handled. If the agent records a front-matter section at position 0 (which it should for title/acceptance pages), this is covered. If no section starts at position 0, the first section's range is implicitly `[0..next_pos]`, capturing everything.

### 5. Additional tests

| Test | Description |
|------|-------------|
| `assembleDocument` with `$` and `$$` in text | Verify no pattern injection — output contains literal `$` |
| Missing intermediate section | Verify gap text is appended to preceding section, not silently dropped |
| `char_start` of `-1` rejected | Tool returns error, not corrupted position |
| All sections recorded, verify contiguous output | End-to-end positional slicing produces complete document |

## Third Peer Review Corrections

### 1. Orphaned sections steal adjacent text (Critical)

Previous code sorted ALL sections, then warned about orphans *after* replacement. This meant orphaned sections still participated in position-sorting boundaries, causing adjacent sections to lose text. Fix: filter orphans **before** sorting so they don't affect position calculations.

### 2. `split().join()` instead of regex

Markers with regex-sensitive characters (`$`, `+`, `?`) would cause `new RegExp(...)` to throw or produce unexpected matches. Use `result.split(`{${marker}}`).join(...)` which performs literal string replacement and is immune to regex injection.

### 3. Zero-length slices no longer skipped

Removed the `if (text.length === 0) continue;` guard. Empty sections must still replace `{MARKER}` with `[]` (empty content block) to prevent template placeholder leaks.

### 4. NaN/negative positions filtered before sort

`Number(pos)` validation ensures non-finite values are skipped, preventing `NaN` from propagating into the sort comparator.

### 5. Updated test coverage

| Test | Description |
|------|-------------|
| Orphaned section does not steal text | Section A recorded but not in template → Section B gets correct text range |
| Empty section produces `[]` in output | Zero-length slice → marker replaced with empty content block, not left as raw `{MARKER}` |
| Marker with `$` character | `{CH_$1}` marker → no regex error, correct substitution |
| NaN position skipped | NaN `char_start` → section excluded from output, no crash |

## Fourth Peer Review Correction

### Unmatched placeholder cleanup

If `{MARKER}` exists in `typstStructure` but no corresponding section was recorded (agent missed it, or position was invalid), the placeholder leaks into the compiled Typst document, causing a compilation error. Add a final cleanup pass after all substitutions:

```typescript
result = result.replace(/\{[A-Z0-9_]+\}/g, "[]");
```

This replaces any remaining `{UPPERCASE_OR_NUMBER}` markers with an empty Typst content block `[]`.

## Fifth Peer Review Correction

### Cleanup regex matching user content

The regex `\{[A-Z0-9_]+\}` at the end of the function would match placeholder-looking text inside already-substituted document content (e.g., `[some text with {X_1} notation]`), potentially erasing valid user text. Fix: run the cleanup **before** the substitution loop, on the template skeleton only. Use a `Set` of valid marker names to determine which placeholders to keep vs. replace:

```typescript
const validMarkers = new Set(validSections.map(s => s[0]));
result = result.replace(/\{([A-Z0-9_]+)\}/g, (_match, name) =>
  validMarkers.has(name) ? _match : "[]"
);
```

This ensures:
- Markers with matching sections (`{CH1}`, `{DEDICATION}`) are left in place for the subsequent `split().join()` substitution
- Markers without matching sections (`{MISSING}`) are replaced with `[]` on the template skeleton
- Already-substituted document content (inside `[...]`) is never scanned by this regex



