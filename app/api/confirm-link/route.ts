import { arrangementPlans } from "@/lib/card"
import { confirmLinkPath } from "@/lib/confirm-code"
import { issueConfirmCode } from "@/lib/confirm-links"
import { arrangementId } from "@/lib/confirmations"
import type { Plan } from "@/lib/types"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { plan?: Plan; related?: Plan[]; gasUrl?: string } | null
  const plan = body?.plan
  if (!plan?.mode || !plan.date) {
    return NextResponse.json({ ok: false, message: "沒有可分享的安排。" }, { status: 400 })
  }
  try {
    const related = arrangementPlans(plan, Array.isArray(body?.related) ? body.related : []).filter((item) => item.id !== plan.id)
    const gasUrl = typeof body?.gasUrl === "string" && body.gasUrl.startsWith("https://script.google.com/") ? body.gasUrl : ""
    const code = await issueConfirmCode({ v: 1, id: arrangementId(plan), plan, related, gasUrl })
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || ""
    const proto = request.headers.get("x-forwarded-proto") || "http"
    const url = `${proto}://${host}${confirmLinkPath(code)}`
    return NextResponse.json({ ok: true, url, code })
  } catch (error) {
    console.error("確定連結暫時未能建立。", error)
    return NextResponse.json({ error: "確定連結暫時未能建立。" }, { status: 503 })
  }
}
