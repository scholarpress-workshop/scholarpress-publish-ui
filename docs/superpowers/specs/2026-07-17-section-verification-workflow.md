# Section-by-Section Verification Workflow — Design Spec

**Goal:** Replace the monolithic fire-and-forget document assembly with a structured section-by-section verification loop that catches extraction errors before they propagate into the compiled PDF.

**Architecture:** No code changes. The existing tools (`get_document_chunks` with heading lookup, `build_document` with markers) already support iterative section discovery. The fix is a system prompt rewrite that instructs the LLM to verify each section with the user before building the full document.

**Tech Stack:** Next.js 15 API route (system prompt text), Vercel AI SDK (`streamText`), existing Typst template system.

## Design

### Phase A: Establish Facts

The agent loads the document and presentation layer facts first. User confirms before any section assembly begins.

1. **Extract document** — call `extract_document`. Present headings, page count, detected fonts.
2. **Pause — ask user to confirm.** "Do these headings and page count look correct?"
3. **Load spec + template** — call `get_institution_spec` then `get_template` (silent).
4. **Infer front matter** from heading metadata + first chunk of relevant pages. Present ALL inferred variables in a table: title, author, degree, department, school, campus, month, year, committee members with roles. Include optional fields (copyright year, dedication text) if detected.
5. **Pause — ask user to verify or correct.** "Are these front matter values correct? Edit any that are wrong."

### Phase B: Section-by-Section Verification

For each section in document structure order (front matter → body → end matter), the agent iterates one at a time. Chapters share `sections/chapters.typ` but EACH chapter gets individual verification.

**For each section:**

1. Call `get_document_chunks` with `heading: "<section name>"` to locate the section.
2. Display:
   - **Heading text** (as detected)
   - **Template file** being used (e.g., `sections/chapters.typ`)
   - **Chunk index range** (start_index + count returned by tool)
   - **Page number** if available
   - **Content preview**:
     - If total chars in returned chunks ≤ **500**: show full text
     - If total chars > 500: show first **200** chars + `...` + last **200** chars
3. **Pause — ask user: correct?** Three verification points:
   - Is the heading text correct?
   - Does the content start at the right place?
   - Does the content end at the right place?
4. If user says yes → record chunk indices for `section_chunks` map, move to next section.
5. If user says no → adjust heading query or chunk indices based on user feedback, re-verify.

**Special handling for chapters:** Despite all chapters using `sections/chapters.typ`, verify each one individually. A 5-chapter dissertation gets 5 separate verification turns. Mark `first: true` only on Chapter 1.

### Phase C: Build and Validate

After all sections are verified and the `section_chunks` map is complete:

1. Call `build_document` once with the confirmed markers. Use inferred/verified front matter as literal values, body text as markers.
2. Call `validate_pdf`.
3. If violations exist → fix ONE issue at a time, re-build, re-validate.
4. When all automatable checks pass → move to Phase D.

### Phase D: Human-Review Checks

Walk through each human-review check one at a time. Present the check description, what to look for, ask for confirmation. Record response. Move to next check.

After all checks pass: tell the student the document is ready.

## Key Rules

- **Pause after every user-facing step.** Never batch multiple "ask user" interactions into one message.
- **Never skip verification.** Even if section detection looks perfect, show the preview.
- **Chapters are individual entities.** They share one template file but each gets a separate verification turn with its own start/end preview.
- **Content threshold: 500 chars.** Under this threshold, show full text. Over it, show first 200 + last 200 chars.
- **Front matter preview:** Abstract body text gets the same ≤500/first200-last200 treatment as chapters. Short fields (title, author, dates) are just checked as literal values.
- **Optional sections:** If the document has content for a section (dedication, preface, appendices, CV), verify it. If absent, skip it without asking.

## Files Changed

- **Modify:** `src/app/api/chat/route.ts` — replace the `buildSystemPrompt` function's WORKFLOW section (lines 67–77)

No other files touched. No new tools, no new API endpoints, no new components.
