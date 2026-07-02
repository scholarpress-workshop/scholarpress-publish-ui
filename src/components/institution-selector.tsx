"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InstitutionSummary } from "@/lib/api";

interface InstitutionSelectorProps {
  onSelect: (institution: InstitutionSummary) => void;
  selected?: InstitutionSummary;
}

export function InstitutionSelector({
  onSelect,
  selected,
}: InstitutionSelectorProps) {
  const [institutions, setInstitutions] = useState<InstitutionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/institutions")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setInstitutions(data);
        if (data.length > 0 && !selected) {
          onSelect(data[0]);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="h-10 w-64 animate-pulse rounded-md bg-muted" />;
  }

  if (error) {
    return (
      <div className="text-sm text-destructive">
        Failed to load institutions: {error}
      </div>
    );
  }

  return (
    <Select
      value={selected?.id}
      onValueChange={(id) => {
        const inst = institutions.find((i) => i.id === id);
        if (inst) onSelect(inst);
      }}
    >
      <SelectTrigger className="w-64">
        <SelectValue placeholder="Select institution..." />
      </SelectTrigger>
      <SelectContent>
        {institutions.map((inst) => (
          <SelectItem key={inst.id} value={inst.id}>
            {inst.ui_config?.name ?? inst.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
