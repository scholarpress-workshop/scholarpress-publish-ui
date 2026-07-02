"use client";

import { useMemo } from "react";

interface PdfPreviewProps {
  pdfBytes: Uint8Array | null;
}

export function PdfPreview({ pdfBytes }: PdfPreviewProps) {
  const fileUrl = useMemo(() => {
    if (!pdfBytes) return null;
    return URL.createObjectURL(
      new Blob([pdfBytes as BlobPart], { type: "application/pdf" })
    );
  }, [pdfBytes]);

  if (!fileUrl) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">Compile a PDF to see a preview here</p>
      </div>
    );
  }

  return (
    <iframe
      src={fileUrl}
      className="h-full w-full border-0"
      title="PDF Preview"
    />
  );
}
