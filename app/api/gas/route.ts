import { postGas } from "@/lib/gas-post"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const body = (await request.json()) as { url?: string; payload?: unknown }
  const url = body.url || ""
  if (!url.startsWith("https://script.google.com/")) {
    return NextResponse.json({ success: false, message: "請貼上 script.google.com 的網頁應用程式網址。" }, { status: 400 })
  }
  try {
    const result = await postGas(url, body.payload ?? {})
    if (result.success === false && result.message === "試算表沒有回傳可讀的結果。") {
      return NextResponse.json(result, { status: 502 })
    }
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "寫入失敗"
    return NextResponse.json({ success: false, message }, { status: 502 })
  }
}
