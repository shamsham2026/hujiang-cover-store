import { loadBoard } from "@/lib/load-board"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("refresh") === "1"
  const board = await loadBoard(force)
  return NextResponse.json({
    data: board.data,
    source: board.source,
    fetchedAt: new Date(board.at).toISOString(),
    warning: board.warning ?? null,
  })
}
