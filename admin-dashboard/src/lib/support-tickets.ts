/**
 * Shared shape for rider support tickets (supportTickets collection).
 * Used by /api/support-tickets routes; kept out of route.ts because Next only
 * allows HTTP-method exports from route files.
 */

export const iso = (v: unknown): string => {
    const t = v as { toDate?: () => Date } | undefined;
    return t?.toDate?.()?.toISOString() || '';
};

export function mapTicket(id: string, d: FirebaseFirestore.DocumentData) {
    return {
        ticketId: id,
        ticketNumber: (d.ticketNumber as string) || `T-${id.slice(-6).toUpperCase()}`,
        riderId: d.riderId || '',
        riderName: d.riderName || 'Rider',
        riderPhone: d.riderPhone || '',
        riderPincode: d.riderPincode || '',
        category: d.category || 'other',
        categoryLabel: d.categoryLabel || 'Other',
        orderId: d.orderId || '',
        orderLabel: d.orderLabel || '',
        message: d.message || '',
        attachments: Array.isArray(d.attachments) ? (d.attachments as unknown[]).filter((u): u is string => typeof u === 'string') : [],
        status: d.status || 'OPEN',
        priority: d.priority || 'MEDIUM',
        callbackRequested: d.callbackRequested === true,
        callbackRequestedAt: iso(d.callbackRequestedAt),
        callbackDoneAt: iso(d.callbackDoneAt),
        lastMessageAt: iso(d.lastMessageAt),
        lastMessageFrom: d.lastMessageFrom || 'rider',
        adminNotes: d.adminNotes || '',
        appVersion: d.appVersion || '',
        createdAt: iso(d.createdAt),
        updatedAt: iso(d.updatedAt),
        resolvedAt: iso(d.resolvedAt),
    };
}

export type SupportTicket = ReturnType<typeof mapTicket>;
