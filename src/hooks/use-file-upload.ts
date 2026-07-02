import { useState, useCallback } from "react";

export function useFileUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const selectFile = useCallback((f: File) => {
    setFile(f);
  }, []);

  const clearFile = useCallback(() => {
    setFile(null);
  }, []);

  return { file, isUploading, selectFile, clearFile, setIsUploading };
}
