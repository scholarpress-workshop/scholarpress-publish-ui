"use client";

import { useState } from "react";
import { InstitutionSelector } from "@/components/institution-selector";
import { InstitutionSummary } from "@/lib/api";
import { Separator } from "@/components/ui/separator";

export default function Home() {
  const [institution, setInstitution] = useState<InstitutionSummary | null>(
    null
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b px-6 py-3">
        <h1 className="text-lg font-semibold">Format My Dissertation</h1>
        <div className="flex-1" />
        <InstitutionSelector
          onSelect={setInstitution}
          selected={institution ?? undefined}
        />
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-1/2 flex-col border-r">
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            Chat panel placeholder
          </div>
        </div>
        <div className="flex w-1/2 flex-col">
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            Preview panel placeholder
          </div>
        </div>
      </div>
    </div>
  );
}
