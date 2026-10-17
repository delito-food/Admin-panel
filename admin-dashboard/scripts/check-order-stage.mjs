/**
 * Parity check: the admin panel's order-stage mapping must agree with the Cloud
 * Functions one row for row.
 *
 *   cd admin-dashboard && node scripts/check-order-stage.mjs   (Node 22.18+, which strips TS types)
 */
import { readFileSync } from 'node:fs';
import { customerStageOf, opsStageOf, travelMinutes } from '../src/lib/order-stage.ts';

/** @type {[string, string, boolean, string, string][]} */
const table = JSON.parse(
    readFileSync(new URL('../../functions/test/fixtures/orderStageTable.json', import.meta.url), 'utf8'),
);

let failures = 0;
for (const [status, task, pin, customer, ops] of table) {
    const c = customerStageOf(status, task, pin);
    const o = opsStageOf(status, task, pin);
    if (c !== customer || o !== ops) {
        failures++;
        console.error(`MISMATCH ${JSON.stringify([status, task, pin])}: got ${c}/${o}, want ${customer}/${ops}`);
    }
}
for (const [km, want] of [[3, 14], [0, 15], [1, 8], [30, 60]]) {
    if (travelMinutes(km) !== want) { failures++; console.error(`travelMinutes(${km}) = ${travelMinutes(km)}, want ${want}`); }
}
console.log(failures ? `${failures} mismatch(es)` : `OK — ${table.length} rows agree with functions/orderStage.js`);
process.exit(failures ? 1 : 0);
