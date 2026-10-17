"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useBoard } from "@/components/board-context"
import { downloadNoticePdf } from "@/components/share-card"
import { useSharedPlans } from "@/components/use-shared-plans"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { displayRecords, displaySwaps, sortPlansByMovementDate } from "@/lib/arrangement-list"
import {
  emptyHourAdjustments,
  parseHourAdjustments,
  readHourAdjustmentsLocal,
  writeHourAdjustmentsLocal,
  type HourAdjustmentsDoc,
} from "@/lib/hour-adjustments"
import { fixedCatalogue } from "@/lib/movement"
import { periodLabel } from "@/lib/periods"
import { downloadLabel, planFromRecord, planFromSwap } from "@/lib/record-plan"
import { countsTowardHours, exclusionKey, hoursDisplay } from "@/lib/stats"
import type { Plan, SchoolData } from "@/lib/types"

export function RecordsView() {
  const board = useBoard()
  const { plans } = useSharedPlans()
  const [archived, setArchived] = useState<Plan[]>([])
  const [query, setQuery] = useState("")
  const [busyKey, setBusyKey] = useState("")
  const [doc, setDoc] = useState<HourAdjustmentsDoc>(emptyHourAdjustments)
  const [fixedOpen, setFixedOpen] = useState(false)
  const needle = query.trim()
  const historyPlans = useMemo(() => {
    const byId = new Map<string, Plan>()
    for (const plan of [...archived, ...plans]) byId.set(plan.id, plan)
    return Array.from(byId.values())
  }, [archived, plans])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch("/api/arrangements", { cache: "no-store" })
        const body = await response.json().catch(() => null)
        if (cancelled || !response.ok) return
        const rows = Array.isArray(body?.archived) ? body.archived : []
        setArchived(rows.filter((row: Plan) => row && typeof row.id === "string"))
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const local = readHourAdjustmentsLocal()
    const localHas = Object.keys(local.adjustments).length > 0 || local.exclusions.length > 0
    if (localHas) setDoc(local)
    ;(async () => {
      try {
        const response = await fetch("/api/hour-adjustments", { cache: "no-store" })
        const json = await response.json().catch(() => null)
        if (cancelled) return
        const remote = response.ok ? parseHourAdjustments(json) : emptyHourAdjustments()
        if (localHas) {
          setDoc(local)
          writeHourAdjustmentsLocal(local)
          await fetch("/api/hour-adjustments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(local),
          }).catch(() => null)
          return
        }
        setDoc(remote)
        writeHourAdjustmentsLocal(remote)
      } catch {
        if (!cancelled && !localHas) setDoc(local)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const persist = useCallback(async (next: HourAdjustmentsDoc) => {
    const clean = parseHourAdjustments(next)
    setDoc(clean)
    writeHourAdjustmentsLocal(clean)
    try {
      await fetch("/api/hour-adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clean),
      })
    } catch {
      // keep optimistic local
    }
  }, [])

  const toggleExclusion = useCallback(
    (key: string) => {
      const latest = readHourAdjustmentsLocal()
      const set = new Set(latest.exclusions)
      if (set.has(key)) set.delete(key)
      else set.add(key)
      void persist({ ...latest, exclusions: [...set] })
    },
    [persist],
  )

  const exclusionSet = useMemo(() => new Set(doc.exclusions), [doc.exclusions])

  const prepared = useMemo(() => {
    if (!board.data) {
      return {
        swaps: [] as ReturnType<typeof displaySwaps>["swaps"],
        records: [] as ReturnType<typeof displayRecords>["records"],
        swapMerged: 0,
        recordHidden: 0,
      }
    }
    const swaps = displaySwaps(board.data.swaps)
    const records = displayRecords(board.data.records)
    return {
      swaps: swaps.swaps,
      records: records.records,
      swapMerged: swaps.mergedAway,
      recordHidden: records.hiddenDuplicateCount,
    }
  }, [board.data])

  const archivedSorted = useMemo(() => sortPlansByMovementDate(archived), [archived])

  const filtered = useMemo(() => {
    const hit = (parts: string[]) => !needle || parts.some((part) => part.includes(needle))
    return {
      swaps: prepared.swaps.filter((swap) =>
        hit([swap.date, swap.day, swap.className, swap.period, swap.origTeacher, swap.newTeacher, swap.newLesson, swap.type, swap.status || ""]),
      ),
      records: prepared.records.filter((row) => hit([row.date, row.period, row.absent, row.cover, row.kind])),
      archived: archivedSorted.filter((plan) =>
        hit([plan.date, plan.targetDate || "", plan.className, plan.teacher, plan.partnerTeacher || "", plan.reason || "", plan.tier || "", plan.course || ""]),
      ),
    }
  }, [prepared, archivedSorted, needle])

  async function downloadPlan(key: string, plan: Plan) {
    if (busyKey) return
    setBusyKey(key)
    try {
      await downloadNoticePdf(plan, [])
    } finally {
      setBusyKey("")
    }
  }

  if (!board.data) return <p className="text-sm text-muted-foreground">正在讀取紀錄…</p>

  const historyCount = prepared.swaps.length + prepared.records.length + archived.length

  return (
    <div className="space-y-5" data-testid="records-view">
      <div>
        <h1 className="font-heading text-3xl">調動紀錄</h1>
        <p className="text-sm text-muted-foreground">
          已發生調課／代課共 {historyCount} 筆（暫存 {prepared.swaps.length} · 總表 {prepared.records.length}
          {archived.length ? ` · 歸檔紙 ${archived.length}` : ""}
          {prepared.swapMerged || prepared.recordHidden
            ? `；已合併重複 ${prepared.swapMerged + prepared.recordHidden}`
            : ""}
          ）。按調動日期新→舊。當刻工作位喺「安排／調課紙」。
        </p>
      </div>

      <FixedBlock data={board.data} open={fixedOpen} onToggle={() => setFixedOpen((v) => !v)} />

      <section className="space-y-3" data-testid="history-main">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="font-heading text-xl">調課／代課歷史</h2>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋老師、班別、日期或科目"
            className="h-11 max-w-md bg-card text-base"
            data-testid="records-search"
          />
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">調課暫存</h3>
          <div className="max-w-full overflow-x-auto rounded-xl border bg-card">
            <table data-testid="swap-table" className="w-full min-w-[72rem] border-collapse text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">日期</th>
                  <th className="min-w-[8.5rem] px-3 py-2 font-medium">星期</th>
                  <th className="min-w-[9rem] px-3 py-2 font-medium">節次</th>
                  <th className="px-3 py-2 font-medium">班別</th>
                  <th className="min-w-[8rem] px-3 py-2 font-medium">原任</th>
                  <th className="min-w-[10rem] px-3 py-2 font-medium">新任</th>
                  <th className="min-w-[12rem] px-3 py-2 font-medium">課堂</th>
                  <th className="px-3 py-2 font-medium">類型</th>
                  <th className="px-3 py-2 font-medium">下載</th>
                </tr>
              </thead>
              <tbody>
                {filtered.swaps.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                      沒有符合的暫存。
                    </td>
                  </tr>
                ) : (
                  filtered.swaps.map((swap) => {
                    const key = `swap-${swap.key}-${swap.newTeacher}-${swap.status || ""}`
                    return (
                      <tr key={key} className="border-t align-top" data-date={swap.date}>
                        <td className="whitespace-nowrap px-3 py-2">{swap.date}</td>
                        <td className="min-w-[8.5rem] px-3 py-2">{swap.day}</td>
                        <td className="min-w-[9rem] whitespace-normal px-3 py-2">{swap.period}</td>
                        <td className="px-3 py-2">{swap.className}</td>
                        <td className="min-w-[8rem] whitespace-normal px-3 py-2">{swap.origTeacher}</td>
                        <td className="min-w-[10rem] whitespace-normal px-3 py-2">{swap.newTeacher}</td>
                        <td className="min-w-[12rem] whitespace-normal px-3 py-2">{swap.newLesson}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            {swap.type ? <Badge variant="outline">{swap.type}</Badge> : null}
                            {swap.status?.includes("已確定") ? <Badge>已確定</Badge> : null}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <DownloadCell
                            label={downloadLabel(swap.type)}
                            busy={busyKey === key}
                            onClick={() => void downloadPlan(key, planFromSwap(swap))}
                          />
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">總紀錄表</h3>
          <div className="max-w-full overflow-x-auto rounded-xl border bg-card">
            <table data-testid="records-table" className="w-full min-w-[52rem] border-collapse text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">日期</th>
                  <th className="min-w-[9rem] px-3 py-2 font-medium">節次</th>
                  <th className="min-w-[8rem] px-3 py-2 font-medium">請假</th>
                  <th className="min-w-[8rem] px-3 py-2 font-medium">代課</th>
                  <th className="px-3 py-2 font-medium">類型</th>
                  <th className="px-3 py-2 font-medium">時數</th>
                  <th className="px-3 py-2 font-medium">下載</th>
                </tr>
              </thead>
              <tbody>
                {filtered.records.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      沒有符合的紀錄。
                    </td>
                  </tr>
                ) : (
                  filtered.records.map((row, index) => {
                    const key = `rec-${row.date}-${row.period}-${row.absent}-${row.cover}-${row.kind}-${index}`
                    return (
                      <tr key={key} className="border-t align-top" data-date={row.date}>
                        <td className="whitespace-nowrap px-3 py-2">{row.date}</td>
                        <td className="min-w-[9rem] whitespace-normal px-3 py-2">{row.period}</td>
                        <td className="min-w-[8rem] whitespace-normal px-3 py-2">{row.absent}</td>
                        <td className="min-w-[8rem] whitespace-normal px-3 py-2">{row.cover}</td>
                        <td className="px-3 py-2">{row.kind ? <Badge variant="outline">{row.kind}</Badge> : null}</td>
                        <td
                          className="whitespace-nowrap px-3 py-2 text-muted-foreground"
                          data-hours={hoursDisplay(row.kind, row.count, exclusionSet.has(exclusionKey(row)))}
                        >
                          <HoursCell
                            kind={row.kind}
                            count={row.count}
                            excluded={exclusionSet.has(exclusionKey(row))}
                            onToggle={() => toggleExclusion(exclusionKey(row))}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <DownloadCell
                            label={downloadLabel(row.kind)}
                            busy={busyKey === key}
                            onClick={() =>
                              void downloadPlan(key, planFromRecord(row, board.data?.swaps || [], historyPlans))
                            }
                          />
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-2" data-testid="archived-plans">
          <h3 className="text-sm font-medium text-muted-foreground">歸檔調課／代課紙</h3>
          <p className="text-xs text-muted-foreground">已確認或歷史庫保留；可隔離重下當日紙。</p>
          <div className="max-w-full overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">日期</th>
                  <th className="px-3 py-2 font-medium">班／節</th>
                  <th className="px-3 py-2 font-medium">老師</th>
                  <th className="px-3 py-2 font-medium">類型</th>
                  <th className="px-3 py-2 font-medium">下載</th>
                </tr>
              </thead>
              <tbody>
                {filtered.archived.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      暫時未有歸檔紙。
                    </td>
                  </tr>
                ) : (
                  filtered.archived.map((plan) => {
                    const key = `arch-${plan.id}`
                    return (
                      <tr key={key} className="border-t align-top" data-testid="archived-row" data-date={plan.date}>
                        <td className="whitespace-nowrap px-3 py-2">
                          {plan.date}
                          {plan.targetDate && plan.targetDate !== plan.date ? ` → ${plan.targetDate}` : ""}
                        </td>
                        <td className="px-3 py-2">
                          {plan.className} {periodLabel(plan.period)}
                        </td>
                        <td className="px-3 py-2">
                          {plan.teacher}
                          {plan.partnerTeacher ? ` → ${plan.partnerTeacher}` : ""}
                        </td>
                        <td className="px-3 py-2">
                          {plan.mode === "cover" ? "代課" : plan.tier || "調課"}
                          {plan.reason ? `（${plan.reason}）` : ""}
                        </td>
                        <td className="px-3 py-2">
                          <DownloadCell
                            label={downloadLabel(plan.mode === "cover" ? "代課" : "調課")}
                            busy={busyKey === key}
                            onClick={() => void downloadPlan(key, plan)}
                          />
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}

function HoursCell({
  kind,
  count,
  excluded,
  onToggle,
}: {
  kind: string
  count: string
  excluded: boolean
  onToggle: () => void
}) {
  const countable = countsTowardHours(kind)
  const label = hoursDisplay(kind, count, excluded)
  if (!countable) {
    return (
      <span className="text-muted-foreground" data-testid="hours-locked">
        {label}
      </span>
    )
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="tabular-nums">{label}</span>
      <Button
        type="button"
        variant={excluded ? "secondary" : "outline"}
        size="sm"
        className="min-h-11 px-3 text-sm"
        onClick={onToggle}
        data-testid="hours-toggle"
        data-excluded={excluded ? "1" : "0"}
      >
        {excluded ? "唔計" : "計"}
      </Button>
    </div>
  )
}

function DownloadCell({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="min-h-11 whitespace-nowrap px-3 text-sm"
      disabled={busy}
      onClick={onClick}
      data-testid="download-slip"
    >
      {busy ? "下載中…" : label}
    </Button>
  )
}

function FixedBlock({
  data,
  open,
  onToggle,
}: {
  data: SchoolData
  open: boolean
  onToggle: () => void
}) {
  const rows = fixedCatalogue(data)
  return (
    <section
      data-testid="fixed-block"
      className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 px-3 py-2 sm:px-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-medium text-muted-foreground">校長觀課</h2>
          <p className="text-xs text-muted-foreground">校長觀課及其他不可調課堂（參考用，非調動歷史）· {rows.length} 項</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-9 text-sm text-muted-foreground"
          onClick={onToggle}
          data-testid="fixed-toggle"
          aria-expanded={open}
        >
          {open ? "收起" : "展開"}
        </Button>
      </div>
      {open ? (
        <div className="mt-2 max-h-56 max-w-full overflow-auto rounded-lg border bg-card/80">
          <table data-testid="fixed-table" className="w-full min-w-[36rem] border-collapse text-sm">
            <thead className="sticky top-0 bg-muted/80 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">日期</th>
                <th className="px-3 py-2 font-medium">節次</th>
                <th className="px-3 py-2 font-medium">班別</th>
                <th className="px-3 py-2 font-medium">課堂</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    課表和校曆沒有校長觀課。
                  </td>
                </tr>
              ) : (
                rows.map((item) => (
                  <tr key={`${item.date}-${item.className}-${item.period}-${item.course}`} className="border-t align-top">
                    <td className="whitespace-nowrap px-3 py-2">{item.date || item.reason}</td>
                    <td className="px-3 py-2">{item.period ? periodLabel(item.period) : ""}</td>
                    <td className="px-3 py-2">{item.className}</td>
                    <td className="px-3 py-2">{item.course}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
