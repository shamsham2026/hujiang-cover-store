import { archiveConfirmedPlans } from "@/lib/arrangement-store"
import { confirmApplyPayload } from "@/lib/confirm-apply"
import { readConfirmCode } from "@/lib/confirm-links"
import { arrangementFacts, defaultConfirmer, type InboxItem } from "@/lib/confirmations"
import { storedConfirmation, storeConfirmation } from "@/lib/confirm-store"
import { verifyConfirmToken } from "@/lib/confirm-token"
import { gasCallsForPlan } from "@/lib/gas-payload"
import { gasUrlFromEnv, postGas } from "@/lib/gas-post"
import { NextResponse } from "next/server"

function remoteItem(value: unknown, id: string) {
  if (!value || typeof value !== "object") return null
  const row = value as Partial<InboxItem>
  if (row.id !== id || typeof row.who !== "string") return null
  return { ...row, id, sheetWritten: true } as InboxItem
}

function cleanName(value: string) {
  return value.replace(/[|\n\r]/g, " ").trim()
}

async function payloadFrom(requestLike: { token?: string; code?: string }) {
  if (requestLike.code) return readConfirmCode(requestLike.code)
  if (requestLike.token) return verifyConfirmToken(requestLike.token)
  return null
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const payload = await payloadFrom({ token: url.searchParams.get("t") || "", code: url.searchParams.get("c") || "" })
  if (!payload) return NextResponse.json({ ok: false, message: "這條連結無效或已損壞。" }, { status: 400 })
  let saved = await storedConfirmation(payload.id)
  if (!saved) {
    const gasUrl = gasUrlFromEnv(payload.gasUrl)
    if (gasUrl) {
      try {
        const listed = await postGas(gasUrl, { action: "listConfirmations" })
        const items = Array.isArray(listed.items) ? listed.items : []
        const found = items.map((item) => remoteItem(item, payload.id)).find((item) => item)
        if (found) saved = await storeConfirmation(found)
      } catch {
        saved = null
      }
    }
  }
  return NextResponse.json({
    ok: true,
    plan: payload.plan,
    related: payload.related,
    defaultWho: defaultConfirmer(payload.plan, payload.related),
    confirmed: Boolean(saved),
    item: saved,
  })
}

export async function POST(request: Request) {
  try {
  const body = (await request.json()) as { token?: string; code?: string; who?: string }
  const payload = await payloadFrom({ token: body.token || "", code: body.code || "" })
  if (!payload) return NextResponse.json({ ok: false, message: "這條連結無效或已損壞。" }, { status: 400 })
  const prior = await storedConfirmation(payload.id).catch(() => null)
  if (prior) {
    // 早已確定：仍確保活躍「本次安排」已清走（歸檔），下載／離開頁唔影響
    await archiveConfirmedPlans([payload.plan, ...payload.related]).catch(() => null)
    return NextResponse.json({ ok: true, already: true, sheetWritten: prior.sheetWritten, item: prior, message: "這項安排早已確定，不會再執行一次。" })
  }

  const facts = arrangementFacts(payload.plan, payload.related)
  // Keep Chinese names and顿号、; only strip pipe/newlines used as markers.
  const who = cleanName(body.who || "") || defaultConfirmer(payload.plan, payload.related) || "同事"
  const item: InboxItem = {
    id: payload.id,
    who,
    when: new Date().toISOString(),
    date: facts.date,
    period: facts.period,
    className: facts.className,
    teachers: facts.teachers,
    lesson: facts.lesson,
    kind: facts.kind,
    sheetWritten: false,
  }
  const remembered = await archiveConfirmedPlans([payload.plan, ...payload.related]).then(() => true).catch(() => false)
  const doneMessage = remembered ? "已確定。課表已更新。" : "已確定。課表稍後才會在其他裝置更新。"
  const gasUrl = gasUrlFromEnv(payload.gasUrl)
  if (!gasUrl) {
    await storeConfirmation(item)
    return NextResponse.json({
      ok: true,
      already: false,
      sheetWritten: false,
      item,
      message: doneMessage,
    })
  }

  try {
    const applied = await postGas(gasUrl, confirmApplyPayload(payload.plan, payload.related, item))
    if (applied.success !== false && (applied.applied || applied.already)) {
      const fromGas = remoteItem(applied.confirmation, payload.id)
      const savedItem = fromGas ? { ...item, ...fromGas, who: fromGas.who || item.who, when: fromGas.when || item.when, sheetWritten: true } : { ...item, sheetWritten: true }
      await storeConfirmation(savedItem)
      return NextResponse.json({
        ok: true,
        already: Boolean(applied.already),
        sheetWritten: true,
        item: savedItem,
        message: applied.already ? "這項安排早已確定，不會再執行一次。" : doneMessage,
      })
    }

    const message = `${applied.message || ""} ${applied.error || ""}`
    const oldScript = message.includes("無調課資料") || message.includes("未產生任何有效")
    if (!oldScript) {
      await storeConfirmation(item)
      return NextResponse.json({
        ok: true,
        already: false,
        sheetWritten: false,
        item,
        message: doneMessage,
      })
    }

    const calls = gasCallsForPlan(payload.plan, [payload.plan, ...payload.related])
    const errors: string[] = []
    let wrote = 0
    for (const call of calls) {
      const result = await postGas(gasUrl, call.payload)
      if (result.success === false) errors.push(result.message || result.error || "試算表沒有寫入")
      else wrote += 1
    }
    item.sheetWritten = wrote > 0 && errors.length === 0
    await storeConfirmation(item)
    return NextResponse.json({
      ok: true,
      already: false,
      sheetWritten: item.sheetWritten,
      item,
      message: doneMessage,
    })
  } catch {
    await storeConfirmation(item)
    return NextResponse.json({
      ok: true,
      already: false,
      sheetWritten: false,
      item,
      message: doneMessage,
    })
  }
  } catch (error) {
    console.error("confirm POST failed", error)
    return NextResponse.json(
      { ok: false, message: "未能確定，請再試一次。" },
      { status: 500 },
    )
  }
}
