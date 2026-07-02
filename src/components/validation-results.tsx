import { ScrollArea } from "@/components/ui/scroll-area";
import { ViolationCard } from "./violation-card";

interface Violation {
  check_id: string;
  status: string;
  detail: string;
  evidence?: Array<{ page: number }>;
}

interface ValidationResultsProps {
  violations: Violation[];
  passCount: number;
  failCount: number;
}

export function ValidationResults({
  violations,
  passCount,
  failCount,
}: ValidationResultsProps) {
  if (violations.length === 0 && passCount === 0 && failCount === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">Run a validation to see results</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-4 border-b px-4 py-2">
        <span className="text-xs text-green-600">{passCount} passed</span>
        <span className="text-xs text-destructive">{failCount} failed</span>
      </div>
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-2">
          {violations.map((v) => (
            <ViolationCard
              key={v.check_id}
              checkId={v.check_id}
              detail={v.detail}
              page={v.evidence?.[0]?.page}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
