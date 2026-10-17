"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { planBlockMove, planMeeting, type AdoptBundle, type ArrangementItem, type TaskResult } from "@/lib/tasks"
import { CLASSES, LESSON_PERIODS, PERIODS, periodLabel } from "@/lib/periods"
import type { SchoolData, Swap, Teacher } from "@/lib/types"

const DUTY_CHIP: Record<string, string> = {
  "7:30": "7:30",
  "7:45": "7:45",
  班主任節: "班主任",
  小息1: "小息1",
  小息2: "小息2",
  午膳: "午膳",
  午息: "午息",
  放學: "放學",
}

function chipLabel(period: string) {
  return DUTY_CHIP[period] || periodLabel(period)
}

export function TaskPlanner({
  data,
  swaps,
  teachers,
  teacher,
  onAdopt,
}: {
  data: SchoolData
  swaps: Swap[]
  teachers: Teacher[]
  teacher?: string
  onAdopt: (bundle: AdoptBundle) => void
}) {
  const [className, setClassName] = useState("1A")
  const [sourceDate, setSourceDate] = useState("")
  const [targetDate, setTargetDate] = useState("")
  const [sourcePeriods, setSourcePeriods] = useState<string[]>([])
  const [targetPeriods, setTargetPeriods] = useState<string[]>([])
  const [move, setMove] = useState<TaskResult | null>(null)

  const [meetDate, setMeetDate] = useState("")
  const [meetPeriods, setMeetPeriods] = useState<string[]>([])
  const [meetTeachers, setMeetTeachers] = useState<string[]>([])
  const [query, setQuery] = useState("")
  const [meeting, setMeeting] = useState<TaskResult | null>(null)

  // 預設當天對調：選了原來日期後，調往日期未填就跟原來同一天
  useEffect(() => {
    if (sourceDate && !targetDate) setTargetDate(sourceDate)
  }, [sourceDate, targetDate])

  const filteredTeachers = useMemo(() => {
    const needle = query.trim()
    if (!needle) return teachers
    return teachers.filter((teacher) => teacher.short.includes(needle) || teacher.full.includes(needle))
  }, [query, teachers])

  function toggle(list: string[], value: string, setList: (next: string[]) => void) {
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value])
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border bg-card p-4">
        <h2 className="font-heading text-xl">指定節次調課</h2>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-muted-foreground">班別</span>
          <select value={className} onChange={(event) => setClassName(event.target.value)} className="h-11 w-full rounded-lg border bg-background px-3 text-base">
            {CLASSES.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <div className="mt-3 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block min-w-0 flex-1 text-sm" data-testid="block-source-date">
              <span className="mb-1 block text-muted-foreground">原來日期</span>
              <input
                type="date"
                value={sourceDate}
                onChange={(event) => {
                  const next = event.target.value
                  setSourceDate(next)
                  // 跟住原來日期＝預設當天對調；要跨日先再改調往日期
                  if (!targetDate || targetDate === sourceDate) setTargetDate(next)
                }}
                className="h-12 w-full rounded-lg border bg-background px-3 text-base"
              />
            </label>
            <label className="block min-w-0 flex-1 text-sm" data-testid="block-target-date">
              <span className="mb-1 block text-muted-foreground">調往日期（預設當天，跨日先改）</span>
              <input
                type="date"
                value={targetDate}
                onChange={(event) => setTargetDate(event.target.value)}
                className="h-12 w-full rounded-lg border bg-background px-3 text-base"
              />
            </label>
          </div>
          <div>
            <span className="mb-1 block text-sm text-muted-foreground">原來節次</span>
            <PeriodToggles periods={sourcePeriods} includeDuty onToggle={(period) => toggle(sourcePeriods, period, setSourcePeriods)} />
          </div>
          <div>
            <span className="mb-1 block text-sm text-muted-foreground">調往節次</span>
            <PeriodToggles periods={targetPeriods} includeDuty onToggle={(period) => toggle(targetPeriods, period, setTargetPeriods)} />
          </div>
        </div>
        <Button className="mt-4 min-h-12 px-6 text-base" onClick={() => setMove(planBlockMove({ data, className, teacher, sourceDate, sourcePeriods, targetDate, targetPeriods, swaps }))}>
          找出調法
        </Button>
        <ChoiceList result={move} coverReason="代課" cycleReason="" action="加入本次安排" onAdopt={onAdopt} />
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <h2 className="font-heading text-xl">會議調課</h2>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-muted-foreground">會議日期</span>
          <input type="date" value={meetDate} onChange={(event) => setMeetDate(event.target.value)} className="h-11 w-full rounded-lg border bg-background px-3 text-base" />
        </label>
        <PeriodToggles periods={meetPeriods} includeDuty onToggle={(period) => toggle(meetPeriods, period, setMeetPeriods)} />
        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-muted-foreground">參加老師</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋簡稱" className="h-11 w-full rounded-lg border bg-background px-3 text-base" />
        </label>
        <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-auto">
          {filteredTeachers.map((teacher) => (
            <button
              key={teacher.short}
              type="button"
              onClick={() => toggle(meetTeachers, teacher.short, setMeetTeachers)}
              className={`min-h-11 rounded-full px-3 text-sm ${meetTeachers.includes(teacher.short) ? "bg-primary text-primary-foreground" : "border bg-background"}`}
            >
              {teacher.short}
            </button>
          ))}
        </div>
        <Button
          className="mt-4 min-h-12 px-6 text-base"
          onClick={() => setMeeting(planMeeting({ data, date: meetDate, periods: meetPeriods, teachers: meetTeachers, swaps }))}
        >
          騰出會議時間
        </Button>
        <ChoiceList result={meeting} coverReason="會議" cycleReason="會議" action="加入本次安排" onAdopt={onAdopt} />
      </section>
    </div>
  )
}

function PeriodToggles({ periods, onToggle, includeDuty = false }: { periods: string[]; onToggle: (period: string) => void; includeDuty?: boolean }) {
  const ids = includeDuty ? PERIODS.map((period) => period.id) : LESSON_PERIODS
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {ids.map((period) => (
        <button
          key={period}
          type="button"
          onClick={() => onToggle(period)}
          className={`min-h-12 min-w-12 rounded-lg px-3 text-base ${periods.includes(period) ? "bg-primary text-primary-foreground" : "border bg-background"}`}
        >
          {chipLabel(period)}
        </button>
      ))}
    </div>
  )
}

function ChoiceList({
  result,
  coverReason,
  cycleReason,
  action,
  onAdopt,
}: {
  result: TaskResult | null
  coverReason: string
  cycleReason: string
  action: string
  onAdopt: (bundle: AdoptBundle) => void
}) {
  const [modes, setModes] = useState<Record<string, "swap" | "cover">>({})
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [swapPicks, setSwapPicks] = useState<Record<string, string>>({})
  const signature = result?.items.map((item) => item.id).join("|") || ""

  useEffect(() => {
    const nextModes: Record<string, "swap" | "cover"> = {}
    const nextPicks: Record<string, string> = {}
    const nextSwapPicks: Record<string, string> = {}
    for (const item of result?.items || []) {
      nextModes[item.id] = item.initial
      nextPicks[item.id] = item.covers[0]?.teacher || ""
      // 唔預選 cycle：預選會令第一個方案好似已揀／已加入，但其實未 onAdopt
      nextSwapPicks[item.id] = ""
    }
    setModes(nextModes)
    setPicks(nextPicks)
    setSwapPicks(nextSwapPicks)
  }, [signature, result])

  const modeOf = (item: ArrangementItem) => modes[item.id] || item.initial
  const optionsOf = (item: ArrangementItem) => (item.swaps.length ? item.swaps : item.swap ? [item.swap] : [])
  /** 用戶親手撳過嘅 cycle；未撳唔好當已選（避免「只 highlight 未加入」錯覺）。 */
  const explicitPick = (item: ArrangementItem) => {
    const options = optionsOf(item)
    const picked = swapPicks[item.id]
    if (!picked) return null
    return options.find((cycle) => cycle.id === picked) || null
  }
  /** 底欄「加入本次安排」用：未親手撳時先 fallback 預設方案。 */
  const swapOf = (item: ArrangementItem) => {
    const options = optionsOf(item)
    return explicitPick(item) || item.swap || options[0] || null
  }
  const canSwap = (item: ArrangementItem) => optionsOf(item).length > 0
  const visible = (result?.items || []).filter((item) => {
    if (item.role !== "block") return true
    return (result?.items || []).some((parent) => parent.blockedBy.includes(item.id) && modeOf(parent) === "swap")
  })
  const issues: string[] = []
  const cycles: AdoptBundle["cycles"] = []
  const covers: AdoptBundle["covers"] = []
  const taken = new Set<string>()
  const seen = new Set<string>()
  const ordered = [...visible.filter((item) => item.role === "block"), ...visible.filter((item) => item.role !== "block")]
  for (const item of ordered) {
    const mode = modeOf(item)
    if (mode === "cover") {
      const coverTeacher = picks[item.id] || item.covers[0]?.teacher || ""
      if (!coverTeacher) {
        issues.push(`${item.className} ${periodLabel(item.period)}沒有可代課的老師。`)
        continue
      }
      const key = `${coverTeacher}|${item.date}|${item.period}`
      if (taken.has(key)) issues.push(`${coverTeacher}在${periodLabel(item.period)}不能代兩班。`)
      taken.add(key)
      covers.push({
        date: item.date,
        period: item.period,
        className: item.className,
        course: item.course,
        teacher: item.teachers[0] || "",
        teachers: item.teachers,
        coverTeacher,
        reason: coverReason,
      })
      continue
    }
    const chosen = swapOf(item)
    const pending = item.blockedBy.some((id) => {
      const block = result?.items.find((candidate) => candidate.id === id)
      if (!block || modeOf(block) === "cover") return !(picks[block?.id || ""] || block?.covers[0]?.teacher)
      return !swapOf(block)
    })
    if (!chosen || pending) {
      issues.push(`${item.className} ${periodLabel(item.period)}調不開。`)
      continue
    }
    if (!seen.has(chosen.id)) {
      seen.add(chosen.id)
      cycles.push(chosen)
    }
  }

  if (!result) return null
  return (
    <div className="mt-3 space-y-3 text-sm">
      {result.problems.map((line, index) => (
        <p key={`${index}-${line}`} className="text-destructive">{line}</p>
      ))}
      {visible.map((item) => {
        const mode = modeOf(item)
        const options = optionsOf(item)
        const chosen = explicitPick(item)
        return (
          <div key={item.id} className="rounded-xl border p-3">
            <p className="font-medium">{item.className} {item.date.slice(5)} {periodLabel(item.period)} {item.course} · {item.teachers.join("、") || "未編"}</p>
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                variant={mode === "swap" ? "default" : "outline"}
                className="min-h-11"
                disabled={!canSwap(item)}
                onClick={() => {
                  setModes((current) => ({ ...current, [item.id]: "swap" }))
                  window.requestAnimationFrame(() => {
                    document.querySelector(`[data-swap-for="${item.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" })
                  })
                }}
              >
                調課
              </Button>
              <Button type="button" variant={mode === "cover" ? "default" : "outline"} className="min-h-11" disabled={!item.covers.length} onClick={() => setModes((current) => ({ ...current, [item.id]: "cover" }))}>代課</Button>
            </div>
            {mode === "cover" && item.covers.length ? (
              <label className="mt-2 block">
                <span className="mb-1 block text-muted-foreground">代課老師</span>
                <select value={picks[item.id] || item.covers[0].teacher} onChange={(event) => setPicks((current) => ({ ...current, [item.id]: event.target.value }))} className="h-11 w-full rounded-lg border bg-background px-3 text-base">
                  {item.covers.map((cover) => (
                    <option key={cover.teacher} value={cover.teacher}>{cover.teacher}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {mode === "swap" ? (
              <div className="mt-2 space-y-2" data-testid="meeting-swap-next" data-swap-for={item.id}>
                <span className="block text-muted-foreground">可對調堂（撳其中一個 → 即加入本次安排）</span>
                {options.length === 0 ? (
                  <p className="text-muted-foreground">這一節沒有可採用的對調。</p>
                ) : (
                  <div className="max-h-56 space-y-1 overflow-auto">
                    {options.map((cycle) => (
                      <button
                        key={cycle.id}
                        type="button"
                        data-testid="meeting-swap-cycle"
                        data-tier={cycle.tier}
                        onClick={() => {
                          setModes((current) => ({ ...current, [item.id]: "swap" }))
                          setSwapPicks((current) => ({ ...current, [item.id]: cycle.id }))
                          // 選完即加入：唔再等底欄確認掣（其他未完成項目唔擋住呢個 cycle）
                          onAdopt({ cycles: [cycle], covers: [], reason: cycleReason })
                        }}
                        className={`block w-full rounded-md border px-3 py-2 text-left text-sm ${chosen?.id === cycle.id ? "border-primary bg-accent" : "bg-card"}`}
                      >
                        <span className="font-medium">{cycle.tier}</span>
                        <span className="mt-1 block">{cycle.summary}</span>
                      </button>
                    ))}
                  </div>
                )}
                {!chosen && options.length > 0 ? (
                  <p className="rounded-lg border border-dashed px-3 py-2 text-muted-foreground" data-testid="meeting-swap-pick-hint">尚未加入——請撳上方一個對調方案。</p>
                ) : null}
                {chosen ? (
                  <>
                    <ul data-testid="meeting-swap-legs" className="space-y-1 rounded-lg border bg-muted/40 px-3 py-2">
                      {chosen.legs.map((leg, index) => (
                        <li key={`${leg.period}-${index}`}>
                          {index + 1}. {(leg.teachers || [leg.teacher]).filter(Boolean).join("、")} {leg.course}　{leg.date === leg.toDate ? "" : `${leg.date} `}{periodLabel(leg.period)} → {leg.toDate === leg.date ? "" : `${leg.toDate} `}{periodLabel(leg.toPeriod)}
                        </li>
                      ))}
                    </ul>
                    <Button
                      type="button"
                      data-testid="meeting-adopt-pick"
                      className="min-h-11 w-full"
                      onClick={() => onAdopt({ cycles: [chosen], covers: [], reason: cycleReason })}
                    >
                      加入本次安排
                    </Button>
                  </>
                ) : null}
                {item.note ? <p className="text-muted-foreground">{item.note}</p> : null}
              </div>
            ) : null}
          </div>
        )
      })}
      {issues.map((line, index) => (
        <p key={`${index}-${line}`} className="text-destructive">{line}</p>
      ))}
      {visible.length > 0 && (cycles.length > 0 || covers.length > 0) ? (
        <Button
          data-testid="meeting-adopt-all"
          className="min-h-11 w-full"
          onClick={() => onAdopt({ cycles, covers, reason: cycleReason })}
        >
          {action}
        </Button>
      ) : null}
    </div>
  )
}
