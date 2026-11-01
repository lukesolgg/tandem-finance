import PDFDocument from "pdfkit";

/**
 * Synthetic statement PDFs that reproduce the layout traits that break naive
 * parsers. Real statements can't live in the repo (they're people's money), so
 * every trait we support gets a synthetic twin here.
 */

type Cell = { text: string; x: number; width: number; align?: "left" | "right" };
type Row = Cell[];

function render(build: (doc: PDFKit.PDFDocument, row: (cells: Row) => void, newPage: () => void) => void): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.font("Helvetica").fontSize(9);
    let y = 60;
    const row = (cells: Row) => {
      for (const c of cells) doc.text(c.text, c.x, y, { width: c.width, align: c.align ?? "left", lineBreak: false });
      y += 14;
    };
    const newPage = () => {
      doc.addPage();
      y = 60;
    };
    build(doc, row, newPage);
    doc.end();
  });
}

/**
 * HSBC-style:
 *  - header: Date | Payment type and details | Paid out | Paid in | Balance
 *  - date printed once per day, no year ("16 Dec"), statement spans Dec→Jan
 *  - payee wraps onto two lines, amount on the LAST line
 *  - balance printed only at end of each day
 *  - page break with BALANCE CARRIED FORWARD / BROUGHT FORWARD + repeated header
 *  - footer small print after the table
 */
export function hsbcStylePdf(): Promise<Buffer> {
  const C = { date: 40, desc: 100, out: 330, inn: 410, bal: 490 };
  const header: Row = [
    { text: "Date", x: C.date, width: 55 },
    { text: "Payment type and details", x: C.desc, width: 200 },
    { text: "Paid out", x: C.out, width: 70, align: "right" },
    { text: "Paid in", x: C.inn, width: 70, align: "right" },
    { text: "Balance", x: C.bal, width: 70, align: "right" },
  ];
  const line = (date: string, desc: string, out = "", inn = "", bal = ""): Row => [
    { text: date, x: C.date, width: 55 },
    { text: desc, x: C.desc, width: 220 },
    { text: out, x: C.out, width: 70, align: "right" },
    { text: inn, x: C.inn, width: 70, align: "right" },
    { text: bal, x: C.bal, width: 70, align: "right" },
  ];
  return render((doc, row, newPage) => {
    row([{ text: "HSBC UK Bank plc", x: 40, width: 300 }]);
    row([{ text: "Your Statement  15 December to 14 January 2026", x: 40, width: 400 }]);
    row([{ text: "Account number 40-11-22 12345678", x: 40, width: 400 }]);
    row([{ text: "", x: 40, width: 10 }]);
    row(header);
    row(line("15 Dec", "BALANCE BROUGHT FORWARD", "", "", "1,000.00"));
    row(line("16 Dec", ")))  TESCO STORES 3021"));
    row(line("", "BELFAST", "23.45"));
    row(line("", "DD  NIE ENERGY", "80.00", "", "896.55"));
    row(line("31 Dec", "CR  ACME LTD SALARY", "", "2,100.00", "2,996.55"));
    row(line("", "BALANCE CARRIED FORWARD", "", "", "2,996.55"));
    row([{ text: "", x: 40, width: 10 }]);
    row([{ text: "", x: 40, width: 10 }]);
    row([{ text: "HSBC UK Bank plc is authorised by the Prudential Regulation Authority.", x: 40, width: 500 }]);
    newPage();
    row(header);
    row(line("", "BALANCE BROUGHT FORWARD", "", "", "2,996.55"));
    row(line("02 Jan", "VIS  AMAZON.CO.UK*AB12C"));
    row(line("", "AMAZON.CO.UK"));
    row(line("", "LUXEMBOURG", "15.99"));
    row(line("", "SO  J SMITH RENT", "650.00", "", "2,330.56"));
    row(line("05 Jan", "))) COSTA COFFEE", "3.20"));
    row(line("", "))) COSTA COFFEE", "3.20", "", "2,324.16"));
    row(line("", "BALANCE CARRIED FORWARD", "", "", "2,324.16"));
  });
}

/**
 * Monzo-style:
 *  - single Amount column: debits "-12.34", credits bare "12.34"
 *  - full DD/MM/YYYY dates, amount on the payee line, reference line BELOW it
 *  - balance on every row
 */
export function monzoStylePdf(): Promise<Buffer> {
  const C = { date: 40, desc: 120, amt: 380, bal: 470 };
  const row4 = (date: string, desc: string, amt = "", bal = ""): Row => [
    { text: date, x: C.date, width: 70 },
    { text: desc, x: C.desc, width: 240 },
    { text: amt, x: C.amt, width: 70, align: "right" },
    { text: bal, x: C.bal, width: 80, align: "right" },
  ];
  return render((_doc, row) => {
    row([{ text: "Monzo Bank Limited", x: 40, width: 300 }]);
    row([{ text: "Personal Account statement 01/10/2026 - 31/10/2026", x: 40, width: 400 }]);
    row(row4("Date", "Description", "Amount (GBP)", "Balance (GBP)"));
    row(row4("02/10/2026", "Pret A Manger", "-4.35", "995.65"));
    row(row4("", "PRET A MANGER LONDON GBR", "", ""));
    row(row4("13/10/2026", "ACME LTD", "2,150.00", "3,145.65"));
    row(row4("", "Reference: SALARY OCT", "", ""));
    row(row4("15/10/2026", "Netflix", "-10.99", "3,134.66"));
  });
}

/**
 * Worst case: single Amount column with NO sign markers at all. Only the
 * balance column can tell debits from credits.
 */
export function unsignedAmountPdf(): Promise<Buffer> {
  const C = { date: 40, desc: 120, amt: 380, bal: 470 };
  const r = (date: string, desc: string, amt = "", bal = ""): Row => [
    { text: date, x: C.date, width: 70 },
    { text: desc, x: C.desc, width: 240 },
    { text: amt, x: C.amt, width: 70, align: "right" },
    { text: bal, x: C.bal, width: 80, align: "right" },
  ];
  return render((_doc, row) => {
    row([{ text: "Some Credit Union", x: 40, width: 300 }]);
    row(r("Date", "Details", "Amount", "Balance"));
    row(r("01/09/2026", "Opening balance", "", "100.00"));
    row(r("02/09/2026", "GROCERY SHOP", "20.00", "80.00"));
    row(r("03/09/2026", "WAGES", "500.00", "580.00"));
    row(r("04/09/2026", "ELECTRIC", "60.00", "520.00"));
  });
}

/**
 * Credit-card style (Vanquis / Zable shape): no balance column, amounts
 * unsigned, a payment row with no CR marker. Only "it's a card" + the
 * payment wording can tell direction.
 */
export function cardStatementPdf(): Promise<Buffer> {
  const C = { date: 40, desc: 120, amt: 440 };
  const r = (date: string, desc: string, amt = ""): Row => [
    { text: date, x: C.date, width: 70 },
    { text: desc, x: C.desc, width: 280 },
    { text: amt, x: C.amt, width: 80, align: "right" },
  ];
  return render((_doc, row) => {
    row([{ text: "Vanquis Bank Limited", x: 40, width: 300 }]);
    row([{ text: "Credit limit £1,500.00   Minimum payment £25.00", x: 40, width: 400 }]);
    row(r("Date", "Transaction details", "Amount"));
    row(r("03 Oct 2026", "ARGOS LTD", "45.00"));
    row(r("09 Oct 2026", "PAYMENT RECEIVED THANK YOU", "100.00"));
    row(r("15 Oct 2026", "ODEON CINEMAS", "12.50"));
  });
}
