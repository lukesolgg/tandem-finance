import { NextResponse } from "next/server";
import { z } from "zod";
import { UnauthorisedError } from "./session";
import { NotFoundError } from "@/domain/access/visibility";

/** Map domain errors to responses. Not-visible is always 404, never 403. */
export function errorResponse(e: unknown) {
  if (e instanceof UnauthorisedError) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (e instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (e instanceof z.ZodError) return NextResponse.json({ error: "Invalid request", issues: e.issues }, { status: 400 });
  // Log the error type only — never request bodies or row data.
  console.error("statement route error:", e instanceof Error ? e.name : typeof e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}
