/**
 * GST rates, place of supply, and tax splitting.
 *
 * Place of supply decides whether a supply carries CGST + SGST or IGST. It is
 * determined by state code — the first two digits of a GSTIN — not by
 * substring-matching a free-text city or state field, which previously let a
 * vendor with a blank state fall through to "same state" and be billed the
 * wrong tax head.
 */

/** GST rates as percentages. */
export const RATE = {
    /** Restaurant service supplied through an e-commerce operator. */
    FOOD: 5,
    /** Courier / delivery service. */
    DELIVERY: 18,
    /** Platform / convenience fee. */
    PLATFORM: 18,
    /** Commission charged to a restaurant. */
    COMMISSION: 18,
} as const;

/** HSN / SAC codes. */
export const HSN = {
    FOOD: '9963',
    DELIVERY: '996812',
    PLATFORM: '998599',
    COMMISSION: '998399',
} as const;

/** Delito's own state, from its GSTIN 09CAMPV6339R1ZD. */
export const HOME_STATE_CODE = '09';

/** State codes that appear in a GSTIN, for printing "09-Uttar Pradesh". */
const STATE_NAMES: Record<string, string> = {
    '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
    '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
    '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
    '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
    '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
    '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
    '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
    '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep',
    '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
    '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

/** A GSTIN is 2 state digits, 10 PAN characters, then 3 more. */
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function isValidGstin(gstin?: string | null): boolean {
    if (!gstin) return false;
    return GSTIN_PATTERN.test(gstin.trim().toUpperCase());
}

/** The state code carried by a GSTIN, or null if it isn't one. */
export function stateCodeFromGstin(gstin?: string | null): string | null {
    if (!gstin) return null;
    const clean = gstin.trim().toUpperCase();
    if (!/^[0-9]{2}/.test(clean)) return null;
    const code = clean.slice(0, 2);
    return STATE_NAMES[code] ? code : null;
}

/** "09-Uttar Pradesh", the form GSTR-1 expects. */
export function placeOfSupplyLabel(stateCode: string | null | undefined): string {
    const code = stateCode || HOME_STATE_CODE;
    const name = STATE_NAMES[code] || 'Unknown';
    return `${code}-${name}`;
}

export function stateName(stateCode: string | null | undefined): string {
    return STATE_NAMES[stateCode || HOME_STATE_CODE] || 'Unknown';
}

/**
 * Resolve the recipient's state code.
 *
 * Prefers the GSTIN (authoritative). Falls back to matching a free-text state
 * name exactly — never a substring, which is what made a blank state read as
 * "same state" before.
 */
export function resolveStateCode(gstin?: string | null, stateText?: string | null): string | null {
    const fromGstin = stateCodeFromGstin(gstin);
    if (fromGstin) return fromGstin;

    const text = (stateText || '').trim().toLowerCase();
    if (!text) return null;
    for (const [code, name] of Object.entries(STATE_NAMES)) {
        if (name.toLowerCase() === text) return code;
    }
    return null;
}

export interface TaxSplit {
    cgst: number;
    sgst: number;
    igst: number;
    total: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Split a tax amount into heads.
 *
 * Intra-state splits into CGST and SGST; the second half is computed by
 * subtraction so the two always sum back to the total exactly. Rounding each
 * half independently is how ₹10.01 used to print as 5.01 + 5.01 = ₹10.02.
 */
export function splitTax(taxAmount: number, isInterState: boolean): TaxSplit {
    const total = r2(taxAmount);
    if (isInterState) {
        return { cgst: 0, sgst: 0, igst: total, total };
    }
    const cgst = r2(total / 2);
    return { cgst, sgst: r2(total - cgst), igst: 0, total };
}

/** Is this supply inter-state? */
export function isInterState(supplierStateCode: string, recipientStateCode?: string | null): boolean {
    if (!recipientStateCode) return false; // Unknown recipient: treat as intra-state (B2C default).
    return supplierStateCode !== recipientStateCode;
}

/** Tax on a tax-exclusive base. */
export function taxOn(taxableValue: number, ratePercent: number): number {
    return r2((taxableValue * ratePercent) / 100);
}

/**
 * Split a tax-INCLUSIVE amount into its taxable value and its tax.
 *
 * Order-level discounts (promo codes, Delito coins, HungerGame rewards) are
 * applied by the app after GST has been added, so the rupees the customer saves
 * include the tax on them. Since these discounts reduce the taxable value, the
 * saving has to be split the same way the charge was: taxable value first, then
 * the tax that sat on it.
 */
export function splitInclusive(inclusiveAmount: number, ratePercent: number): { taxableValue: number; tax: number } {
    const taxableValue = r2(inclusiveAmount / (1 + ratePercent / 100));
    return { taxableValue, tax: r2(inclusiveAmount - taxableValue) };
}
