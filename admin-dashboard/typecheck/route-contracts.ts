/**
 * Compile-time contract check for guarded API routes.
 *
 * `next build` regenerates .next/types and validates every route export against
 * Next's handler signature. That check cannot run in CI environments without a
 * full build, and it is exactly the thing that breaks when a route is wrapped
 * incorrectly — so the same assertion is made here, where `tsc --noEmit` catches
 * it in seconds.
 *
 * Type-only: nothing here is emitted or executed.
 */

import type { NextRequest } from 'next/server';

import type { GET as InvoiceGET } from '@/app/api/invoices/[orderId]/route';
import type { GET as CommissionGET, POST as CommissionPOST } from '@/app/api/vendors/commission-invoice/route';
import type { GET as OrdersGET, PATCH as OrdersPATCH } from '@/app/api/orders/route';
import type { GET as GstGET } from '@/app/api/reports/gst/route';
import type { GET as PayoutsGET } from '@/app/api/vendors/payouts/route';
import type { GET as AutoTimeoutGET } from '@/app/api/orders/auto-timeout/route';
import type { DELETE as HeroDELETE } from '@/app/api/hero-banners/route';
import type { GET as MenuItemsGET } from '@/app/api/menu-management/vendor/[vendorId]/items/route';
import type { GET as CreditNotesGET, POST as CreditNotesPOST } from '@/app/api/credit-notes/route';
import type { GET as DebitNotesGET, POST as DebitNotesPOST } from '@/app/api/debit-notes/route';
import type { POST as RefundsPOST } from '@/app/api/refunds/route';
import type { PUT as PayoutsPUT } from '@/app/api/payouts/route';

/** What Next.js calls a route handler with, for a static segment. */
type StaticRoute = (request: NextRequest, context: { params: Promise<Record<string, never>> }) => Promise<Response>;

/** What Next.js calls a route handler with, for a dynamic segment. */
type DynamicRoute<P extends Record<string, string>> = (
    request: NextRequest,
    context: { params: Promise<P> }
) => Promise<Response>;

/** Fails to compile unless T is assignable to Expected. */
type Assert<Expected, T extends Expected> = T;

// Dynamic segments — the context type must thread through the wrapper intact.
type _Invoice = Assert<DynamicRoute<{ orderId: string }>, typeof InvoiceGET>;
type _MenuItems = Assert<DynamicRoute<{ vendorId: string }>, typeof MenuItemsGET>;

// Static segments, across every HTTP verb the codebase uses.
type _CommissionGET = Assert<StaticRoute, typeof CommissionGET>;
type _CommissionPOST = Assert<StaticRoute, typeof CommissionPOST>;
type _OrdersGET = Assert<StaticRoute, typeof OrdersGET>;
type _OrdersPATCH = Assert<StaticRoute, typeof OrdersPATCH>;
type _GstGET = Assert<StaticRoute, typeof GstGET>;
type _PayoutsGET = Assert<StaticRoute, typeof PayoutsGET>;
type _HeroDELETE = Assert<StaticRoute, typeof HeroDELETE>;

// Credit notes and the money paths that raise them.
type _CreditNotesGET = Assert<StaticRoute, typeof CreditNotesGET>;
type _CreditNotesPOST = Assert<StaticRoute, typeof CreditNotesPOST>;
type _DebitNotesGET = Assert<StaticRoute, typeof DebitNotesGET>;
type _DebitNotesPOST = Assert<StaticRoute, typeof DebitNotesPOST>;
type _RefundsPOST = Assert<StaticRoute, typeof RefundsPOST>;
type _PayoutsPUT = Assert<StaticRoute, typeof PayoutsPUT>;

// A handler that declares no parameters at all still has to satisfy the contract.
type _AutoTimeout = Assert<StaticRoute, typeof AutoTimeoutGET>;

export type RouteContractsChecked = [
    _Invoice, _MenuItems, _CommissionGET, _CommissionPOST,
    _OrdersGET, _OrdersPATCH, _GstGET, _PayoutsGET, _HeroDELETE, _AutoTimeout,
    _CreditNotesGET, _CreditNotesPOST, _DebitNotesGET, _DebitNotesPOST,
    _RefundsPOST, _PayoutsPUT
];
