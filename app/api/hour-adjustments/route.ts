import { emptyHourAdjustments, parseHourAdjustments } from "@/lib/hour-adjustments"
import { readHourAdjustments, writeHourAdjustments } from "@/lib/hour-adjustments-store"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const doc = await readHourAdjustments()
    return NextResponse.json(doc)
  } catch (error) {
    console.error("hour-adjustments GET failed", error)
    return NextResponse.json(emptyHourAdjustments())
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const doc = parseHourAdjustments(body)
    const saved = await writeHourAdjustments(doc)
    return NextResponse.json({ ok: true, ...saved })
  } catch (error) {
    console.error("hour-adjustments POST failed", error)
    return NextResponse.json({ ok: false, ...emptyHourAdjustments(), error: "時數修正暫時未能儲存。" }, { status: 503 })
  }
}
