from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
from reportlab.lib.enums import TA_LEFT
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 'pdf' / 'Meera-Ads-Handoff-for-Arya-2026-10-25.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
GREEN = colors.HexColor('#174B3B')
INK = colors.HexColor('#1F2E29')
MUTED = colors.HexColor('#52635C')
PALE = colors.HexColor('#EDF4EF')
GOLD = colors.HexColor('#A76719')
styles = {
    'title': ParagraphStyle('title', fontName='Helvetica-Bold', fontSize=27, leading=31, textColor=GREEN, spaceAfter=10),
    'sub': ParagraphStyle('sub', fontName='Helvetica', fontSize=10, leading=15, textColor=MUTED, spaceAfter=17),
    'h': ParagraphStyle('h', fontName='Helvetica-Bold', fontSize=13, leading=18, textColor=GREEN, spaceBefore=14, spaceAfter=7),
    'body': ParagraphStyle('body', fontName='Helvetica', fontSize=10, leading=14, textColor=INK, spaceAfter=7),
    'small': ParagraphStyle('small', fontName='Helvetica', fontSize=8.5, leading=12, textColor=MUTED, spaceAfter=6),
    'cell': ParagraphStyle('cell', fontName='Helvetica', fontSize=9, leading=12.5, textColor=INK),
}

def p(text, style='body'):
    return Paragraph(text, styles[style])

def table(rows, widths, header=False):
    data = [[p(str(cell), 'cell') for cell in row] for row in rows]
    t = Table(data, colWidths=widths, hAlign='LEFT')
    cmds = [('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('RIGHTPADDING', (0, 0), (-1, -1), 10), ('TOPPADDING', (0, 0), (-1, -1), 9),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 9), ('LINEBELOW', (0, 0), (-1, -1), .4, colors.HexColor('#D8E3DB'))]
    if header:
        cmds.append(('BACKGROUND', (0, 0), (-1, 0), PALE))
    t.setStyle(TableStyle(cmds))
    return t

def footer(c, doc):
    c.setStrokeColor(colors.HexColor('#D8E3DB'))
    c.line(42, 38, 553, 38)
    c.setFillColor(MUTED)
    c.setFont('Helvetica', 8)
    c.drawString(42, 25, 'Meera Labs | Product & growth handoff | 25 October 2026')
    c.drawRightString(553, 25, str(doc.page))

story = [p('Ads & product handoff', 'title'), p('For Arya | Meera Labs | 25 October 2026', 'sub')]
story += [table([
    ['<b>RELEASE</b>', 'Tracking repairs published to <b>www.himeera.com</b>.'],
    ['<b>META RECEIPT</b>', '<b>PageView</b> and <b>Complete registration</b> are active. Events Manager showed 652 and 9 events respectively; Diagnostics showed no active errors.'],
    ['<b>PAYMENT SIGNALS</b>', 'Server-verified checkout/purchase counts are integrated. First real payment receipt in Meta still needs verification. No live charge was made.'],
], [112, 399])]
story += [p('What changed', 'h')]
for text in [
    '<b>Attribution:</b> registered direct UTM URLs now create first-party attribution cookies before Google signup. Growth links and the home-to-sign-in redirect retain valid Meta click IDs.',
    '<b>Signup accuracy:</b> returning sign-ins cannot create new signup attributions. Retries recover the original signup event ID; blocked or slow pixel loads retain pending events for a bounded retry.',
    '<b>Payment accuracy:</b> client-supplied amounts or success flags cannot create purchases. Payment ownership, stored status and a positive amount are checked; free/bypass and refunded payments are excluded.',
    '<b>Performance:</b> homepage first-load JavaScript fell from 768 kB to 262 kB in the Vercel build report (about 66%). Chat loads when needed; Cashfree loads when Indian checkout opens.',
    '<b>Landing page:</b> public content renders while the session is checked. The sign-in page supports browser zoom, uses its own canonical URL, and has stronger text contrast.',
]:
    story.append(p(text))
story += [p('Meta restriction: counts only', 'h'), p(
    'The live dataset is categorized as <b>Health and wellness - other</b>, with <b>Core Setup</b> active. '
    'Checkout and purchase events send no value, currency, product details or other custom parameters. '
    'Use Meera analytics for verified revenue; do not claim Meta revenue/ROAS measurement is complete.'),
    p('Evidence and limits', 'h'), p(
        '<b>Passed:</b> 14 focused tests, TypeScript, targeted lint on 24 source files, the Vercel production build, '
        'and 14 checks against the staged deployment. No runtime errors appeared in the one-hour scan of the audited API routes. '
        'The Meta totals above describe the displayed reporting window (27 Sep - 24 Oct); they are not campaign-attributed customers.', 'small'),
    p('<b>Mobile audit:</b> Accessibility 100, Best Practices 100, SEO 100. First paint 1.5 s; layout shift 0. '
      'Lighthouse returned NO_LCP, so the aggregate performance score is unscored; no field Core Web Vitals pass is claimed.', 'small'),
    PageBreak(), p("Arya's operating sheet", 'title'), p('Use one registered link per campaign or creative test. Keep the current spending cap unchanged.', 'sub')]
link = 'https://www.himeera.com/r/meta-us-lifetime-99-oct2026'
story += [p('Campaign link ready to use', 'h'), p(f'<link href="{link}" color="#174B3B">{link}</link>'),
          table([
              ['<b>Source</b>', '<b>Medium</b>', '<b>Campaign</b>'],
              ['meta', 'paid_social', 'us_lifetime_99_oct2026'],
          ], [100, 120, 291], True),
          p('The direct /sign-in URL with this same UTM tuple is also supported. This repairs future attribution; earlier untracked visits cannot be reconstructed. Create new links in Meera Analytics &gt; Links before new tests.', 'small'),
          p('Daily scorecard', 'h'),
          table([
              ['<b>Record</b>', '<b>Source / definition</b>'],
              ['Spend, impressions, link CTR, CPC, landing-page views', 'Meta Ads Manager, account 1628584825378260.'],
              ['New signups, activation, paid customers', 'Meera analytics, filtered to the registered campaign. Exclude internal QA. Record the exact activation definition.'],
              ['Revenue and costs', 'Verified paid records; keep INR and USD separate. Signup CPA = spend / attributed new signups; leave undefined when signups are zero.'],
          ], [206, 305], True),
          p('Align reporting windows: the saved ad configuration uses Asia/Kolkata; Meera dashboard calendar boundaries are UTC. Convert timestamps to the same window before comparing totals. Pixel receipts, ad-attributed conversions and first-party signups are different measures.', 'small'),
          p('Next actions and remaining gates', 'h')]
for text in [
    '<b>1. Account access:</b> sign in to the Instagram identity that owns ad account 1628584825378260. The available Facebook session could access the correct dataset but did not list that ad account; Instagram was signed out. Current spend/CPA/ROAS was not independently verified.',
    '<b>2. Validate the next conversion:</b> follow the registered link, complete a fresh confirmed signup, and check one first-party attribution plus one deduplicated registration in Events Manager. Mark internal tests as QA. Check Purchase receipt after the next legitimate paid transaction.',
    '<b>3. Keep the test controlled:</b> the last saved configuration was a USD 19 lifetime replacement campaign ending 30 Oct 2026 at 02:52 IST, optimizing landing-page views. Recheck the live settings before changing optimization or increasing budget.',
    '<b>4. Known measurement limits:</b> CAPI is not configured; browser blocking can still undercount. Core Setup limits shared data. Do not invent conversions or rename restricted events to evade a restriction.',
]:
    story.append(p(text, 'small'))
story.append(p('Reference: dataset 933654956266333, Meera Labs Inc. | Release dpl_73sBZ17kGjZpqyvtgMsmuJvvGN5C. Engineering details and test evidence accompany this handoff.', 'small'))
doc = SimpleDocTemplate(str(OUT), pagesize=(595.28, 841.89), rightMargin=42, leftMargin=42, topMargin=40, bottomMargin=50,
                        title='Meera Ads and Product Handoff for Arya', author='Meera Labs')
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
