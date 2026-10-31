import { extractText } from "unpdf";

const MAX_RESUME_PDF_BYTES = 8 * 1024 * 1024;

export async function textFromResumePdf(file: File): Promise<string> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) throw new Error("That file is not a PDF.");
  if (file.size > MAX_RESUME_PDF_BYTES) throw new Error("That PDF is larger than 8 MB.");
  const { text } = await extractText(new Uint8Array(await file.arrayBuffer()), { mergePages: true });
  const resume = text.replaceAll("\u0000", "").trim();
  if (!resume) throw new Error("This PDF has no selectable text. Paste the resume instead.");
  return resume;
}
