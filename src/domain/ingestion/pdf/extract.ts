import { StatementParseError } from "../types";

/**
 * Positional text extraction from PDF.
 *
 * Bank statement PDFs are not tables — they're glyphs placed at x/y
 * coordinates. Plain "extract text" loses the column a number sat in, which is
 * exactly what distinguishes "Paid out" from "Paid in". So we keep geometry:
 * each line is a list of cells with x-extents, and the table parser assigns
 * cells to columns by position relative to the header row.
 *
 * Runs entirely in-process (pdf.js, no native deps, no network) so statements
 * never leave the server — important for the self-hosted story.
 */
export interface PdfCell {
  text: string;
  x0: number;
  x1: number;
}
export interface PdfLine {
  page: number;
  /** Top-down y (0 = top of page). */
  y: number;
  height: number;
  cells: PdfCell[];
  text: string;
}
export interface PdfDocumentText {
  pages: number;
  lines: PdfLine[];
  fullText: string;
}

interface RawItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function extractPdfLines(bytes: Uint8Array): Promise<PdfDocumentText> {
  // Legacy build = Node-compatible, no DOM. Imported lazily so the CSV/OFX paths
  // (and the browser bundle) never pay for pdf.js.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Run pdf.js's "worker" on the main thread. Importing it statically here (a)
  // avoids pdf.js resolving a worker path at runtime, which breaks in bundled /
  // standalone builds, and (b) lets the file tracer ship the worker file.
  const g = globalThis as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes), // pdf.js detaches the buffer; copy so callers keep theirs
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    }).promise;
  } catch (err) {
    if ((err as { name?: string }).name === "PasswordException") {
      throw new StatementParseError("encrypted_pdf", "This PDF is password-protected. Remove the password and re-upload.");
    }
    throw new StatementParseError("malformed", "Couldn't open this PDF.");
  }

  const lines: PdfLine[] = [];
  let itemCount = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: RawItem[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const [, , c, d, e, f] = it.transform as number[];
      const h = Math.hypot(c!, d!) || it.height || 10;
      items.push({ str: it.str, x: e!, y: viewport.height - f!, w: it.width, h });
    }
    itemCount += items.length;
    lines.push(...groupIntoLines(items, p));
    page.cleanup();
  }
  await doc.destroy();

  if (itemCount === 0) {
    throw new StatementParseError(
      "scanned_pdf_no_text",
      "This PDF is a scanned image with no text layer. Download the statement from online banking instead (or CSV/OFX).",
    );
  }
  return { pages: doc.numPages, lines, fullText: lines.map((l) => l.text).join("\n") };
}

/** Cluster items into visual lines (y within ~40% of glyph height), then merge adjacent items into cells. */
function groupIntoLines(items: RawItem[], page: number): PdfLine[] {
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: RawItem[][] = [];
  for (const it of items) {
    const row = rows[rows.length - 1];
    const ref = row?.[0];
    if (row && ref && Math.abs(ref.y - it.y) <= Math.max(2, ref.h * 0.4)) row.push(it);
    else rows.push([it]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const cells: PdfCell[] = [];
    for (const it of row) {
      const prev = cells[cells.length - 1];
      // Gap threshold ≈ 1.5 spaces: words in a cell merge, columns stay apart.
      const gap = prev ? it.x - prev.x1 : Infinity;
      if (prev && gap < it.h * 0.5) {
        prev.text += (gap > it.h * 0.1 ? " " : "") + it.str;
        prev.x1 = Math.max(prev.x1, it.x + it.w);
      } else {
        cells.push({ text: it.str, x0: it.x, x1: it.x + it.w });
      }
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, " ").trim();
    const height = Math.max(...row.map((r) => r.h));
    return { page, y: row[0]!.y, height, cells, text: cells.map((c) => c.text).join("  ") };
  });
}
