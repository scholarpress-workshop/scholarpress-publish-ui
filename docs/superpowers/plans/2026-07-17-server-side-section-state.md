# Server-Side Section State with Context Pruning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent LLM context window exhaustion by storing confirmed section chunk indices server-side and pruning stale chunk text from conversation history after each `record_section_chunks` commit.

**Architecture:** Add a `sectionChunks` accumulator to the in-memory `SessionState`. A new `record_section_chunks` tool stashes indices after user confirmation. `build_document` reads the accumulated map from state. The route handler prunes old `get_document_chunks` tool results from the message array, anchored at the most recent `record_section_chunks` commit.

**Tech Stack:** TypeScript, Next.js 15 API route, Vercel AI SDK (`convertToModelMessages`, `streamText`), `Map<string, SessionState>`.

## Global Constraints

- All changes are server-side TypeScript in `scholarpress-publish-ui/`
- No new npm dependencies
- Message pruning uses `.map()` on `msg.content` arrays to preserve parallel tool results
- `record_section_chunks` commits are the anchor for pruning — everything AFTER the most recent commit is preserved
- Workspace root: `/home/danriggi/scholarpress-workshop/scholarpress-publish-ui/`

---

### Task 1: SessionState — add `sectionChunks` accumulator

**Files:**
- Modify: `src/lib/store.ts`

**Interfaces:**
- Consumes: existing `SessionState` interface, `getOrCreate` function
- Produces: `storeSectionChunks(sessionId, marker, indices)` and `getStoredSectionChunks(sessionId)` exports; `sectionChunks` field on `SessionState`

- [ ] **Step 1: Add `sectionChunks` field and new exports**

In `src/lib/store.ts`, add `sectionChunks` to the `SessionState` interface (line 56):

```typescript
  violations: Array<{
    check_id: string;
    status: string;
    detail: string;
    evidence: Array<{ page: number }>;
  }>;
  passCount: number;
  failCount: number;
  sectionChunks: Record<string, number[]>;
}
```

Initialize in `getOrCreate` (lines 72-78), add `sectionChunks: {},` after `failCount: 0,`.

Add two new exports after `getStoredExtraction` (after line 102):

```typescript
export function storeSectionChunks(
  sessionId: string,
  marker: string,
  indices: number[]
) {
  const state = getOrCreate(sessionId);
  if (!state.sectionChunks) state.sectionChunks = {};
  state.sectionChunks[marker] = indices;
}

export function getStoredSectionChunks(
  sessionId: string
): Record<string, number[]> {
  return store.get(sessionId)?.sectionChunks ?? {};
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd /home/danriggi/scholarpress-workshop/scholarpress-publish-ui
bun run build
```

Expected: builds without errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/store.ts
git commit -m "feat: add sectionChunks accumulator to session state with store/get exports"
```

---

### Task 2: tools.ts — new `record_section_chunks` tool, optional `section_chunks` in `build_document`

**Files:**
- Modify: `src/lib/tools.ts`

**Interfaces:**
- Consumes: `storeSectionChunks`, `getStoredSectionChunks` from Task 1
- Produces: `record_section_chunks` tool in `createTools` return, modified `build_document` with optional `section_chunks`

- [ ] **Step 1: Add import at top of `tools.ts`**

Add to the existing import from `./store`:

```typescript
import { storePdf, storeViolations, getPdf, getStoredExtraction, storeSectionChunks, getStoredSectionChunks } from "./store";
```

- [ ] **Step 2: Add `record_section_chunks` tool**

Insert before `return { extract_document:` (around line 288):

```typescript
  const recordSectionChunksTool = tool({
    description:
      "Commit chunk indices for a section after user confirms. Stores server-side so build_document can read them without you tracking them in context.",
    inputSchema: z.object({
      marker: z.string().describe("The {MARKER} name, e.g. 'CH1', 'ABSTRACT'"),
      indices: z.array(z.number()).describe("Confirmed chunk indices for this section"),
    }),
    execute: async ({ marker, indices }) => {
      storeSectionChunks(sessionId, marker, indices);
      return { ok: true, marker };
    },
  });
```

- [ ] **Step 3: Make `build_document` `section_chunks` optional**

Change the `inputSchema` for `buildDocumentTool` (lines 250-254):

```typescript
      section_chunks: z
        .record(z.array(z.number()))
        .optional()
        .describe(
          "Optional. If omitted, uses previously recorded section_chunks from record_section_chunks calls."
        ),
```

Change the `execute` function (line 259) to add the fallback:

```typescript
    execute: async ({ typst_structure, section_chunks, institutionId }) => {
      const extraction = getStoredExtraction(sessionId);
      if (!extraction) {
        return {
          error:
            "No document has been extracted yet. Ask the student to upload their dissertation file first.",
        };
      }

      const chunks = section_chunks ?? getStoredSectionChunks(sessionId);

      const assembled = assembleDocument(
        typst_structure,
        chunks,
        extraction.raw_text
      );
```

- [ ] **Step 4: Add `record_section_chunks` to the return object**

In the `return {` block (around line 288), add:

```typescript
    record_section_chunks: recordSectionChunksTool,
```

- [ ] **Step 5: Verify compilation**

```bash
bun run build
```

Expected: builds without errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tools.ts
git commit -m "feat: record_section_chunks tool, build_document reads section chunks from state"
```

---

### Task 3: route.ts — message pruning and prompt update

**Files:**
- Modify: `src/app/api/chat/route.ts`

**Interfaces:**
- Consumes: existing POST handler structure, existing system prompt
- Produces: state-aware message pruning before `streamText`, prompt instruction for `record_section_chunks`

- [ ] **Step 1: Add message pruning in POST handler**

After `const coreMessages = await convertToModelMessages(messages);` (around line 108) and before `const result = streamText(...)` (around line 109), insert:

```typescript
  const coreMessages = await convertToModelMessages(messages);

  const lastCommitIndex = coreMessages.findLastIndex(
    (msg) =>
      msg.role === "tool" &&
      Array.isArray(msg.content) &&
      msg.content.some(
        (part) =>
          part.type === "tool-result" &&
          part.toolName === "record_section_chunks"
      )
  );

  if (lastCommitIndex !== -1) {
    for (let i = 0; i < lastCommitIndex; i++) {
      const msg = coreMessages[i];
      if (msg.role === "tool" && Array.isArray(msg.content)) {
        const cleaned = msg.content.map((part) => {
          if (
            part.type === "tool-result" &&
            part.toolName === "get_document_chunks"
          ) {
            return {
              ...part,
              result:
                "[Section text stored in server memory — use record_section_chunks marker indices]",
            };
          }
          return part;
        });
        coreMessages[i] = { ...msg, content: cleaned } as typeof msg;
      }
    }
  }

  const result = streamText({
```

- [ ] **Step 2: Add prompt instruction for `record_section_chunks`**

In the system prompt (Phase B instructions, around line 85), add after the per-section verification steps:

```
After the user confirms a section is correct, call record_section_chunks immediately with the marker name and confirmed chunk indices.
```

- [ ] **Step 3: Add new tool names to the tool listing line**

In the system prompt (around line 55), update:

```
You have access to eight tools: extract_document, get_document_chunks, get_institution_spec, get_template, build_document, compile_typst, validate_pdf, and record_section_chunks.
```

- [ ] **Step 4: Verify compilation**

```bash
bun run build
```

Expected: builds without errors.

- [ ] **Step 5: Commit and push**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: state-aware message pruning for old chunk results; prompt update for record_section_chunks"
git push
```

---

### Task 4: Integration verification

**Files:**
- (none — runtime verification)

**Interfaces:**
- Verifies: the full pipeline builds and the Docker image is deployable

- [ ] **Step 1: Run full build**

```bash
bun run build
```

Expected: builds without errors.

- [ ] **Step 2: Verify route.ts compiles in strict mode**

Check that no TypeScript errors exist for the message pruning block. The `as typeof msg` cast on `coreMessages[i]` should satisfy the type checker.

- [ ] **Step 3: Docker build**

```bash
docker build -t scholarpress-ui-test .
```

Expected: builds successfully.

- [ ] **Step 4: Push**

```bash
git push
```
