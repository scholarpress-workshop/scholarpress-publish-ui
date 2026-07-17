"use client";

import { useState, useEffect } from "react";
import { Key, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY_API_KEY = "llm-api-key";
const STORAGE_KEY_MODEL = "llm-model";
const STORAGE_KEY_BASE_URL = "llm-base-url";

const DEFAULT_MODEL = "glm-5.2";
const DEFAULT_BASE_URL = "https://reallms.rescloud.iu.edu/direct/v1";

export function getStoredApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(STORAGE_KEY_API_KEY) ?? "";
}

export function getStoredModel(): string {
  if (typeof window === "undefined") return DEFAULT_MODEL;
  return localStorage.getItem(STORAGE_KEY_MODEL) ?? DEFAULT_MODEL;
}

export function getStoredBaseUrl(): string {
  if (typeof window === "undefined") return DEFAULT_BASE_URL;
  return localStorage.getItem(STORAGE_KEY_BASE_URL) ?? DEFAULT_BASE_URL;
}

export function LlmSettings() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setApiKey(getStoredApiKey());
    setModel(getStoredModel());
    setBaseUrl(getStoredBaseUrl());
  }, [open]);

  function handleSave() {
    const key = apiKey.trim();
    if (key) {
      localStorage.setItem(STORAGE_KEY_API_KEY, key);
    } else {
      localStorage.removeItem(STORAGE_KEY_API_KEY);
    }
    localStorage.setItem(STORAGE_KEY_MODEL, model.trim() || DEFAULT_MODEL);
    localStorage.setItem(STORAGE_KEY_BASE_URL, baseUrl.trim() || DEFAULT_BASE_URL);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(!open)}
        aria-label="LLM settings"
      >
        <Key className="size-4" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border bg-popover p-4 shadow-lg">
          <label className="mb-2 block text-sm font-medium text-foreground">
            LLM API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter your API key"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Stored in your browser only. Sent over HTTPS.
          </p>

          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="mt-3 flex w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <ChevronUp className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
            Advanced options
          </button>

          {expanded && (
            <div className="mt-2 space-y-3 border-t pt-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">
                  LLM Model
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={DEFAULT_MODEL}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">
                  LLM Base URL
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={DEFAULT_BASE_URL}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          )}

          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave}>
              {saved ? "Saved" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
