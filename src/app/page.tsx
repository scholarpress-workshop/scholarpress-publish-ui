"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { InstitutionSelector } from "@/components/institution-selector";
import type { InstitutionSummary } from "@/lib/api";
import { ChatPanel } from "@/components/chat-panel";
import { ValidationResults } from "@/components/validation-results";

const PdfPreview = dynamic(
  () => import("@/components/pdf-preview").then((m) => m.PdfPreview),
  { ssr: false }
);

export default function Home() {
  const [institution, setInstitution] = useState<InstitutionSummary | null>(
    null
  );
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [violations, setViolations] = useState([]);
  const [passCount, setPassCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [rightTab, setRightTab] = useState<"preview" | "validation">(
    "preview"
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
          {institution ? (
            <ChatPanel institutionId={institution.id} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              Select an institution to begin
            </div>
          )}
        </div>
        <div className="flex w-1/2 flex-col">
          <div className="flex border-b">
            <button
              type="button"
              className={`px-4 py-2 text-sm font-medium ${
                rightTab === "preview"
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground"
              }`}
              onClick={() => setRightTab("preview")}
            >
              Preview
            </button>
            <button
              type="button"
              className={`px-4 py-2 text-sm font-medium ${
                rightTab === "validation"
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground"
              }`}
              onClick={() => setRightTab("validation")}
            >
              Validation
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {rightTab === "preview" ? (
              <PdfPreview pdfBytes={pdfBytes} />
            ) : (
              <ValidationResults
                violations={violations}
                passCount={passCount}
                failCount={failCount}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
