import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireViewer } from "@/lib/session";
import { errorResponse } from "@/lib/http";
import { DuplicateFileError, stageStatement } from "@/domain/ingestion/service";
import { MAX_STATEMENT_BYTES } from "@/domain/ingestion/pipeline";

export const runtime = "nodejs"; // pdf.js + node:crypto
export const maxDuration = 60;

const Fields = z.object({
  accountId: z.string().min(1),
  retainOriginal: z.enum(["true", "false"]).default("true"),
});

/**
 * POST multipart/form-data: accountId, retainOriginal, files[].
 * The web client sends ONE file per request: Vercel caps request bodies at 4.5 MB.
 * Files are staged independently so one bad PDF doesn't sink the batch; the
 * response carries a review model per file for the review screen.
 */
export async function POST(req: Request) {
  try {
    const viewer = await requireViewer();
    const form = await req.formData();
    const fields = Fields.parse({ accountId: form.get("accountId"), retainOriginal: form.get("retainOriginal") ?? undefined });
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0 || files.length > 12) return NextResponse.json({ error: "Upload between 1 and 12 files." }, { status: 400 });

    const results = [];
    // Sequential on purpose: file 2 dedupes against file 1 once it's committed,
    // and memory stays bounded with big PDFs.
    for (const file of files) {
      if (file.size > MAX_STATEMENT_BYTES) {
        results.push({ filename: file.name, error: { code: "too_large", message: "Over 15 MB." } });
        continue;
      }
      try {
        const r = await stageStatement(db, viewer, {
          bytes: new Uint8Array(await file.arrayBuffer()),
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          accountId: fields.accountId,
          retainOriginal: fields.retainOriginal === "true",
        });
        results.push({ filename: file.name, ...r });
      } catch (e) {
        if (e instanceof DuplicateFileError) results.push({ filename: file.name, error: { code: "duplicate_file", message: e.message, statementId: e.statementId } });
        else throw e;
      }
    }
    return NextResponse.json({ results });
  } catch (e) {
    return errorResponse(e);
  }
}
