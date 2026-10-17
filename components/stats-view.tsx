"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useBoard } from "@/components/board-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSharedPlans } from "@/components/use-shared-plans"
import {
  emptyHourAdjustments,
  parseHourAdjustments,
  readHourAdjustmentsLocal,
  writeHourAdjustmentsLocal,
  type HourAdjustmentsDoc,
} from "@/lib/hour-adjustments"
import { readHiddenKeys } from "@/lib/plans"
import { plansToSwaps, withHidden } from "@/lib/schedule"
import { tallyHours, type HourStat } from "@/lib/stats"

export function StatsView() {
  const board = useBoard()
  const [query, setQuery] = useState("")
  const { plans } = useSharedPlans()
  const [hidden, setHidden] = useState<string[]>([])
  const [doc, setDoc] = useState<HourAdjustmentsDoc>(emptyHourAdjustments)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setHidden(readHiddenKeys())
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
        // Same browser: localStorage wins when present; remote only seeds empty clients.
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
      } finally {
        if (!cancelled) setReady(true)
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
      // localStorage already holds optimistic state
    }
  }, [])

  const bump = useCallback(
    (short: string, field: "leaveDelta" | "coverDelta", delta: number, current: HourStat) => {
      if (delta < 0) {
        if (field === "leaveDelta" && current.leave <= 0) return
        if (field === "coverDelta" && current.cover <= 0) return
      }
      const latest = readHourAdjustmentsLocal()
      const prev = latest.adjustments[short] || { leaveDelta: 0, coverDelta: 0 }
      const nextAdj = {
        leaveDelta: prev.leaveDelta + (field === "leaveDelta" ? delta : 0),
        coverDelta: prev.coverDelta + (field === "coverDelta" ? delta : 0),
      }
      const adjustments = { ...latest.adjustments }
      if (nextAdj.leaveDelta === 0 && nextAdj.coverDelta === 0) delete adjustments[short]
      else adjustments[short] = nextAdj
      void persist({ ...latest, adjustments })
    },
    [persist],
  )

  const rows = useMemo(() => {
    if (!board.data) return []
    const data = withHidden(board.data, hidden)
    return tallyHours(data.teachers, data.records, [...data.swaps, ...plansToSwaps(plans)], doc)
  }, [board.data, hidden, plans, doc])

  const needle = query.trim()
  const shown = rows.filter((row) => !needle || row.short.includes(needle) || row.full.includes(needle))
  const hasHours = rows.some((row) => row.leave > 0 || row.cover > 0)

  if (!board.data) return <p className="text-sm text-muted-foreground">正在讀取統計…</p>

  return (
    <div className="space-y-4" data-testid="stats-view">
      <div>
        <h1 className="font-heading text-3xl">代課統計</h1>
        <p className="text-sm text-muted-foreground">可加減修正；改錯再撳返{ready ? "" : "（載入中）"}</p>
      </div>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="簡稱或姓名"
        className="h-11 max-w-md bg-card text-base"
      />
      {!hasHours ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">還沒有請假或代課紀錄。</p>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">沒有符合的老師。</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
            <table className="w-full min-w-[44rem] text-sm" data-testid="stats-table">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">簡稱</th>
                  <th className="px-3 py-2 font-medium">姓名</th>
                  <th className="px-3 py-2 font-medium">請假時數</th>
                  <th className="px-3 py-2 font-medium">代課時數</th>
                  <th className="px-3 py-2 font-medium">代課減請假</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.short} data-testid="stats-row" className="border-t align-middle">
                    <td className="px-3 py-2">{row.short}</td>
                    <td className="px-3 py-2">{row.full}</td>
                    <td className="px-3 py-2">
                      <HourControls
                        label="請假"
                        value={row.leave}
                        onMinus={() => bump(row.short, "leaveDelta", -1, row)}
                        onPlus={() => bump(row.short, "leaveDelta", 1, row)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <HourControls
                        label="代課"
                        value={row.cover}
                        onMinus={() => bump(row.short, "coverDelta", -1, row)}
                        onPlus={() => bump(row.short, "coverDelta", 1, row)}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium" data-balance={row.balance}>
                      {row.balance}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden" data-testid="stats-list">
            {shown.map((row) => (
              <li key={row.short} data-testid="stats-row" className="rounded-xl border bg-card px-3 py-3">
                <p className="font-medium">
                  {row.short} {row.full}
                </p>
                <div className="mt-3 space-y-2">
                  <HourControls
                    label="請假"
                    value={row.leave}
                    onMinus={() => bump(row.short, "leaveDelta", -1, row)}
                    onPlus={() => bump(row.short, "leaveDelta", 1, row)}
                  />
                  <HourControls
                    label="代課"
                    value={row.cover}
                    onMinus={() => bump(row.short, "coverDelta", -1, row)}
                    onPlus={() => bump(row.short, "coverDelta", 1, row)}
                  />
                  <p className="text-sm text-muted-foreground">
                    代課減請假 <span className="font-medium text-foreground">{row.balance}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function HourControls({
  label,
  value,
  onMinus,
  onPlus,
}: {
  label: string
  value: number
  onMinus: () => void
  onPlus: () => void
}) {
  return (
    <div className="flex items-center gap-2" data-testid={`hour-controls-${label}`}>
      <span className="w-10 shrink-0 text-xs text-muted-foreground md:hidden">{label}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 min-w-11 px-0 text-base"
        onClick={onMinus}
        disabled={value <= 0}
        aria-label={`${label}減一`}
        data-testid={`hour-minus-${label}`}
      >
        −
      </Button>
      <span className="min-w-[2rem] text-center text-base font-medium tabular-nums" data-testid={`hour-value-${label}`}>
        {value}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 min-w-11 px-0 text-base"
        onClick={onPlus}
        aria-label={`${label}加一`}
        data-testid={`hour-plus-${label}`}
      >
        ＋
      </Button>
    </div>
  )
}
