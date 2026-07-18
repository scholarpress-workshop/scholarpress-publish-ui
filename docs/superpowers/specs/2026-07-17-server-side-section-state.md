# Server-Side Section State with Context Pruning — Design Spec

**Goal:** Prevent context window exhaustion during section-by-section verification by storing confirmed chunk indices server-side and pruning stale chunk text from the LLM's conversation history.

**Architecture:** Three tool changes + message pruning in the route handler. The LLM calls `record_section_chunks` after each user-confirmed section to stash indices in `SessionState`. `build_document` reads the accumulated map from state instead of requiring the LLM to carry it. A state-aware pruning pass strips old `get_document_chunks` tool results from the conversation history, anchored at the most recent `record_section_chunks` commit.

**Tech Stack:** TypeScript (Next.js 15 API route), Vercel AI SDK (`streamText`, `convertToModelMessages`), in-memory `Map<string, SessionState>`.

## Design

### 1. SessionState Extension (`src/lib/store.ts`)

Add `sectionChunks` to the `SessionState` interface:

```typescript
sectionChunks: Record<string, number[]>;
```

Initialize to `{}` in `getOrCreate()`.

Two new exports:

```typescript
export function storeSectionChunks(sessionId: string, marker: string, indices: number[]) {
  const state = getOrCreate(sessionId);
  if (!state.sectionChunks) state.sectionChunks = {};
  state.sectionChunks[marker] = indices;
}

export function getStoredSectionChunks(sessionId: string): Record<string, number[]> {
  return store.get(sessionId)?.sectionChunks ?? {};
}
```

### 2. New Tool: `record_section_chunks` (`src/lib/tools.ts`)

Added to `createTools(sessionId)`:

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

### 3. Modified Tool: `build_document` (`src/lib/tools.ts`)

`section_chunks` becomes optional. Falls back to accumulated session state:

```typescript
inputSchema: z.object({
  typst_structure: z.string(),
  section_chunks: z.record(z.array(z.number())).optional(),
  institutionId: z.string(),
}),
execute: async ({ typst_structure, section_chunks, institutionId }) => {
  const chunks = section_chunks ?? getStoredSectionChunks(sessionId);
  // rest unchanged
},
```

### 4. State-Aware Message Pruning (`src/app/api/chat/route.ts`)

In the POST handler, after `convertToModelMessages(messages)` and before `streamText`:

```typescript
const coreMessages = await convertToModelMessages(messages);

// Prune old get_document_chunks results that were committed via record_section_chunks.
// Everything AFTER the most recent commit stays intact (current section).
const lastCommitIndex = coreMessages.findLastIndex(msg =>
  msg.role === "tool" &&
  Array.isArray(msg.content) &&
  msg.content.some(part => part.type === "tool-result" && part.toolName === "record_section_chunks")
);

if (lastCommitIndex !== -1) {
  for (let i = 0; i < lastCommitIndex; i++) {
    const msg = coreMessages[i];
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      const cleaned = msg.content.map(part => {
        if (part.type === "tool-result" && part.toolName === "get_document_chunks") {
          return {
            ...part,
            result: "[Section text stored in server memory — use record_section_chunks marker indices]",
          };
        }
        return part;
      });
      coreMessages[i] = { ...msg, content: cleaned } as typeof msg;
    }
  }
}
```

**Key properties:**
- **Protects active work**: All `get_document_chunks` calls AFTER the most recent commit stay fully intact. The LLM can make multiple chunk reads for a long section without losing data.
- **Instant garbage collection**: The moment `record_section_chunks` fires for a section, all chunk text before that commit is tombstoned on the next request.
- **Safe array mutation**: Uses `.map()` on `msg.content` (a `ToolResultPart[]`) to preserve sibling tool results from parallel execution.

### 5. System Prompt Addition (`src/app/api/chat/route.ts`)

Insert after Phase B's per-section verification steps:

```
After the user confirms a section is correct, call record_section_chunks immediately with the marker name and confirmed chunk indices.
```

### 6. Future — Headroom Layer

If context issues persist after pruning, a one-liner addition to the POST handler:

```typescript
import { withHeadroom } from "headroom-ai/vercel-ai";
const model = withHeadroom(provider(modelName));
```

Requires: `npm install headroom-ai` and a running `headroom proxy` service alongside the app.

## Files Changed

- **Modify:** `src/lib/store.ts` — add `sectionChunks` field, two new exports
- **Modify:** `src/lib/tools.ts` — add `record_section_chunks`, make `build_document` section_chunks optional
- **Modify:** `src/app/api/chat/route.ts` — message pruning block, prompt addition

No new dependencies. No new files.
