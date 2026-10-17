"use client"

import { FormPreview } from "@/components/form-preview"
import { downloadPlanCard, downloadNoticePdfs, shareNoticePdf } from "@/components/share-card"
import { useBoard } from "@/components/board-context"
import { Button } from "@/components/ui/button"
import { classFormSheets } from "@/lib/form-sheet"
import { useSharedPlans } from "@/components/use-shared-plans"
import type { Plan } from "@/lib/types"
import { useState } from "react"

async function confirmUrlForPlans(plans: Plan[]): Promise<string | undefined> {
  if (!plans.length) return undefined
  const plan = plans[0]
  const related = plans.slice(1)
  try {
    const response = await fetch("/api/confirm-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, related }),
    })
    const body = await response.json().catch(() => null)
    if (body?.ok && typeof body.url === "string" && body.url) return body.url as string
  } catch {
    // store 未通時短碼會失敗；下方仍畫掣，淨係唔加 link
  }
  return undefined
}

/** 同一請假老師／同日代課併一張通知卡；調課各一張。 */
function groupPlansForNotice(plans: Plan[]): Plan[][] {
  const used = new Set<string>()
  const groups: Plan[][] = []
  for (const plan of plans) {
    if (used.has(plan.id)) continue
    if (plan.mode === "cover") {
      const group = plans.filter(
        (item) =>
          item.mode === "cover" &&
          item.date === plan.date &&
          item.teacher === plan.teacher &&
          (item.reason || "") === (plan.reason || ""),
      )
      for (const item of group) used.add(item.id)
      groups.push(group)
    } else {
      used.add(plan.id)
      groups.push([plan])
    }
  }
  return groups
}

async function noticeGroupsWithConfirmLinks(plans: Plan[]) {
  const groups = groupPlansForNotice(plans)
  return Promise.all(
    groups.map(async (group) => {
      const confirmUrl = await confirmUrlForPlans(group)
      return { plan: group[0], related: group.slice(1), confirmUrl }
    }),
  )
}

export function SlipView() {
  const board = useBoard()
  const { plans } = useSharedPlans()
  const [busy, setBusy] = useState(false)

  if (!board.data) return <p className="text-sm text-muted-foreground">正在準備調課紙…</p>
  if (plans.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-12 text-center">
        <h1 className="font-heading text-2xl">還沒有可列印的安排</h1>
        <p className="mt-2 text-sm text-muted-foreground">先到「安排」加入至少一筆調課或代課。已確認／已清走嘅唔再留喺當日紙，請到「紀錄」重下。</p>
      </div>
    )
  }

  async function onDownloadPdf() {
    if (busy) return
    setBusy(true)
    try {
      const groups = await noticeGroupsWithConfirmLinks(plans)
      await downloadNoticePdfs(groups)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="no-print mb-4">
        <h1 className="font-heading text-3xl">調課紙</h1>
        <p className="text-sm text-muted-foreground">只顯示進行中／未確認完嘅安排。一班一張直向調課紙。歷史請到「紀錄」重下。</p>
      </div>
      <div className="no-print mb-4">
        <Button className="min-h-11" data-testid="download-pdf" disabled={busy} onClick={() => void onDownloadPdf()}>
          {busy ? "準備中…" : "下載 PDF"}
        </Button>
        <Button variant="outline" className="ml-2 min-h-11" onClick={() => window.print()}>列印</Button>
      </div>
      <div className="space-y-8">
        {classFormSheets(plans).map((sheet) => (
          <section key={sheet.className || sheet.reason} className="space-y-3">
            <div className="no-print flex flex-wrap gap-2">
              <Button variant="outline" className="min-h-11" data-testid="download-card" onClick={() => board.data && plans[0] && void downloadPlanCard(plans[0], board.data, plans)}>下載圖片</Button>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  if (!plans[0]) return
                  void (async () => {
                    const groups = await noticeGroupsWithConfirmLinks([plans[0], ...plans.slice(1)])
                    const g = groups[0]
                    await shareNoticePdf(g.plan, g.related || [], g.confirmUrl)
                  })()
                }}
              >
                分享圖片
              </Button>
            </div>
            <FormPreview sheet={sheet} />
          </section>
        ))}
      </div>
    </div>
  )
}
