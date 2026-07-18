import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EXTRACTION_DIR = join(tmpdir(), "format-my-dissertation");

function ensureExtractionDir() {
  try {
    if (!existsSync(EXTRACTION_DIR)) {
      mkdirSync(EXTRACTION_DIR, { recursive: true });
    }
  } catch {
    // swallow — file fallback will just be unavailable
  }
}

function extractionPath(sessionId: string) {
  return join(EXTRACTION_DIR, `${sessionId}.json`);
}

function writeExtractionFile(sessionId: string, result: StoreExtractResult) {
  try {
    ensureExtractionDir();
    writeFileSync(extractionPath(sessionId), JSON.stringify(result));
  } catch {
    // non-fatal: file persistence is best-effort
  }
}

function readExtractionFile(
  sessionId: string
): StoreExtractResult | null {
  try {
    if (!existsSync(extractionPath(sessionId))) return null;
    const raw = readFileSync(extractionPath(sessionId), "utf-8");
    return JSON.parse(raw) as StoreExtractResult;
  } catch {
    return null;
  }
}

interface SessionState {
  pdf: Uint8Array | null;
  extraction: StoreExtractResult | null;
  violations: Array<{
    check_id: string;
    status: string;
    detail: string;
    evidence: Array<{ page: number }>;
  }>;
  passCount: number;
  failCount: number;
  sectionChunks: Record<string, number[]>;
}

export interface StoreExtractResult {
  raw_text: string;
  headings: Array<{ text: string; level: number; page_number: number | null }>;
  page_count: number;
  page_count_estimated: boolean;
  detected_fonts: string[];
}

const store = new Map<string, SessionState>();

function getOrCreate(sessionId: string): SessionState {
  if (!store.has(sessionId)) {
    store.set(sessionId, {
      pdf: null,
      extraction: null,
      violations: [],
      passCount: 0,
      failCount: 0,
      sectionChunks: {},
    });
  }
  return store.get(sessionId)!;
}

export function storeExtraction(
  sessionId: string,
  result: StoreExtractResult
) {
  getOrCreate(sessionId).extraction = result;
  writeExtractionFile(sessionId, result);
}

export function getStoredExtraction(
  sessionId: string
): StoreExtractResult | null {
  const memVal = store.get(sessionId)?.extraction ?? null;
  if (memVal) return memVal;
  const fileVal = readExtractionFile(sessionId);
  if (fileVal) {
    getOrCreate(sessionId).extraction = fileVal;
    return fileVal;
  }
  return null;
}

export function getExtraction(sessionId: string): string | null {
  return store.get(sessionId)?.extraction?.raw_text ?? null;
}

export function storeSectionChunks(
  sessionId: string,
  marker: string,
  indices: number[]
) {
  const state = getOrCreate(sessionId);
  if (!state.sectionChunks) state.sectionChunks = {};
  state.sectionChunks[marker] = indices;
}

export function getStoredSectionChunks(
  sessionId: string
): Record<string, number[]> {
  return store.get(sessionId)?.sectionChunks ?? {};
}

export function storePdf(sessionId: string, pdf: Uint8Array) {
  getOrCreate(sessionId).pdf = pdf;
}

export function storeViolations(
  sessionId: string,
  violations: SessionState["violations"],
  passCount: number,
  failCount: number
) {
  const state = getOrCreate(sessionId);
  state.violations = violations;
  state.passCount = passCount;
  state.failCount = failCount;
}

export function getPdf(sessionId: string): Uint8Array | null {
  return store.get(sessionId)?.pdf ?? null;
}

export function getState(
  sessionId: string
): { pdf: string | null } & Omit<SessionState, "pdf"> {
  const state = getOrCreate(sessionId);
  return {
    pdf: state.pdf ? Buffer.from(state.pdf).toString("base64") : null,
    extraction: state.extraction,
    violations: state.violations,
    passCount: state.passCount,
    failCount: state.failCount,
    sectionChunks: state.sectionChunks,
  };
}
