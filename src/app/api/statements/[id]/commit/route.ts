import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireViewer } from "@/lib/session";
import { commitStatement } from "@/domain/ingestion/service";
import { errorResponse } from "@/lib/http";

const Body = z.object({
  exclude: z.array(z.number().int().nonnegative()).optional(),
  forceInclude: z.array(z.number().int().nonnegative()).optional(),
  edits: z
    .record(
      z.string().regex(/^\d+$/),
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        amount: z.number().int().optional(),
        description: z.string().min(1).max(200).optional(),
      }),
    )
    .optional(),
});

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireViewer();
    const { id } = await params;
    const body = Body.parse(await req.json().catch(() => ({})));
    const edits = body.edits ? Object.fromEntries(Object.entries(body.edits).map(([k, v]) => [Number(k), v])) : undefined;
    const result = await commitStatement(db, viewer, id, { ...body, edits });
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
