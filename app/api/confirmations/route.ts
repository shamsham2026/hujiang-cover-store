import { inboxFromSwaps, mergeInbox, type InboxItem } from "@/lib/confirmations"
import { readStoredConfirmations } from "@/lib/confirm-store"
import { gasUrlFromEnv, postGas } from "@/lib/gas-post"
import { loadBoard } from "@/lib/load-board"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

function asItems(value: unknown): InboxItem[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is InboxItem => {
    if (!item || typeof item !== "object") return false
    const row = item as Partial<InboxItem>
    return typeof row.id === "string" && typeof row.who === "string"
  })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { gasUrl?: string }
  const gasUrl = gasUrlFromEnv(typeof body.gasUrl === "string" ? body.gasUrl : "")
  let remote: InboxItem[] = []
  if (gasUrl) {
    const listed = await postGas(gasUrl, { action: "listConfirmations" })
    if (listed.success !== false) remote = asItems(listed.items)
  }
  const board = await loadBoard(false)
  const fromSheet = inboxFromSwaps(board.data.swaps)
  const items = mergeInbox([fromSheet, remote, await readStoredConfirmations()])
  return NextResponse.json({ items })
}
