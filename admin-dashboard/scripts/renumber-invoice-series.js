/**
 * Continue the invoice series from the CA's filed position, in delivery order.
 *
 *   node scripts/renumber-invoice-series.js             # DRY RUN — writes the plan workbooks only
 *   node scripts/renumber-invoice-series.js --confirm   # apply it to Firestore
 *
 * Options (defaults are the CA's message "last bill details as on 31.7.26"):
 *   --cutoff 2026-07-31               last day the CA has filed
 *   --last-invoice INV-2026-000078    last customer invoice the CA has
 *   --last-commission DLT-COM-2607-069  last commission invoice the CA has
 *   --out ./invoice-continuation      where the workbooks go
 *
 * What it does
 * ────────────
 * CUSTOMER INVOICES — every order delivered after the cut-off, up to now, gets a
 * number continuing from the CA's last one, oldest delivery first:
 *   INV-2026-000079, INV-2026-000080, …
 *   • invoices already numbered above 78 (or in the retired DLT/26-27 series)
 *     are renumbered into this sequence;
 *   • delivered orders that never had an invoice get one (full document,
 *     same builder the dashboard uses);
 *   • the invoice date becomes the delivery date (date of supply);
 *   • an invoice numbered above 78 but DELIVERED on/before the cut-off goes
 *     first, and is flagged — it was missed from a return already filed;
 *   • numbers ≤ 78 are never touched.
 *
 * COMMISSION INVOICES — every vendor-month after the cut-off month, for
 * completed months, gets a number continuing from 069, month by month:
 *   DLT-COM-2608-070, DLT-COM-2608-071, …
 *   dated the last day of the billing month.
 *
 * A number on an order/vendor-month that has nothing to bill (cancelled, no
 * delivered orders) and no credit/debit note against it is VOIDED — removed
 * from the record and listed in the exceptions workbook. This is only safe
 * because no PDF with those numbers has gone to a customer or restaurant.
 *
 * Credit and debit notes that point at a renumbered invoice are updated to the
 * new number. The FY counters (counters/inv_26-27, counters/com_26-27) are set
 * to the last number used, so the dashboard carries on from there.
 *
 * While --confirm runs, both counters are locked, so nobody can issue an invoice
 * from the dashboard half-way through. Re-running is safe: it recomputes from
 * the current data and produces the same numbers.
 *
 * Run it again before each monthly filing (with the CA's new position) to
 * number everything delivered since, in date order.
 */

const admin = require('firebase-admin');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const CONFIRM = process.argv.includes('--confirm');
const CUTOFF = arg('cutoff', '2026-07-31');
const LAST_INVOICE = arg('last-invoice', 'INV-2026-000078');
const LAST_COMMISSION = arg('last-commission', 'DLT-COM-2607-069');
const OUT_DIR = path.resolve(ROOT, arg('out', 'invoice-continuation'));
const RUN_ID = new Date().toISOString();
const ISSUED_BY = 'renumber-invoice-series';

// ── Compile the shared logic so the script and the dashboard agree ──
const BUILD = path.join(ROOT, 'node_modules', '.cache', 'delito-renumber');
fs.mkdirSync(BUILD, { recursive: true });
process.stdout.write('Compiling shared logic… ');
try {
    execFileSync(process.execPath, [
        TSC,
        path.join(ROOT, 'src/lib/invoice-compose.ts'),
        path.join(ROOT, 'src/lib/invoice-series.ts'),
        path.join(ROOT, 'src/lib/xlsx-writer.ts'),
        path.join(ROOT, 'src/lib/fiscal.ts'),
        '--outDir', BUILD,
        '--module', 'commonjs',
        '--target', 'es2020',
        '--esModuleInterop',
        '--skipLibCheck',
        '--rootDir', path.join(ROOT, 'src/lib'),
    ], { cwd: ROOT, stdio: 'pipe' });
} catch (err) {
    console.log('FAILED');
    console.error(err.stdout?.toString() || err.message);
    process.exit(1);
}
console.log('ok');

const { buildInvoiceDraft } = require(path.join(BUILD, 'invoice-compose.js'));
const { formatSerial, counterDocId } = require(path.join(BUILD, 'invoice-series.js'));
const { buildXlsx } = require(path.join(BUILD, 'xlsx-writer.js'));
const { istMonthBounds, istInstant, financialYearOf, toDate } = require(path.join(BUILD, 'fiscal.js'));
const { isBillableStatus } = require(path.join(BUILD, 'pricing-engine.js'));

// ── Plan (pure; exported for the test harness) ─────────────────────────────

const ORIGINAL_INV = /^(DELITO[-_\s]*)?INV-\d{4}-(\d+)$/i;
const ORIGINAL_COM = /^DLT-COM-\d{4}-(\d+)$/i;

function seqOf(serial) {
    const m = String(serial || '').trim().match(/(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
}

function cutoffEndOf(day) {
    const [y, m, d] = day.split('-').map((x) => parseInt(x, 10));
    return istInstant(y, m, d, 23, 59, 59, 999);
}

function monthKey(date) {
    const ist = new Date(date.getTime() + 5.5 * 3600 * 1000);
    return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

function nextMonth(key) {
    let [y, m] = key.split('-').map((x) => parseInt(x, 10));
    m += 1; if (m > 12) { m = 1; y += 1; }
    return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * Work out every number. Reads nothing and writes nothing.
 *
 * input = { orders: {id: data}, invoices: {id: data}, commissionInvoices: {id: data},
 *           vendors: {id: data}, deliveryPersons: {id: data},
 *           notedInvoiceIds: Set, notedCommissionIds: Set, now: Date }
 */
function planContinuation(input, opts) {
    const cutoffEnd = cutoffEndOf(opts.cutoff);
    const lastInvSeq = seqOf(opts.lastInvoice);
    const lastComSeq = seqOf(opts.lastCommission);
    const fy = financialYearOf(cutoffEnd);
    const until = input.now.getTime() > fy.period.end.getTime() ? fy.period.end : input.now;

    const customer = [];      // rows in the new sequence
    const commission = [];
    const exceptions = [];

    const deliveredAt = (o) => toDate(o?.deliveredAt) || toDate(o?.createdAt);

    // ── Customer ──
    const numbered = new Set();
    const filedRange = [];   // numbers ≤ the CA's last that stay as they are
    for (const [id, inv] of Object.entries(input.invoices)) {
        if (!inv.invoiceNumber) continue;
        numbered.add(id);
        if (inv.orderId) numbered.add(inv.orderId);
        const serial = String(inv.invoiceNumber).trim();
        const seq = seqOf(serial);
        const order = input.orders[inv.orderId || id];
        const when = deliveredAt(order) || toDate(inv.orderDate) || toDate(inv.issuedAt) || toDate(inv.createdAt);
        const original = ORIGINAL_INV.test(serial);

        // A number inside the CA's range stays only if the order was delivered
        // on/before the cut-off. The CA's position is "as on" the cut-off date,
        // so an order delivered AFTER it cannot be in that filing, whatever
        // number it carries (the old counter re-issued low numbers — F-01).
        // Such orders move into the continued series with everything else.
        let movedFromFiledRange = false;
        if (original && seq != null && seq <= lastInvSeq) {
            if (!(when && when > cutoffEnd)) {
                filedRange.push({ seq, serial, id, when });
                continue;
            }
            movedFromFiledRange = true;
            exceptions.push({ type: 'Moved into continuation — old number, delivered after cut-off', series: 'Customer', number: serial, ref: id, date: when, note: `Number is within ${opts.lastInvoice}, but the order was delivered after ${opts.cutoff}, so it cannot be in the filed return. Given a new number in the continued series; the old number is left to whichever July bill the CA has against it.` });
        }

        const billable = order && isBillableStatus(order.status);
        const noted = input.notedInvoiceIds.has(id);
        if (!billable && !noted) {
            exceptions.push({ type: 'Voided — nothing to bill', series: 'Customer', number: serial, ref: id, date: when, note: order ? `Order status "${order.status}", no credit/debit note.` : 'Order not found, no credit/debit note.' });
            customer.push({ action: 'void', docId: id, oldNumber: serial });
            continue;
        }
        if (when && when > until) continue; // not yet — next run
        customer.push({
            action: inv.schemaVersion ? 'renumber' : 'renumber+document',
            docId: id, orderId: inv.orderId || id, oldNumber: serial, oldDate: inv.invoiceDate || null,
            date: when || cutoffEnd,
            flag: when && when <= cutoffEnd
                ? 'Delivered on/before cut-off — add to the return already filed (amendment)'
                : (movedFromFiledRange ? `Had old number ${serial} (inside the CA range) but delivered after the cut-off` : ''),
            order,
        });
    }

    const bySeq = {};
    filedRange.forEach((r) => { (bySeq[r.seq] = bySeq[r.seq] || []).push(r); });
    Object.values(bySeq).filter((g) => g.length > 1).forEach((g) => g.forEach((r) => {
        exceptions.push({ type: 'Duplicate number inside the filed range', series: 'Customer', number: r.serial, ref: r.id, date: r.when, note: `${g.length} bills delivered on/before the cut-off share sequence ${r.seq}: ${g.map((x) => x.serial).join(', ')}. Check which one the CA has.` });
    }));

    for (const [id, order] of Object.entries(input.orders)) {
        if (numbered.has(id) || !isBillableStatus(order.status)) continue;
        const when = deliveredAt(order);
        if (!when) continue;
        if (when <= cutoffEnd) {
            // Only July-and-earlier orders with no invoice at all: reported, not numbered.
            if (monthKey(when) === monthKey(cutoffEnd)) {
                exceptions.push({ type: 'No invoice — delivered on/before cut-off', series: 'Customer', number: '', ref: id, date: when, note: 'Not numbered. Ask the CA whether it was covered in the filed return.' });
            }
            continue;
        }
        if (when > until) continue;
        customer.push({ action: 'new', docId: id, orderId: id, oldNumber: '', date: when, flag: '', order });
    }

    // Compose documents for everything that lacks one; drop what cannot be issued.
    const numberedCustomer = [];
    for (const row of customer) {
        if (row.action === 'void') continue;
        if (row.action !== 'renumber') {
            const o = row.order;
            const composed = buildInvoiceDraft(row.orderId, o, input.vendors[o.vendorId] || {}, input.deliveryPersons[o.deliveryPersonId] || {});
            if (!composed.issuable.ok) {
                if (row.action === 'new') {
                    exceptions.push({ type: 'Cannot issue — amounts do not add up', series: 'Customer', number: '', ref: row.orderId, date: row.date, note: composed.issuable.reason + ' Fix the order, then run again.' });
                    continue;
                }
                row.action = 'renumber (number only)';
                row.flag = [row.flag, `Number reserved, document not built: ${composed.issuable.reason}`].filter(Boolean).join(' · ');
            } else {
                row.draft = composed.draft;
            }
        }
        numberedCustomer.push(row);
    }

    numberedCustomer.sort((a, b) => a.date - b.date || String(a.orderId).localeCompare(String(b.orderId)));
    let seq = lastInvSeq;
    for (const row of numberedCustomer) {
        seq += 1;
        row.sequence = seq;
        row.newNumber = formatSerial('invoice', fy.label, seq);
        row.vendorName = row.order?.vendorName || input.vendors[row.order?.vendorId]?.shopName || '';
        row.value = row.draft?.totals?.invoiceValue ?? input.invoices[row.docId]?.totals?.invoiceValue ?? row.order?.total ?? 0;
    }

    // ── Commission ──
    const cutoffMonth = monthKey(cutoffEnd);
    const lastCompleteMonth = monthKey(new Date(istMonthBounds(monthKey(until)).start.getTime() - 1));
    const comRows = [];
    const haveCom = new Set();

    const billableByVendorMonth = {};
    for (const o of Object.values(input.orders)) {
        if (!isBillableStatus(o.status) || !o.vendorId) continue;
        const when = deliveredAt(o);
        if (!when) continue;
        const k = `${o.vendorId}_${monthKey(when)}`;
        billableByVendorMonth[k] = (billableByVendorMonth[k] || 0) + 1;
    }

    for (const [id, ci] of Object.entries(input.commissionInvoices)) {
        if (!ci.invoiceNumber) continue;
        haveCom.add(id);
        const serial = String(ci.invoiceNumber).trim();
        const s = seqOf(serial);
        if (ORIGINAL_COM.test(serial) && s != null && s <= lastComSeq) continue;
        const month = ci.month || id.split('_').pop();
        const bounds = istMonthBounds(month);
        const orders = billableByVendorMonth[`${ci.vendorId}_${month}`] || 0;
        if (!orders && !input.notedCommissionIds.has(id)) {
            exceptions.push({ type: 'Voided — nothing to bill', series: 'Commission', number: serial, ref: id, date: bounds?.end || null, note: 'No delivered orders in that month, no credit/debit note.' });
            comRows.push({ action: 'void', docId: id, oldNumber: serial });
            continue;
        }
        if (month > lastCompleteMonth && !input.notedCommissionIds.has(id)) {
            // A commission bill for a month that has not finished covers only
            // part of it. Release the number; the whole month is billed on the
            // first run after the month ends.
            exceptions.push({ type: 'Held back — month not finished', series: 'Commission', number: serial, ref: id, date: toDate(ci.issuedAt), note: `Created before ${month} ended, so it covers part of the month. Number released; the full month gets a number when the script runs after month end.` });
            comRows.push({ action: 'void', docId: id, oldNumber: serial, reason: 'Month not finished when this bill was created; the full month is billed after month end.' });
            continue;
        }
        const monthEnd = bounds.end;
        const date = monthEnd > until ? (toDate(ci.issuedAt) || until) : monthEnd;
        comRows.push({
            action: 'renumber', docId: id, vendorId: ci.vendorId, month, oldNumber: serial, date, orders,
            flag: month <= cutoffMonth ? 'Billing month already filed — add to that return (amendment)' : '',
        });
    }

    for (let m = nextMonth(cutoffMonth); m <= lastCompleteMonth; m = nextMonth(m)) {
        for (const [k, count] of Object.entries(billableByVendorMonth)) {
            if (!k.endsWith(`_${m}`)) continue;
            if (haveCom.has(k)) continue;
            const vendorId = k.slice(0, -(m.length + 1));
            comRows.push({ action: 'new', docId: k, vendorId, month: m, oldNumber: '', date: istMonthBounds(m).end, orders: count, flag: '' });
        }
    }

    const vname = (id) => input.vendors[id]?.shopName || input.vendors[id]?.fullName || id;
    const numberedCom = comRows.filter((r) => r.action !== 'void');
    numberedCom.sort((a, b) => a.date - b.date || a.month.localeCompare(b.month) || vname(a.vendorId).localeCompare(vname(b.vendorId)) || a.docId.localeCompare(b.docId));
    let cseq = lastComSeq;
    for (const row of numberedCom) {
        cseq += 1;
        row.sequence = cseq;
        row.newNumber = formatSerial('commission', financialYearOf(istMonthBounds(row.month).end).label, cseq, row.month);
        row.vendorName = vname(row.vendorId);
        if (!input.vendors[row.vendorId]) {
            row.flag = [row.flag, 'Restaurant not found in vendors — check GSTIN/name before issuing'].filter(Boolean).join(' · ');
            exceptions.push({ type: 'Restaurant record missing', series: 'Commission', number: row.newNumber, ref: row.vendorId, date: row.date, note: `${row.orders} delivered order(s) in ${row.month} belong to vendor id ${row.vendorId}, which is not in the vendors collection. The bill would have no name or GSTIN.` });
        }
    }
    for (const r of comRows) if (r.action === 'void') commission.push(r);
    commission.push(...numberedCom);

    return {
        fy, cutoffEnd, until, lastCompleteMonth,
        customer: [...customer.filter((r) => r.action === 'void'), ...numberedCustomer],
        commission,
        exceptions,
        lastCustomerSeq: seq,
        lastCommissionSeq: cseq,
    };
}

module.exports = { planContinuation, seqOf };

// ── Firestore run ──────────────────────────────────────────────────────────

const ist = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '');

function saveSheet(spec, filename) {
    fs.writeFileSync(path.join(OUT_DIR, filename), Buffer.from(buildXlsx(spec)));
    return path.join(OUT_DIR, filename);
}

async function main() {
    const env = {};
    fs.readFileSync(path.resolve(ROOT, '.env.local'), 'utf8').split('\n').forEach((line) => {
        const m = line.replace('\r', '').match(/^([^#\s][^=]+)="?(.*?)"?$/);
        if (!m) return;
        let v = m[2];
        if (v.includes('\\n')) v = v.replace(/\\n/g, '\n');
        env[m[1]] = v;
    });
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: env.FIREBASE_PROJECT_ID,
            clientEmail: env.FIREBASE_CLIENT_EMAIL,
            privateKey: env.FIREBASE_PRIVATE_KEY,
        }),
    });
    const db = admin.firestore();
    const { FieldValue, Timestamp } = admin.firestore;

    console.log(`\nDelito — continue the invoice series  (${CONFIRM ? 'APPLYING' : 'DRY RUN'})`);
    console.log(`CA position: ${LAST_INVOICE} / ${LAST_COMMISSION} as on ${CUTOFF}\n`);

    const all = async (name) => {
        const snap = await db.collection(name).get();
        const out = {};
        snap.docs.forEach((d) => { out[d.id] = d.data(); });
        return out;
    };
    process.stdout.write('Reading Firestore… ');
    const [orders, invoices, commissionInvoices, vendors, creditNotes, debitNotes, comCreditNotes, comDebitNotes] = await Promise.all([
        all('orders'), all('invoices'), all('commissionInvoices'), all('vendors'),
        all('creditNotes'), all('debitNotes'), all('commissionCreditNotes'), all('commissionDebitNotes'),
    ]);
    const dpIds = [...new Set(Object.values(orders).map((o) => o.deliveryPersonId).filter(Boolean))];
    const deliveryPersons = {};
    for (let i = 0; i < dpIds.length; i += 300) {
        const snaps = await db.getAll(...dpIds.slice(i, i + 300).map((id) => db.collection('deliveryPersons').doc(id)));
        snaps.forEach((s) => { if (s.exists) deliveryPersons[s.id] = s.data(); });
    }
    console.log(`${Object.keys(orders).length} orders, ${Object.keys(invoices).length} invoices, ${Object.keys(commissionInvoices).length} commission invoices`);

    // Which invoices have notes against them (these can never be voided).
    const invoiceNumberToId = {};
    Object.entries(invoices).forEach(([id, d]) => { if (d.invoiceNumber) invoiceNumberToId[String(d.invoiceNumber)] = id; });
    const comNumberToId = {};
    Object.entries(commissionInvoices).forEach(([id, d]) => { if (d.invoiceNumber) comNumberToId[String(d.invoiceNumber)] = id; });

    const notedInvoiceIds = new Set();
    const notedCommissionIds = new Set();
    const noteRefs = []; // { collection, noteId, target: 'customer'|'commission', invoiceId }
    for (const [coll, data] of [['creditNotes', creditNotes], ['debitNotes', debitNotes]]) {
        for (const [nid, n] of Object.entries(data)) {
            if (coll === 'debitNotes' && n.target === 'commission') continue;
            const invId = n.originalInvoiceId || n.orderId || invoiceNumberToId[n.originalInvoiceNumber];
            if (invId) { notedInvoiceIds.add(invId); noteRefs.push({ collection: coll, noteId: nid, target: 'customer', invoiceId: invId, current: n.originalInvoiceNumber }); }
        }
    }
    for (const [coll, data] of [['commissionCreditNotes', comCreditNotes], ['commissionDebitNotes', comDebitNotes], ['debitNotes', debitNotes]]) {
        for (const [nid, n] of Object.entries(data)) {
            if (coll === 'debitNotes' && n.target !== 'commission') continue;
            const invId = n.originalInvoiceId || comNumberToId[n.originalInvoiceNumber];
            if (invId) { notedCommissionIds.add(invId); noteRefs.push({ collection: coll, noteId: nid, target: 'commission', invoiceId: invId, current: n.originalInvoiceNumber }); }
        }
    }

    const plan = planContinuation(
        { orders, invoices, commissionInvoices, vendors, deliveryPersons, notedInvoiceIds, notedCommissionIds, now: new Date() },
        { cutoff: CUTOFF, lastInvoice: LAST_INVOICE, lastCommission: LAST_COMMISSION }
    );

    const custNumbered = plan.customer.filter((r) => r.action !== 'void');
    const comNumbered = plan.commission.filter((r) => r.action !== 'void');
    const first = (rows) => rows[0]?.newNumber || '—';
    const last = (rows) => rows[rows.length - 1]?.newNumber || '—';

    console.log('\n─── Customer invoices ───────────────────────────');
    console.log(`  numbered ${custNumbered.length}: ${first(custNumbered)} → ${last(custNumbered)}`);
    console.log(`    renumbered existing   ${custNumbered.filter((r) => r.action.startsWith('renumber')).length}`);
    console.log(`    new invoices created  ${custNumbered.filter((r) => r.action === 'new').length}`);
    console.log(`    ⚠ delivered on/before cut-off   ${custNumbered.filter((r) => r.flag.startsWith('Delivered')).length}`);
    console.log(`  voided ${plan.customer.filter((r) => r.action === 'void').length}`);
    console.log('\n─── Commission invoices ─────────────────────────');
    console.log(`  numbered ${comNumbered.length}: ${first(comNumbered)} → ${last(comNumbered)}   (complete months up to ${plan.lastCompleteMonth})`);
    console.log(`  voided ${plan.commission.filter((r) => r.action === 'void').length}`);
    console.log(`\n  exceptions to review: ${plan.exceptions.length}`);

    // ── Workbooks ──
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const META = [
        { label: 'Legal name', value: 'Delito' },
        { label: 'GSTIN', value: '09CAMPV6339R1ZD' },
        { label: 'CA position', value: `${LAST_INVOICE} / ${LAST_COMMISSION} as on ${CUTOFF}` },
        { label: 'Covers', value: `${ist(plan.cutoffEnd)} → ${ist(plan.until)}` },
        { label: 'Status', value: CONFIRM ? `APPLIED ${RUN_ID}` : `DRY RUN ${RUN_ID} — nothing changed yet` },
    ];
    const files = [];
    files.push(saveSheet({
        sheetName: 'Customer invoices',
        title: 'Customer tax invoices — continued series',
        subtitle: `${first(custNumbered)} to ${last(custNumbered)}, in order of delivery`,
        meta: META,
        columns: [
            { header: 'Invoice No.', key: 'newNumber', width: 18 },
            { header: 'Invoice date (delivered, IST)', key: 'date', width: 24 },
            { header: 'Order ID', key: 'orderId', width: 24 },
            { header: 'Restaurant', key: 'vendorName', width: 24 },
            { header: 'Invoice value', key: 'value', width: 14, type: 'currency' },
            { header: 'Previous number', key: 'oldNumber', width: 18 },
            { header: 'Action', key: 'action', width: 20 },
            { header: 'Note', key: 'flag', width: 60 },
        ],
        rows: custNumbered.map((r) => ({ ...r, date: ist(r.date) })),
        totals: { newNumber: `${custNumbered.length} invoices`, value: Math.round(custNumbered.reduce((s, r) => s + (Number(r.value) || 0), 0) * 100) / 100 },
    }, 'customer-invoices-continued.xlsx'));
    files.push(saveSheet({
        sheetName: 'Commission invoices',
        title: 'Commission invoices — continued series',
        subtitle: `${first(comNumbered)} to ${last(comNumbered)}, month by month`,
        meta: META,
        columns: [
            { header: 'Invoice No.', key: 'newNumber', width: 18 },
            { header: 'Invoice date (IST)', key: 'date', width: 22 },
            { header: 'Billing month', key: 'month', width: 12 },
            { header: 'Restaurant', key: 'vendorName', width: 28 },
            { header: 'Delivered orders', key: 'orders', width: 10, type: 'number' },
            { header: 'Previous number', key: 'oldNumber', width: 18 },
            { header: 'Action', key: 'action', width: 12 },
            { header: 'Note', key: 'flag', width: 50 },
        ],
        rows: comNumbered.map((r) => ({ ...r, date: ist(r.date) })),
    }, 'commission-invoices-continued.xlsx'));
    files.push(saveSheet({
        sheetName: 'Exceptions',
        title: 'Items to review with the CA',
        subtitle: 'Voided numbers, orders that could not be invoiced, and items around the cut-off',
        meta: META,
        columns: [
            { header: 'Type', key: 'type', width: 40 },
            { header: 'Series', key: 'series', width: 12 },
            { header: 'Number', key: 'number', width: 18 },
            { header: 'Order / doc', key: 'ref', width: 30 },
            { header: 'Date (IST)', key: 'date', width: 22 },
            { header: 'Note', key: 'note', width: 60 },
        ],
        rows: plan.exceptions.map((e) => ({ ...e, date: ist(e.date) })),
    }, 'exceptions.xlsx'));
    console.log('\nWorkbooks:'); files.forEach((f) => console.log('  ' + path.relative(ROOT, f)));

    if (!CONFIRM) {
        console.log('\nDRY RUN — Firestore not changed. Check the workbooks, then run again with --confirm.');
        return;
    }

    // ── Apply ──
    const invCounter = db.collection('counters').doc(counterDocId('invoice', plan.fy.label));
    const comCounter = db.collection('counters').doc(counterDocId('commission', plan.fy.label));
    const lockNote = `locked by ${ISSUED_BY} ${RUN_ID}`;
    // A non-number lastNumber makes the dashboard refuse to issue (fail closed).
    await invCounter.set({ lastNumber: 'LOCKED', lockNote }, { merge: true });
    await comCounter.set({ lastNumber: 'LOCKED', lockNote }, { merge: true });
    console.log('\nCounters locked. Writing…');

    const ops = [];
    const newNumberOf = { customer: {}, commission: {} };
    const newDateOf = {};
    const renumbering = (row) => ({ previousNumber: row.oldNumber || null, previousInvoiceDate: row.oldDate || null, run: RUN_ID });

    for (const row of plan.customer) {
        const ref = db.collection('invoices').doc(row.docId);
        if (row.action === 'void') {
            ops.push((b) => b.set(ref, { invoiceNumber: FieldValue.delete(), voidedInvoiceNumber: row.oldNumber, voidedAt: RUN_ID, voidReason: 'Nothing to bill; number never sent to a customer. Voided when the series was continued from the CA position.' }, { merge: true }));
            continue;
        }
        const invoiceDate = new Date(row.date).toISOString();
        newNumberOf.customer[row.docId] = row.newNumber;
        newDateOf[row.docId] = invoiceDate;
        const identity = { invoiceNumber: row.newNumber, series: 'INV', sequence: row.sequence, financialYear: plan.fy.label, invoiceDate, renumbering: renumbering(row) };
        if (row.draft) {
            const now = Timestamp.now();
            ops.push((b) => b.set(ref, { ...row.draft, ...identity, issuedAt: now.toDate().toISOString(), issuedAtTs: now, issuedBy: ISSUED_BY }, { merge: true }));
        } else {
            ops.push((b) => b.set(ref, identity, { merge: true }));
        }
    }
    for (const row of plan.commission) {
        const ref = db.collection('commissionInvoices').doc(row.docId);
        if (row.action === 'void') {
            ops.push((b) => b.set(ref, { invoiceNumber: FieldValue.delete(), voidedInvoiceNumber: row.oldNumber, voidedAt: RUN_ID, voidReason: row.reason || 'Nothing to bill; number never sent to the restaurant. Voided when the series was continued from the CA position.' }, { merge: true }));
            continue;
        }
        newNumberOf.commission[row.docId] = row.newNumber;
        const prev = commissionInvoices[row.docId];
        ops.push((b) => b.set(ref, {
            invoiceNumber: row.newNumber, sequence: row.sequence, series: 'DLT-COM',
            financialYear: financialYearOf(istMonthBounds(row.month).end).label,
            vendorId: row.vendorId, month: row.month,
            issuedAt: Timestamp.fromDate(new Date(row.date)),
            ...(prev ? { originalIssuedAt: prev.originalIssuedAt || prev.issuedAt || null } : { issuedBy: ISSUED_BY }),
            renumbering: renumbering(row),
        }, { merge: true }));
    }
    for (const n of noteRefs) {
        const map = n.target === 'customer' ? newNumberOf.customer : newNumberOf.commission;
        const nn = map[n.invoiceId];
        if (!nn || nn === n.current) continue;
        const patch = { originalInvoiceNumber: nn, originalInvoiceNumberBefore: n.current || null, originalInvoiceRenumberedAt: RUN_ID };
        if (n.target === 'customer' && newDateOf[n.invoiceId]) patch.originalInvoiceDate = newDateOf[n.invoiceId];
        ops.push((b) => b.set(db.collection(n.collection).doc(n.noteId), patch, { merge: true }));
    }

    for (let i = 0; i < ops.length; i += 400) {
        const batch = db.batch();
        ops.slice(i, i + 400).forEach((op) => op(batch));
        await batch.commit();
        process.stdout.write(`  ${Math.min(i + 400, ops.length)}/${ops.length}\r`);
    }

    const stamp = Timestamp.now();
    await invCounter.set({ lastNumber: plan.lastCustomerSeq, series: 'INV', financialYear: plan.fy.label, updatedAt: stamp, lockNote: FieldValue.delete(), continuedFrom: LAST_INVOICE, continuedAt: RUN_ID }, { merge: true });
    await comCounter.set({ lastNumber: plan.lastCommissionSeq, series: 'DLT-COM', financialYear: plan.fy.label, updatedAt: stamp, lockNote: FieldValue.delete(), continuedFrom: LAST_COMMISSION, continuedAt: RUN_ID }, { merge: true });
    await db.collection('reconciliation').doc('caBaseline').set({
        cutoffDate: CUTOFF, lastInvoiceNumber: LAST_INVOICE, lastCommissionNumber: LAST_COMMISSION,
        statedBy: 'Chartered accountant', continuedAt: RUN_ID,
        continuedTo: { customer: last(custNumbered), commission: last(comNumbered) },
    }, { merge: true });

    console.log(`\nDone. ${ops.length} writes. Next customer invoice: ${formatSerial('invoice', plan.fy.label, plan.lastCustomerSeq + 1)}; next commission: seq ${plan.lastCommissionSeq + 1}.`);
}

if (require.main === module) {
    main().then(() => process.exit(0)).catch((e) => {
        console.error('\nFAILED:', e.message);
        if (CONFIRM) console.error('Counters may still be locked. Fix the problem and run with --confirm again — it is safe to repeat.');
        process.exit(1);
    });
}
