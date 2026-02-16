import { NextResponse } from 'next/server';

// Menu verification endpoints are temporarily disabled.
export async function GET() {
    return NextResponse.json({ success: false, error: 'Menu verification disabled' }, { status: 410 });
}

export async function PATCH() {
    return NextResponse.json({ success: false, error: 'Menu verification disabled' }, { status: 410 });
}
