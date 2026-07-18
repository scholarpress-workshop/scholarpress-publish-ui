import type { ModelMessage } from "ai";

export function pruneOldChunkResults(messages: ModelMessage[]): ModelMessage[] {
  const lastCommitIndex = messages.findLastIndex(
    (msg) =>
      msg.role === "tool" &&
      Array.isArray(msg.content) &&
      msg.content.some(
        (part) =>
          part.type === "tool-result" &&
          part.toolName === "record_section_chunks"
      )
  );

  if (lastCommitIndex === -1) return messages;

  const pruned = [...messages];
  for (let i = 0; i < lastCommitIndex; i++) {
    const msg = pruned[i];
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
      pruned[i] = { ...msg, content: cleaned } as ModelMessage;
    }
  }
  return pruned;
}
