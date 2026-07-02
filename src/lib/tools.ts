import { tool } from "ai";
import { z } from "zod";
import { extractDocument, compileTypst, validatePdf } from "./api";

export const extractTool = tool({
  description:
    "Extract text content from an uploaded dissertation file (PDF, DOCX, or LaTeX). Call this when the student uploads a file.",
  inputSchema: z.object({
    fileName: z.string().describe("The name of the uploaded file"),
    fileBytes: z
      .array(z.number())
      .describe("The raw bytes of the file"),
    mimeType: z.string().describe("The MIME type of the file"),
  }),
  execute: async ({ fileName, fileBytes, mimeType }) => {
    const file = new File([new Uint8Array(fileBytes)], fileName, {
      type: mimeType,
    });
    const result = await extractDocument(file);
    return result;
  },
});

export const compileTool = tool({
  description:
    "Compile Typst source code into a PDF document. Call this when the template code is ready.",
  inputSchema: z.object({
    typstCode: z
      .string()
      .describe("The complete Typst source code to compile"),
    institutionId: z
      .string()
      .describe("The institution ID (e.g. 'iu')"),
  }),
  execute: async ({ typstCode, institutionId }) => {
    const pdfBytes = await compileTypst(typstCode, institutionId);
    return { success: true, pdfSize: pdfBytes.byteLength };
  },
});

export const validateTool = tool({
  description:
    "Validate a compiled PDF against institution formatting requirements. Call this after compiling to check for violations.",
  inputSchema: z.object({
    pdfBytes: z
      .array(z.number())
      .describe("The compiled PDF bytes"),
    institutionId: z
      .string()
      .describe("The institution ID (e.g. 'iu')"),
  }),
  execute: async ({ pdfBytes, institutionId }) => {
    const result = await validatePdf(
      new Uint8Array(pdfBytes).buffer,
      institutionId
    );
    return {
      passCount: result.pass_count,
      failCount: result.fail_count,
      violations: result.results.filter((r) => r.status !== "pass"),
    };
  },
});
