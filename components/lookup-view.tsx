"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { TeacherPicker } from "@/components/teacher-picker"
import { useBoard } from "@/components/board-context"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CLASSES, PERIODS, periodLabel } from "@/lib/periods"
import { externalProgramme } from "@/lib/external"
import { activityHint, hideActivityRemarks } from "@/lib/duty-posts"
import { observationReason } from "@/lib/movement"
import { readHiddenKeys } from "@/lib/plans"
import { useSharedPlans } from "@/components/use-shared-plans"
import { dayChar, formatLongDate, nextSchoolDay, plansToSwaps, schoolWeek, teacherName, teacherSlots, withHidden } from "@/lib/schedule"
import { coverCandidates } from "@/lib/suggest"

export function LookupView() {
  const params = useSearchParams()
  const board = useBoard()
  const [date, setDate] = useState(params.get("date") || nextSchoolDay())
  const [teacher, setTeacher] = useState(params.get("teacher") || "曉")
  const [period, setPeriod] = useState(params.get("period") || "1")
  const [className, setClassName] = useState(params.get("class") || "")
  const { plans } = useSharedPlans()
  const [hidden, setHidden] = useState<string[]>([])
  useEffect(() => {
    setHidden(readHiddenKeys())
  }, [])

  const data = board.data ? withHidden(board.data, hidden) : null
  const extra = useMemo(() => plansToSwaps(plans), [plans])
  const week = useMemo(() => {
    if (!data) return []
    return schoolWeek(date).map((day) => ({
      date: day,
      slots: teacherSlots(data, day, teacher, extra).current,
    }))
  }, [data, date, teacher, extra])

  const free = useMemo(() => {
    if (!data) return null
    return coverCandidates({
      data,
      date,
      period,
      className: className || undefined,
      swaps: extra,
    })
  }, [data, date, period, className, extra])

  if (!data) return <p className="text-sm text-muted-foreground">正在讀取課表…</p>

  const programme = className ? externalProgramme(data, date, className, period) : ""
  const tab = params.get("tab") === "free" ? "free" : "teacher"

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-3xl">查找</h1>
      </div>
      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="teacher">教師課表</TabsTrigger>
          <TabsTrigger value="free">誰有空</TabsTrigger>
        </TabsList>
        <TabsContent value="teacher" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <TeacherPicker teachers={data.teachers} value={teacher} onChange={setTeacher} />
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">日期</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-10 w-full rounded-lg border bg-card px-3" />
            </label>
          </div>
          <p className="text-sm">{teacherName(data, teacher)} · {formatLongDate(date)} 這一週</p>
          {activityHint(week.flatMap((day) => day.slots)) ? <p data-testid="activity-hint" className="text-sm text-muted-foreground">{activityHint(week.flatMap((day) => day.slots))}</p> : null}
          <div data-testid="teacher-week" className="overflow-x-auto rounded-2xl border bg-card">
            <div className="min-w-[680px]">
              <div className="grid grid-cols-[5.2rem_repeat(5,minmax(7rem,1fr))] border-b bg-muted/50 text-sm">
                <div className="sticky left-0 bg-muted/50 px-2 py-2">教節</div>
                {week.map((day) => (
                  <div key={day.date} className="px-2 py-2 font-medium">
                    星期{dayChar(day.date)}
                    <span className="mt-0.5 block font-normal text-muted-foreground">{day.date.slice(5)}</span>
                  </div>
                ))}
              </div>
              {PERIODS.map((item) => (
                <div key={item.id} className="grid grid-cols-[5.2rem_repeat(5,minmax(7rem,1fr))] border-b text-sm last:border-b-0">
                  <div className="sticky left-0 bg-card px-2 py-2 text-muted-foreground">{item.label}</div>
                  {week.map((day) => {
                    const cells = hideActivityRemarks(day.slots.filter((slot) => slot.period === item.id))
                    return (
                      <div key={day.date} className="min-h-10 border-l px-2 py-1.5">
                        {cells.length === 0 ? <span className="text-muted-foreground">空堂</span> : cells.map((slot) => (
                          <div key={`${slot.unitId}-${slot.course}`}>
                            <span className="font-medium">{slot.className}</span> {slot.course}
                            {externalProgramme(data, day.date, slot.className, slot.period) ? (
                              <span data-testid="external-badge" className="mt-0.5 block">校外導師 {externalProgramme(data, day.date, slot.className, slot.period)}</span>
                            ) : null}
                            {observationReason(data, day.date, slot.className, slot.course, slot.period) ? (
                              <span data-testid="fixed-lesson" className="mt-0.5 block">不可調</span>
                            ) : null}
                            {slot.coTeach ? <span className="text-muted-foreground"> · 合教 {slot.teachers.join("、")}</span> : null}
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
        <TabsContent value="free" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">日期</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-10 w-full rounded-lg border bg-card px-3" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">教節</span>
              <select value={period} onChange={(event) => setPeriod(event.target.value)} className="h-10 w-full rounded-lg border bg-card px-3">
                {PERIODS.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">班別</span>
              <select value={className} onChange={(event) => setClassName(event.target.value)} className="h-10 w-full rounded-lg border bg-card px-3">
                <option value="">不限班別</option>
                {CLASSES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>
          {programme ? <p data-testid="external-badge">校外導師 {programme}</p> : null}
          <div data-testid="free-list" className="overflow-hidden rounded-2xl border bg-card">
            {!free || free.eligible.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">這一節沒有符合資格的空堂老師。</p>
            ) : (
              <ul className="divide-y">
                {free.eligible.map((row) => (
                  <li key={row.teacher} data-testid="cover-candidate" className="flex items-start gap-3 px-3 py-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs text-primary-foreground">{row.rank}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{row.teacher} {row.fullName}</div>
                      {row.warning ? <div className="text-xs text-muted-foreground">{row.warning}</div> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Badge variant="outline">{formatLongDate(date)} {periodLabel(period)}</Badge>
        </TabsContent>
      </Tabs>
    </div>
  )
}
