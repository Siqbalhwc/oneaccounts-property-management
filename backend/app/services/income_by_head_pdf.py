from app.core.labels import unit_from_company
"""
Renders the Receipts by Head report as a landscape, letterhead-branded PDF.
Uses reportlab's Platypus layer (SimpleDocTemplate + Table + Paragraph)
rather than raw canvas drawing like invoice_pdf.py -- this report can run
to many rows and many dynamic income-head columns, so it needs real text
wrapping inside cells and automatic pagination with a repeating header row,
which Platypus gives for free and hand-positioned canvas drawing doesn't.

Colors and general letterhead style deliberately match invoice_pdf.py so
every PDF this app produces looks like it came from the same place.
"""

import io

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    NextPageTemplate,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

LEDGER = colors.Color(0.184, 0.310, 0.239)
BRASS = colors.Color(0.784, 0.608, 0.361)
INK = colors.Color(0.122, 0.176, 0.141)
PAPER = colors.Color(0.953, 0.949, 0.902)
ROW_ALT = colors.Color(0.965, 0.965, 0.955)
WHITE = colors.white


def _fmt(n: float) -> str:
    """Plain number -- the report says "Amounts in Rs" once, top right, instead
    of repeating "Rs" in every cell."""
    try:
        return f"{float(n):,.0f}"
    except (TypeError, ValueError):
        return "0"


def render_income_by_head_pdf(
    report: dict,
    company: dict,
    date_from,
    date_to,
    building_name: str = None,
) -> bytes:
    """
    report: the exact dict _compute_income_by_head() returns (columns, rows,
    totals, grand_total). company: a row from the companies table (name,
    address, phone, logo_url). Returns PDF bytes.
    """
    buffer = io.BytesIO()
    page_size = landscape(A4)
    page_w, page_h = page_size
    margin = 14 * mm

    doc = BaseDocTemplate(
        buffer,
        pagesize=page_size,
        leftMargin=margin,
        rightMargin=margin,
        topMargin=margin,
        bottomMargin=margin,
        title="Receipts by Head",
    )
    frame = Frame(margin, margin, page_w - 2 * margin, page_h - 2 * margin, id="body")
    doc.addPageTemplates([PageTemplate(id="report", frames=[frame])])

    styles = {
        "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=16, textColor=WHITE, leading=19),
        "sub": ParagraphStyle("sub", fontName="Helvetica", fontSize=8.5, textColor=colors.Color(0.9, 0.92, 0.9), leading=11),
        "report_title": ParagraphStyle("report_title", fontName="Helvetica-Bold", fontSize=13, textColor=INK, spaceBefore=2, spaceAfter=1),
        "report_meta": ParagraphStyle("report_meta", fontName="Helvetica", fontSize=9, textColor=colors.Color(0.4, 0.43, 0.41), spaceAfter=8),
        "th": ParagraphStyle("th", fontName="Helvetica-Bold", fontSize=8, textColor=WHITE, leading=10),
        "th_r": ParagraphStyle("th_r", fontName="Helvetica-Bold", fontSize=8, textColor=WHITE, leading=10, alignment=2),
        "cell": ParagraphStyle("cell", fontName="Helvetica", fontSize=8.5, textColor=INK, leading=11),
        "cell_r": ParagraphStyle("cell_r", fontName="Helvetica", fontSize=8.5, textColor=INK, leading=11, alignment=2),
        "cell_r_dim": ParagraphStyle("cell_r_dim", fontName="Helvetica", fontSize=8.5, textColor=colors.Color(0.6, 0.6, 0.6), leading=11, alignment=2),
        "total_cell": ParagraphStyle("total_cell", fontName="Helvetica-Bold", fontSize=8.5, textColor=LEDGER, leading=11),
        "total_cell_r": ParagraphStyle("total_cell_r", fontName="Helvetica-Bold", fontSize=8.5, textColor=LEDGER, leading=11, alignment=2),
        "amounts_in": ParagraphStyle("amounts_in", fontName="Helvetica-Oblique", fontSize=9, textColor=colors.Color(0.4, 0.43, 0.41), alignment=2),
        "part": ParagraphStyle("part", fontName="Helvetica-Bold", fontSize=10.5, textColor=INK, spaceBefore=6, spaceAfter=3),
        "footer": ParagraphStyle("footer", fontName="Helvetica-Oblique", fontSize=7.5, textColor=colors.Color(0.45, 0.48, 0.46)),
    }

    story = []

    # ---- Letterhead band (drawn as a full-bleed colored table row, since
    # Platypus flowables live inside the margin -- a one-cell colored Table
    # with negative padding is the simplest way to bleed it to the edges) ----
    header_cells = [Paragraph(company.get("name") or "Property Management", styles["title"])]
    meta_lines = [l for l in [company.get("address"), company.get("phone")] if l]
    if meta_lines:
        header_cells.append(Paragraph(" &nbsp;·&nbsp; ".join(meta_lines), styles["sub"]))
    header_table = Table([[c] for c in header_cells], colWidths=[page_w - 2 * margin])
    header_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), LEDGER),
                ("LEFTPADDING", (0, 0), (-1, -1), 10 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10 * mm),
                ("TOPPADDING", (0, 0), (0, 0), 6 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5 * mm if len(header_cells) > 1 else 6 * mm),
                ("TOPPADDING", (0, 1), (0, 1), 0),
            ]
        )
    )
    story.append(header_table)
    story.append(Spacer(1, 6 * mm))

    subtitle_bits = [f"{date_from} to {date_to}"]
    if building_name:
        subtitle_bits.append(building_name)
    title_table = Table(
        [[[Paragraph("Receipts by Head", styles["report_title"]), Paragraph(" — ".join(subtitle_bits), styles["report_meta"])],
          Paragraph("Amounts in Rs", styles["amounts_in"])]],
        colWidths=[page_w - 2 * margin - 40 * mm, 40 * mm],
    )
    title_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story.append(title_table)
    story.append(Paragraph("Part 1 — Cash and bank receipts", styles["part"]))

    # ---- Table ----
    columns = report["columns"]
    rows = report["rows"]
    totals = report["totals"]

    # Column widths: Sr narrow, Tenant/Room generous, every head column and
    # Total share the rest evenly. No hard minimum on the numeric columns --
    # instead the font size and padding scale DOWN as columns get tighter
    # (more income heads = smaller, denser text), so a company with many
    # custom charge labels still fits on one landscape page instead of
    # overflowing it or force-breaking a word like "Commission" mid-letter.
    usable_width = page_w - 2 * margin
    sr_w = 9 * mm
    tenant_w = 40 * mm
    room_w = 40 * mm
    remaining = usable_width - sr_w - tenant_w - room_w
    n_numeric_cols = len(columns) + 1  # + Total
    numeric_w = remaining / max(n_numeric_cols, 1)
    col_widths = [sr_w, tenant_w, room_w] + [numeric_w] * n_numeric_cols

    if numeric_w >= 22 * mm:
        num_font, num_pad = 8, 2.5 * mm
    elif numeric_w >= 17 * mm:
        num_font, num_pad = 7.5, 1.8 * mm
    elif numeric_w >= 13 * mm:
        num_font, num_pad = 7, 1.2 * mm
    else:
        num_font, num_pad = 6.5, 0.8 * mm

    styles["th_r"] = ParagraphStyle("th_r2", fontName="Helvetica-Bold", fontSize=num_font, textColor=WHITE, leading=num_font + 1.5, alignment=2)
    styles["cell_r"] = ParagraphStyle("cell_r2", fontName="Helvetica", fontSize=num_font, textColor=INK, leading=num_font + 1.5, alignment=2)
    styles["cell_r_dim"] = ParagraphStyle(
        "cell_r_dim2", fontName="Helvetica", fontSize=num_font, textColor=colors.Color(0.6, 0.6, 0.6), leading=num_font + 1.5, alignment=2
    )
    styles["total_cell_r"] = ParagraphStyle(
        "total_cell_r2", fontName="Helvetica-Bold", fontSize=num_font, textColor=LEDGER, leading=num_font + 1.5, alignment=2
    )

    header_row = (
        [Paragraph("Sr", styles["th"]), Paragraph("Tenant", styles["th"]), Paragraph(unit_from_company(company)["singular"], styles["th"])]
        + [Paragraph(c, styles["th_r"]) for c in columns]
        + [Paragraph("Total", styles["th_r"])]
    )

    table_data = [header_row]
    for r in rows:
        row_cells = [
            Paragraph(str(r["sr"]), styles["cell"]),
            Paragraph(r["tenant_name"] or "—", styles["cell"]),
            Paragraph(r["room_label"] or "—", styles["cell"]),
        ]
        for c in columns:
            amount = r["heads"].get(c, 0)
            row_cells.append(Paragraph(_fmt(amount) if amount else "—", styles["cell_r"] if amount else styles["cell_r_dim"]))
        row_cells.append(Paragraph(_fmt(r["total"]), styles["total_cell_r"]))
        table_data.append(row_cells)

    totals_row = (
        [Paragraph("", styles["cell"]), Paragraph("Total", styles["total_cell"]), Paragraph("", styles["cell"])]
        + [Paragraph(_fmt(totals.get(c, 0)), styles["total_cell_r"]) for c in columns]
        + [Paragraph(_fmt(report["grand_total"]), styles["total_cell_r"])]
    )
    table_data.append(totals_row)

    table = Table(table_data, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), LEDGER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3.2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.2 * mm),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        # Numeric columns (everything from column 3 onward) get the
        # width-appropriate padding computed above, so tight columns don't
        # lose even more space to padding than they already have to spare.
        ("LEFTPADDING", (3, 0), (-1, -1), num_pad),
        ("RIGHTPADDING", (3, 0), (-1, -1), num_pad),
        ("LINEBELOW", (0, 0), (-1, 0), 0.75, LEDGER),
        ("LINEBELOW", (0, -1), (-1, -1), 1.1, LEDGER),
        ("LINEABOVE", (0, -1), (-1, -1), 0.75, BRASS),
        ("BACKGROUND", (0, -1), (-1, -1), PAPER),
    ]
    for i in range(1, len(table_data) - 1):
        style_cmds.append(("LINEBELOW", (0, i), (-1, i), 0.4, colors.Color(0.85, 0.84, 0.8)))
        if i % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))
    table.setStyle(TableStyle(style_cmds))
    story.append(table)

    recon = report.get("reconciliation") or {}
    story.append(Spacer(1, 3 * mm))
    if recon.get("matches", True):
        recon_text = f"Matches the cash and bank books for the period: {_fmt(recon.get('books_total', report['grand_total']))}."
    else:
        recon_text = (
            f"Does not yet match the cash and bank books: report {_fmt(recon.get('report_total', 0))}, "
            f"books {_fmt(recon.get('books_total', 0))}, difference {_fmt(recon.get('gap', 0))}."
        )
    story.append(Paragraph(recon_text, styles["footer"]))

    settlement = report.get("settlement") or {}
    if settlement.get("rows"):
        story.append(Spacer(1, 6 * mm))
        story.append(Paragraph("Part 2 — Settled at final settlement (from security deposit, not cash)", styles["part"]))
        s_cols = settlement["columns"]
        s_header = (
            [Paragraph("Sr", styles["th"]), Paragraph("Tenant", styles["th"]), Paragraph(unit_from_company(company)["singular"], styles["th"])]
            + [Paragraph(c, styles["th_r"]) for c in s_cols]
            + [Paragraph("Settled", styles["th_r"]), Paragraph("Refund paid", styles["th_r"]), Paragraph("Deposit released", styles["th_r"])]
        )
        s_data = [s_header]
        for r in settlement["rows"]:
            cells = [
                Paragraph(str(r["sr"]), styles["cell"]),
                Paragraph(r["tenant_name"] or "—", styles["cell"]),
                Paragraph(r["room_label"] or "—", styles["cell"]),
            ]
            for c in s_cols:
                amount = r["heads"].get(c, 0)
                cells.append(Paragraph(_fmt(amount) if amount else "—", styles["cell_r"] if amount else styles["cell_r_dim"]))
            cells += [
                Paragraph(_fmt(r["settled_total"]), styles["total_cell_r"]),
                Paragraph(_fmt(r["refund_paid"]) if r["refund_paid"] else "—", styles["cell_r"] if r["refund_paid"] else styles["cell_r_dim"]),
                Paragraph(_fmt(r["deposit_released"]), styles["total_cell_r"]),
            ]
            s_data.append(cells)
        s_data.append(
            [Paragraph("", styles["cell"]), Paragraph("Total", styles["total_cell"]), Paragraph("", styles["cell"])]
            + [Paragraph(_fmt(settlement["totals"].get(c, 0)), styles["total_cell_r"]) for c in s_cols]
            + [
                Paragraph(_fmt(settlement["settled_total"]), styles["total_cell_r"]),
                Paragraph(_fmt(settlement["refund_total"]), styles["total_cell_r"]),
                Paragraph(_fmt(settlement["deposit_released_total"]), styles["total_cell_r"]),
            ]
        )
        s_numeric = len(s_cols) + 3
        s_w = (usable_width - sr_w - tenant_w - room_w) / max(s_numeric, 1)
        s_table = Table(s_data, colWidths=[sr_w, tenant_w, room_w] + [s_w] * s_numeric, repeatRows=1)
        s_style = [
            ("BACKGROUND", (0, 0), (-1, 0), LEDGER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 3.2 * mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3.2 * mm),
            ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
            ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
            ("LEFTPADDING", (3, 0), (-1, -1), num_pad),
            ("RIGHTPADDING", (3, 0), (-1, -1), num_pad),
            ("LINEBELOW", (0, -1), (-1, -1), 1.1, LEDGER),
            ("LINEABOVE", (0, -1), (-1, -1), 0.75, BRASS),
            ("BACKGROUND", (0, -1), (-1, -1), PAPER),
        ]
        for i in range(1, len(s_data) - 1):
            s_style.append(("LINEBELOW", (0, i), (-1, i), 0.4, colors.Color(0.85, 0.84, 0.8)))
        s_table.setStyle(TableStyle(s_style))
        story.append(s_table)
        story.append(Spacer(1, 3 * mm))
        story.append(
            Paragraph(
                "Part 2 amounts were cleared out of the tenant's security deposit when the lease was closed, so no cash or bank "
                "money moved for them except the refund paid. Deposit released = settled + refund paid.",
                styles["footer"],
            )
        )

    doc.build(story)
    buffer.seek(0)
    return buffer.read()
