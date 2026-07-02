import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface ViolationCardProps {
  checkId: string;
  detail: string;
  page?: number;
}

export function ViolationCard({ checkId, detail, page }: ViolationCardProps) {
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="destructive">Fail</Badge>
            <code className="font-mono text-xs text-muted-foreground">
              {checkId}
            </code>
          </div>
          <p className="text-sm">{detail}</p>
        </div>
        {page && (
          <span className="shrink-0 text-xs text-muted-foreground">
            p. {page}
          </span>
        )}
      </div>
    </Card>
  );
}
