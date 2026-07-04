import type { UIMessage } from "ai";

interface ChatMessageProps {
  message: UIMessage;
}

export function ChatMessage({ message }: ChatMessageProps) {
  return (
    <div
      className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          message.role === "user"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <p key={i} className="whitespace-pre-wrap text-sm">
                {part.text}
              </p>
            );
          }
          const raw = part as Record<string, unknown>;
          if (
            typeof raw.type === "string" &&
            (raw.type.startsWith("tool-") || raw.type === "dynamic-tool") &&
            typeof raw.state === "string"
          ) {
            const toolName =
              raw.type === "dynamic-tool"
                ? (raw.toolName as string)
                : (raw.type as string).slice(5);
            const isRunning =
              raw.state === "input-streaming" ||
              raw.state === "streaming" ||
              raw.state === "input-available";
            const isError = raw.state === "output-error";
            return (
              <div key={i} className="mt-1 text-xs text-muted-foreground">
                <code>
                  {isRunning
                    ? `Running ${toolName}...`
                    : isError
                      ? `${toolName} failed`
                      : `${toolName} completed`}
                </code>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
