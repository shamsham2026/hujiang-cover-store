import { deleteArrangement, readArchivedArrangements, readArrangements, upsertPlans } from "@/lib/arrangement-store"
import type { Plan } from "@/lib/types"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

function asPlan(value: unknown): Plan | null {
  if (!value || typeof value !== "object") return null
  const plan = value as Partial<Plan>
  if (typeof plan.id !== "string" || !plan.id || (plan.mode !== "cover" && plan.mode !== "swap") || typeof plan.date !== "string") return null
  return plan as Plan
}

function storeFailure(error: unknown, message: string) {
  console.error(message, error)
  return NextResponse.json({ error: message }, { status: 503 })
}

export async function GET() {
  try {
    const [plans, archived] = await Promise.all([readArrangements(), readArchivedArrangements()])
    return NextResponse.json({ plans, archived })
  } catch (error) {
    return storeFailure(error, "安排資料暫時未能讀取。")
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { plan?: unknown } | null
  const plan = asPlan(body?.plan)
  if (!plan) return NextResponse.json({ ok: false, message: "安排不完整。" }, { status: 400 })
  try {
    const plans = await upsertPlans([plan])
    return NextResponse.json({ ok: true, plans })
  } catch (error) {
    return storeFailure(error, "安排資料暫時未能儲存。")
  }
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null
  const id = typeof body?.id === "string" ? body.id : ""
  if (!id) return NextResponse.json({ ok: false, message: "沒有這筆安排。" }, { status: 400 })
  try {
    const plans = await deleteArrangement(id)
    return NextResponse.json({ ok: true, plans })
  } catch (error) {
    return storeFailure(error, "安排資料暫時未能移除。")
  }
}
