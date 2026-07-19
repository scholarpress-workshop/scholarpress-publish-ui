# Agent Instructions Rewrite — Two-Phase Structure Inference to Autonomous Assembly

**Goal:** Replace the monolithic section-by-section verification workflow with a two-phase design: Phase 1 has three structure checkpoints for user confirmation; Phase 2 autonomously assembles the document without further user interaction.

**Architecture:** Phase 1 (interactive) splits into three checkpoints — Front Matter, Chapters, End Matter — each confirmed by the user before advancing. Phase 2 (autonomous) calls `record_section_chunks` for every confirmed section in a tight loop, then `build_document` + `validate_pdf`. PDF extraction is removed from the upload step; DOCX only. PDF is used exclusively for validation after Typst compilation.

**Tech Stack:** TypeScript system prompt rewrite (`src/app/api/chat/route.ts`), minor file-upload type change (`src/components/file-upload.tsx`).

## Design

### Phase 1 — Structure Inference (Three Checkpoints)

**Checkpoint A: Front Matter & Pre-Chapter Sections**

1. Agent calls `extract_document` → displays headings and page count
2. Agent loads spec via `get_institution_spec` and template via `get_template` (silent)
3. Agent infers ALL front matter variables: title, author, degree, department, school, campus, month, year, committee (name + degree + role per member), defense date
4. Agent infers optional pre-chapter sections: copyright year, dedication text, acknowledgements, preface, abstract. For each: heading text, chunk range.
5. Agent calls `record_section_chunks` for each confirmed front matter / pre-chapter section
6. **Pause — ask user to confirm: (a) variables correct? (b) pre-chapter section headings and chunk ranges correct?**

**Checkpoint B: Chapters**

1. Agent calls `get_document_chunks` to browse the document, discovering chapter headings and their nested sub-headings/sub-sub-headings
2. Agent infers the complete chapter hierarchy (Chapter N → N.1 → N.1.1, etc.)
3. Agent infers heading text, level, and chunk range for each chapter and sub-section
4. **Pause — display the inferred chapter tree and ask user to confirm. "Is this the correct chapter and sub-heading structure?"**

**Checkpoint C: End Matter**

1. Agent calls `get_document_chunks` to discover end-matter sections
2. Agent infers: appendices (with label and title), references, curriculum vitae. For each: heading text, chunk range.
3. Agent calls `record_section_chunks` for each confirmed end-matter section
4. **Pause — ask user to confirm: "Are these end-matter sections correct? Any missing appendices?"**

### Phase 2 — Autonomous Assembly

1. Agent calls `record_section_chunks(marker, heading)` for ALL confirmed sections (front matter, chapters, sub-sections, end matter) — **no user pauses**
2. Agent constructs the complete `typst_structure` string using `{{MARKER}}` double-brace placeholders for body text, and literal values for short variables (title, author, dates, committee)
3. Agent calls `build_document` with `typst_structure` (no `section_starts` map — backend reads from recorded state)
4. Agent calls `validate_pdf`
5. If violations: fix ONE issue at a time, re-build, re-validate
6. When automated checks pass → move to Phase D

### Phase D — Human-Review Checks

Unchanged from current. Walk through human-review checks one at a time. Present check, explain what to look for, ask for confirmation, record.

### PDF Removal

- `file-upload.tsx`: accept `.docx` only. Remove `.pdf` from `accept` attribute and `validTypes`.
- `chat-panel.tsx`: update any matching type checks.
- System prompt: instructions say "Upload your dissertation as a .docx file." Never mention PDF.
- Backend: `/extract` still handles PDFs (backward compat). Agent just never routes users to PDF upload.

### Syntax Rules (Updated)

```
- Template markers use {{MARKER}} (double braces). Single braces { } are Typst code block syntax.
- Short fields go inline as Typst string literals: title: "My Title", author: "Jane Doe".
- Body text goes through {{MARKER}} placeholders. The backend substitutes exact section text.
- Reuse template values directly from the spec — do not recalculate constants.
- Keep function calls on one line. Close all parentheses, brackets, and braces.
```

## Files Changed

| File | Change |
|------|--------|
| `src/app/api/chat/route.ts` | Complete rewrite of `buildSystemPrompt` return text |
| `src/components/file-upload.tsx` | Remove PDF from accepted types |
| `src/components/chat-panel.tsx` | Match file-upload type changes |
