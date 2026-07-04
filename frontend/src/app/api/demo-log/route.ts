import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = (await request.json()) as { scope?: string; event?: string; payload?: unknown };
  console.log(`[VeilAds:${body.scope || "demo"}] ${body.event || "event"}`, body.payload || "");
  return NextResponse.json({ ok: true });
}
