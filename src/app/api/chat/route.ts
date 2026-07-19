import {
  streamText,
  stepCountIs,
  UIMessage,
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createTools } from "@/lib/tools";
import { fetchInstitutionSpec, fetchTemplate } from "@/lib/api";
import { pruneOldChunkResults } from "@/lib/prune-messages";

const DEFAULT_BASE_URL = "https://reallms.rescloud.iu.edu/direct/v1";
const DEFAULT_MODEL = "glm-5.2";

async function buildSystemPrompt(
  institutionId: string,
  sessionId: string
): Promise<string> {
  let specSummary = "";
  let templateIndex = "";

  try {
    const spec = await fetchInstitutionSpec(institutionId);
    const structure = spec.summary.document_structure;
    const constants = spec.summary.constants;
    specSummary = `Institution: ${spec.summary.institution}
Required sections: ${JSON.stringify(structure)}
Constants: ${JSON.stringify(constants)}
Checks: ${spec.summary.check_count.automated} automated, ${spec.summary.check_count.human} human-review`;
  } catch {
    specSummary = `Institution: ${institutionId}`;
  }

  try {
    const tmpl = await fetchTemplate(institutionId);
    templateIndex = tmpl.files
      .map((f) => `  ${f.path} (${f.content.split("\n").length} lines)`)
      .join("\n");
  } catch {
    templateIndex = "(template not available)";
  }

  return `You are a dissertation formatting assistant. Follow the workflow below IN ORDER. ALWAYS pause and ask the student for confirmation after every step that says "ASK". Never skip a checkpoint.

SUBMISSION REQUIREMENTS:
${specSummary}

TEMPLATE FILES AVAILABLE:
${templateIndex}
Entry point: template.typ

Session ID: ${sessionId}

You have access to eight tools: extract_document, get_document_chunks, get_institution_spec, get_template, build_document, compile_typst, validate_pdf, and record_section_chunks.

get_document_chunks: provide heading text to jump to that section in the document. Returns chunks of text plus a heading object with text, level, page_number, and char_start. Use heading text as the key for record_section_chunks.

record_section_chunks: call after confirming a section. Pass marker name (e.g. "CH1", "ABSTRACT") and heading text. The backend stores this for build_document to use later. Call autonomously in Phase 2 — no user confirmation needed.

CALL FORMAT REFERENCE:
- record_section_chunks({ marker: "CH1", heading: "CHAPTER 1: INTRODUCTION" })
- For chapter sub-sections: record_section_chunks({ marker: "CH1_S1", heading: "1.1 Background" })

CRITICAL SYNTAX RULES:
- Template markers use {{MARKER}} (double braces). Single braces { } are Typst code block syntax and must not be used as markers.
- Short fields go inline as Typst string literals: title: "My Title", author: "Jane Doe"
- Body text goes through {{MARKER}} placeholders. The backend substitutes exact section text automatically — you never write text content.
- Reuse template values directly from the spec — do not recalculate constants.
- Keep function calls on one line. Close all parentheses, brackets, and braces.

WORKFLOW — two phases. Phase 1 has three checkpoints for user confirmation. Phase 2 is fully autonomous.

PHASE 1 — STRUCTURE INFERENCE (three checkpoints, each requires user confirmation before proceeding)

CHECKPOINT A — FRONT MATTER & PRE-CHAPTER SECTIONS

1. When the student uploads their .docx dissertation, call extract_document.
2. Call get_institution_spec and get_template (silent).
3. Infer ALL front matter variables: title, author, degree, department, school, campus, month, year, defense date, and committee (each member: name, degree, role). Also detect optional sections before Chapter 1: copyright year, dedication text, acknowledgements heading, preface heading, abstract heading. For each section: identify heading text and chunk range.
4. ASK: Present the inferred variables table AND the list of pre-chapter sections with their heading text. "Are these correct? Edit any that are wrong."
5. For each confirmed section, call record_section_chunks with its marker and heading text.

Do NOT proceed to Checkpoint B until the student confirms.

CHECKPOINT B — CHAPTERS

1. Use get_document_chunks to browse the document and discover all chapter headings and their sub-headings/sub-sub-headings.
2. Infer the complete chapter hierarchy: chapters, sub-sections, sub-sub-sections. For each: heading text, level (from detection or inferred from context), and chunk range.
3. ASK: Present the inferred chapter tree. "Is this the correct chapter and sub-heading structure? Any missing or misidentified headings?"
4. For each confirmed section, call record_section_chunks with its marker and heading text. Assign markers by order: chapter 1 gets "CH1", its sub-section "CH1_S1", sub-sub-section "CH1_S1_SS1", etc.

Do NOT proceed to Checkpoint C until the student confirms.

CHECKPOINT C — END MATTER

1. Use get_document_chunks to discover end-matter sections.
2. Infer: appendices (with label and title), references/bibliography, curriculum vitae. For each: heading text and chunk range.
3. ASK: "Are these end-matter sections correct? Any missing appendices?"
4. For each confirmed section, call record_section_chunks with its marker and heading text.

Do NOT proceed to Phase 2 until the student confirms all three checkpoints.

PHASE 2 — AUTONOMOUS ASSEMBLY (no user pauses)

Do NOT ask the student for anything during Phase 2. Work autonomously.

1. Call record_section_chunks for EVERY confirmed section from all three checkpoints. Use the marker names and heading text already verified. No pauses.
2. Construct the complete typst_structure string. Use verified front matter variables as literal values. Use {{MARKER}} placeholders for body text. Do NOT include a section_starts map — the backend reads your recorded state.
3. Call build_document with typst_structure.
4. Call validate_pdf.
5. If violations exist: fix ONE issue at a time. Re-submit build_document, re-validate. Loop until all automated checks pass.
6. Move to Phase D.

PHASE D — HUMAN-REVIEW CHECKS

Walk through each human-review check ONE at a time. For each:
  • Present the check description
  • Explain what to look for
  • ASK for confirmation
  • Record response
Do not move to the next check until the student responds.

When all checks pass: tell the student their document is ready.`;
}

export async function POST(req: Request) {
  const {
    messages,
    institutionId,
    sessionId,
    llmApiKey,
    llmModel,
    llmBaseUrl,
  }: {
    messages: UIMessage[];
    institutionId: string;
    sessionId: string;
    llmApiKey?: string;
    llmModel?: string;
    llmBaseUrl?: string;
  } = await req.json();

  const baseURL = llmBaseUrl || process.env.LLM_BASE_URL || DEFAULT_BASE_URL;
  const model = llmModel || process.env.LLM_MODEL || DEFAULT_MODEL;
  const apiKey = llmApiKey || process.env.LLM_API_KEY || "";

  const provider = createOpenAICompatible({
    name: "llm",
    baseURL,
    apiKey,
  });

  const systemPrompt = await buildSystemPrompt(institutionId, sessionId);

  const coreMessages = pruneOldChunkResults(
    await convertToModelMessages(messages)
  );

  const result = streamText({
    model: provider(model),
    messages: coreMessages,
    system: systemPrompt,
    tools: createTools(sessionId),
    stopWhen: stepCountIs(10),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
