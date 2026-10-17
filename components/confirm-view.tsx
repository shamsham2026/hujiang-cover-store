"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { FormPreview } from "@/components/form-preview"
import { downloadNoticePdf, downloadPlanCard, sharePlanCard } from "@/components/share-card"
import { Button } from "@/components/ui/button"
import { classFormSheets } from "@/lib/form-sheet"
import { formatConfirmWhen, type InboxItem } from "@/lib/confirmations"
import { periodLabel } from "@/lib/periods"
import type { Plan } from "@/lib/types"

type Loaded = {
  plan: Plan
  related: Plan[]
  defaultWho: string
  confirmed: boolean
  item: InboxItem | null
}

export function ConfirmView({ code = "" }: { code?: string }) {
  const params = useSearchParams()
  const token = code ? "" : params.get("t") || ""
  const linkCode = code || params.get("c") || ""
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState("")
  const [who, setWho] = useState("")
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<InboxItem | null>(null)
  const [note, setNote] = useState("")

  useEffect(() => {
    if (!token && !linkCode) {
      setError("這條連結無效或已損壞。")
      return
    }
    let stop = false
    const query = linkCode ? `c=${encodeURIComponent(linkCode)}` : `t=${encodeURIComponent(token)}`
    fetch(`/api/confirm?${query}`)
      .then((response) => response.json())
      .then((body) => {
        if (stop) return
        if (!body.ok) {
          setError(body.message || "這條連結無效或已損壞。")
          return
        }
        setLoaded(body)
        setWho(body.defaultWho || "")
        if (body.confirmed && body.item) setDone(body.item)
      })
      .catch(() => {
        if (!stop) setError("暫時打不開這項安排。")
      })
    return () => {
      stop = true
    }
  }, [token, linkCode])

  async function confirm() {
    if (!who.trim() || sending) return
    setSending(true)
    try {
      const response = await fetch("/api/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(linkCode ? { code: linkCode, who: who.trim() } : { token, who: who.trim() }),
      })
      const raw = await response.text()
      let body: { ok?: boolean; item?: InboxItem; message?: string } = {}
      try {
        body = raw ? (JSON.parse(raw) as typeof body) : {}
      } catch {
        setNote(response.ok ? "未能確定。" : "伺服器暫時未能確定，請再試一次。")
        return
      }
      if (!body.ok || !body.item) {
        setNote(body.message || "未能確定。")
        return
      }
      setDone(body.item)
      setNote(body.message || "已確定。")
    } catch {
      setNote("未能確定，請再試一次。")
    } finally {
      setSending(false)
    }
  }

  if (error) return <p className="rounded-xl border px-4 py-8 text-center text-base">{error}</p>
  if (!loaded) return <p className="text-base text-muted-foreground">正在開啟安排…</p>

  if (done) {
    return (
      <div data-testid="confirmed-state" className="mx-auto max-w-lg rounded-2xl border bg-card px-4 py-10 text-center">
        <p className="font-heading text-4xl">已確定</p>
        <p className="mt-3 text-lg">{done.who}　{formatConfirmWhen(done.when)}</p>
        <p className="mt-2 text-base">
          {done.date}　{done.period.split("、").map((period) => periodLabel(period)).join("、")}　{done.className}　{done.teachers}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">{note || "課表已更新。"}</p>
      </div>
    )
  }

  const sheets = classFormSheets([loaded.plan, ...loaded.related])
  const confirmUrl =
    typeof window !== "undefined"
      ? window.location.href
      : linkCode
        ? `/c/${linkCode}`
        : token
          ? `/confirm?t=${encodeURIComponent(token)}`
          : undefined

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {sheets.map((sheet) => (
        <FormPreview key={sheet.className || sheet.reason} sheet={sheet} />
      ))}
      <div className="no-print flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-11" onClick={() => void downloadPlanCard(loaded.plan, emptyData(), loaded.related)}>下載圖片</Button>
        <Button variant="outline" className="min-h-11" onClick={() => void sharePlanCard(loaded.plan, emptyData(), loaded.related)}>分享圖片</Button>
        <Button
          variant="outline"
          className="min-h-11"
          data-testid="download-pdf"
          onClick={() =>
            void downloadNoticePdf(loaded.plan, loaded.related, confirmUrl || undefined)
          }
        >
          下載 PDF
        </Button>
      </div>
      <label className="block text-base">
        <span className="mb-1 block">你的名字</span>
        <input value={who} onChange={(event) => setWho(event.target.value)} className="h-12 w-full rounded-lg border bg-card px-3 text-base" />
      </label>
      <Button data-testid="confirm-arrangement" className="h-14 w-full text-lg" disabled={sending || !who.trim()} onClick={() => void confirm()}>
        {sending ? "確定中…" : "確定"}
      </Button>
      {note ? <p className="text-sm">{note}</p> : null}
    </div>
  )
}

function emptyData() {
  return { school: "", year: "", source: "", teachers: [], lessons: [], swaps: [], records: [], locked: [] }
}
