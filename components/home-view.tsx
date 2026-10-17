"use client"

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import Link from "next/link"
import { useBoard } from "@/components/board-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatConfirmWhen, inboxFromSwaps, mergeInbox, type InboxItem } from "@/lib/confirmations"
import { calendarOn, compositionDay, examForClass } from "@/lib/calendar"
import { dayBoard, type BoardCell, type BoardDuty, type BoardRowModel } from "@/lib/day-board"
import { defaultSchoolDate, formatLongDate } from "@/lib/dates"
import { externalProgramme } from "@/lib/external"
import { MovementRecord } from "@/components/movement-record"
import { TeacherPicker } from "@/components/teacher-picker"
import { markSlots, fixedCause, observationReason } from "@/lib/movement"
import { hideActivityRemarks } from "@/lib/duty-posts"
import { readGasUrl, readHiddenKeys } from "@/lib/plans"
import { useSharedPlans } from "@/components/use-shared-plans"
import { CLASSES, GRADES, periodLabel } from "@/lib/periods"
import { plansToSwaps, teacherSlots, withHidden } from "@/lib/schedule"
import type { ResolvedSlot } from "@/lib/types"

const SEEN_KEY = "hujiang-seen-confirms"

export function HomeView() {
  const board = useBoard()
  const [date, setDate] = useState(defaultSchoolDate())
  const { plans } = useSharedPlans()
  const [hidden, setHidden] = useState<string[]>([])
  const [grade, setGrade] = useState<(typeof GRADES)[number]>("1")
  const [teacher, setTeacher] = useState("")
  const [remote, setRemote] = useState<InboxItem[]>([])
  const [seen, setSeen] = useState<string[]>([])

  useEffect(() => {
    setHidden(readHiddenKeys())
    try {
      const raw = window.localStorage.getItem(SEEN_KEY)
      const parsed = raw ? (JSON.parse(raw) as unknown) : []
      if (Array.isArray(parsed)) setSeen(parsed.filter((item): item is string => typeof item === "string"))
    } catch {
      setSeen([])
    }
  }, [])

  useEffect(() => {
    let stop = false
    async function pull() {
      const response = await fetch("/api/confirmations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gasUrl: readGasUrl() }),
      })
      const body = (await response.json()) as { items?: InboxItem[] }
      if (!stop) setRemote(body.items || [])
    }
    void pull()
    const timer = window.setInterval(() => void pull(), 20000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [])

  const extra = plansToSwaps(plans)
  const data = board.data ? withHidden(board.data, hidden) : null
  const rows = useMemo(() => (data ? dayBoard(data, date, extra) : []), [data, date, extra])
  const inbox = useMemo(() => {
    const fromSheet = data ? inboxFromSwaps(data.swaps) : []
    return mergeInbox([fromSheet, remote]).filter((item) => !seen.includes(item.id))
  }, [data, remote, seen])

  function dismiss(id: string) {
    const next = [...new Set([...seen, id])]
    setSeen(next)
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(next))
  }

  if (board.loading || !data) {
    return null
  }

  const gradeClasses = CLASSES.filter((className) => className.startsWith(grade))
  const calendar = calendarOn(data.calendar, date)

  return (
    <div className="space-y-4">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl tracking-wide sm:text-3xl">{formatLongDate(date)}</h1>
        </div>
        <label className="text-base">
          <span className="mb-1 block text-sm text-muted-foreground">日期</span>
          <input
            type="date"
            data-testid="home-date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-11 rounded-lg border bg-card px-3 text-base"
          />
        </label>
      </section>

      {board.warning ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{board.warning}</p> : null}

      <MovementRecord data={data} date={date} extra={extra} />

      {calendar ? (
        <section data-testid="calendar-note" className="rounded-xl border-2 border-primary/50 bg-card px-3 py-3 text-base sm:px-4">
          <h2 className="font-heading text-xl">校曆</h2>
          <ul className="mt-1 space-y-1">
            {calendar.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {calendar.halfDay ? <p className="mt-2 text-sm text-muted-foreground">半天上學</p> : null}
        </section>
      ) : null}

      {inbox.length > 0 ? (
        <section data-testid="confirm-inbox" className="rounded-xl border-2 border-primary bg-card p-3 sm:p-4">
          <h2 className="font-heading text-xl">同事已確定</h2>
          <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
            {inbox.map((item) => (
              <li key={item.id} data-testid="confirm-inbox-item" className="rounded-lg border bg-background px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>新確認</Badge>
                  <span className="font-medium">{item.who}</span>
                  <span className="text-muted-foreground">{formatConfirmWhen(item.when)}</span>
                </div>
                <p className="mt-1">
                  {item.date}　{item.period.split("、").map((period) => periodLabel(period)).join("、")}　{item.className}　{item.teachers}
                  {item.lesson ? `　${item.lesson}` : ""}
                </p>
                <Button variant="outline" className="mt-2 min-h-11" onClick={() => dismiss(item.id)}>知道了</Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <TeacherDay data={data} date={date} extra={extra} calendar={calendar} teacher={teacher} onTeacher={setTeacher} />

      <div className="flex flex-wrap gap-2 md:hidden" data-testid="grade-switch">
        {GRADES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setGrade(item)}
            className={`min-h-11 shrink-0 rounded-full px-4 text-base ${grade === item ? "bg-primary text-primary-foreground" : "border bg-card"}`}
          >
            {item}年級
          </button>
        ))}
      </div>

      {/* Mobile: one grade at a time */}
      <div className="md:hidden">
        <DayBoard data={data} date={date} rows={rows} classes={gradeClasses} calendar={calendar} teacher={teacher} />
      </div>

      {/* Desktop: single horizontal board — all classes 1A…6D */}
      <section
        data-testid="home-board-desktop"
        className="hidden md:block overflow-hidden rounded-xl border bg-card shadow-sm"
      >
        <div className="max-w-full overflow-x-auto p-2 sm:p-3">
          <DayBoard data={data} date={date} rows={rows} classes={CLASSES} calendar={calendar} teacher={teacher} wide />
        </div>
      </section>
    </div>
  )
}

function DayBoard({
  data,
  date,
  rows,
  classes,
  calendar,
  teacher,
  wide = false,
}: {
  data: NonNullable<ReturnType<typeof useBoard>["data"]>
  date: string
  rows: BoardRowModel[]
  classes: string[]
  calendar: ReturnType<typeof calendarOn>
  teacher: string
  wide?: boolean
}) {
  return (
    <div
      data-testid="home-board"
      className={`day-board ${wide ? "day-board-wide" : "day-board-phone"}`}
      style={wide ? ({ "--classes": classes.length } as CSSProperties) : undefined}
    >
      <table>
        <colgroup>
          <col className="period-col" />
          {classes.map((className) => (
            <col key={className} className="class-col" data-grade={className[0]} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="period">節</th>
            {classes.map((className) => (
              <th key={className} data-grade={className[0]} data-class={className}>{className}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <BoardRow key={row.period} data={data} date={date} row={row} classes={classes} calendar={calendar} teacher={teacher} homeroom={homeroomTeachers(rows)} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function homeroomTeachers(rows: BoardRowModel[]) {
  const row = rows.find((item) => item.period === "班主任節")
  const teachers: Record<string, string> = {}
  for (const [className, cell] of Object.entries(row?.cells || {})) teachers[className] = cell.teachers
  return teachers
}

function BoardRow({
  data,
  date,
  row,
  classes,
  calendar,
  teacher,
  homeroom,
}: {
  data: NonNullable<ReturnType<typeof useBoard>["data"]>
  date: string
  row: BoardRowModel
  classes: string[]
  calendar: ReturnType<typeof calendarOn>
  teacher: string
  homeroom: Record<string, string>
}) {
  const composition = compositionDay(calendar)
  const hideClubs = composition && (row.period === "9" || row.period === "10")
  const hasCells = classes.some((className) => row.cells[className]) || (composition && row.period === "10")
  const school = !hideClubs && row.schoolWide.length > 0
  return (
    <>
      {school ? (
        <tr className={row.duty ? "duty-row" : undefined}>
          <th className="period" rowSpan={hasCells ? 2 : 1} data-period={row.period}>
            <div>{row.label}</div>
            <div className="time">{row.time}</div>
          </th>
          <td colSpan={classes.length} data-testid="duty-row" data-period={row.period}>
            <div className="school-duty">
              {row.schoolWide.map((duty) => (
                <DutyChip key={`${row.period}-${duty.location}-${duty.remark ? "r" : "p"}`} duty={duty} mine={Boolean(teacher) && duty.teachers.split("、").includes(teacher)} />
              ))}
            </div>
          </td>
        </tr>
      ) : null}
      {hasCells || !school ? (
        <tr className={row.duty ? "duty-row" : undefined}>
          {school ? null : (
            <th className="period" data-period={row.period}>
              <div>{row.label}</div>
              <div className="time">{row.time}</div>
            </th>
          )}
          {classes.map((className) => {
            const cell = row.cells[className]
            const exam = row.duty ? "" : examForClass(calendar, className, row.period)
            const tutorial = !exam && composition && row.period === "10" && !cell?.course
            const programme = cell && !cell.duty && !exam && !tutorial ? externalProgramme(data, date, className, row.period) : ""
            const fixed = cell && !cell.duty && !exam && !tutorial ? observationReason(data, date, className, cell.course, row.period) : ""
            const tutorialCell: BoardCell = {
              course: "導修",
              teachers: homeroom[className] || "",
              baseTeachers: "",
              cover: "",
              changed: false,
              duty: false,
              empty: !homeroom[className],
            }
            return (
              <td key={className} data-testid={exam ? "exam-cell" : cell?.duty ? "duty-row" : "class-period"} data-period={row.period} data-class={className} data-grade={className[0]} className={cell?.duty ? "cell-duty-wrap" : undefined}>
                {exam ? <div className="cell-exam">{exam}</div> : tutorial ? <CellBody cell={tutorialCell} programme="" fixed="" mine={Boolean(teacher) && (homeroom[className] || "").split("、").includes(teacher)} /> : cell ? <CellBody cell={cell} programme={programme} fixed={fixed} mine={Boolean(teacher) && cell.teachers.split("、").includes(teacher)} /> : null}
              </td>
            )
          })}
        </tr>
      ) : null}
    </>
  )
}

function DutyChip({ duty, mine }: { duty: BoardDuty; mine: boolean }) {
  const names = duty.teachers || (duty.empty ? "未編" : "")
  return (
    <span className={`${duty.remark ? "duty-chip remark" : "duty-chip"}${mine ? " mine" : ""}`} data-remark={duty.remark ? "1" : undefined} data-post={duty.location}>
      {duty.remark ? <span className="movable" data-testid="movable-remark">可調動</span> : null}
      <span className="post">{duty.location}</span>
      <span>{names}{duty.cover ? `(代${duty.cover})` : ""}</span>
      {duty.changed && !duty.cover && duty.baseTeachers ? <span className="was">{duty.baseTeachers}</span> : null}
    </span>
  )
}

function CellBody({ cell, programme, fixed, mine }: { cell: BoardCell; programme: string; fixed: string; mine: boolean }) {
  return (
    <div className={`${cell.duty ? "cell-duty" : "cell-lesson"}${mine ? " mine" : ""}`}>
      {cell.course ? <div className="course">{cell.course}</div> : null}
      <div>{cell.empty && !cell.teachers ? "未編" : cell.teachers}{cell.cover ? `(代${cell.cover})` : ""}</div>
      {cell.changed && !cell.cover && cell.baseTeachers ? <div className="was">{cell.baseTeachers}</div> : null}
      {programme ? (
        <div data-testid="external-badge" className="external">校外 {programme}</div>
      ) : null}
      {fixed ? (
        <div data-testid="fixed-lesson" className="external">
          不可調
          <span className="block">（{fixedCause(fixed)}）</span>
        </div>
      ) : null}
    </div>
  )
}

function TeacherDay({
  data,
  date,
  extra,
  calendar,
  teacher,
  onTeacher,
}: {
  data: NonNullable<ReturnType<typeof useBoard>["data"]>
  date: string
  extra: ReturnType<typeof plansToSwaps>
  calendar: ReturnType<typeof calendarOn>
  teacher: string
  onTeacher: (short: string) => void
}) {
  const slots = useMemo(() => {
    if (!teacher) return []
    return markSlots(data, date, teacherSlots(data, date, teacher, extra).current).filter((slot) => !slot.empty)
  }, [data, date, teacher, extra])
  const shown = hideActivityRemarks(slots)

  return (
    <section data-testid="teacher-arrange" className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr] sm:items-start">
        <div>
          <h2 className="font-heading text-xl">按同事安排</h2>
          <div className="mt-2">
            <TeacherPicker teachers={data.teachers} value={teacher} onChange={onTeacher} placeholder="" />
          </div>
        </div>
        <div>
          {shown.length > 0 ? (
            <ul className="divide-y">
              {shown.map((slot) => {
                const className = slot.duty ? slot.location || slot.className : slot.className.split("、")[0] || slot.className
                const exam = slot.duty ? "" : examForClass(calendar, className, slot.period)
                const blocked = Boolean(slot.fixed || exam)
                return (
                  <li key={`${slot.period}-${slot.unitId || className}`} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="w-24 shrink-0 text-sm text-muted-foreground">{periodLabel(slot.period)}</span>
                    <span className="min-w-0 flex-1 text-base">{slotLine(slot, className)}</span>
                    {blocked ? (
                      <span className="text-sm text-muted-foreground">{exam || `不可調（${fixedCause(slot.fixed || "")}）`}</span>
                    ) : (
                      <span className="flex gap-2">
                        <Link href={arrangeHref(date, slot.period, teacher, className, "swap")} data-testid="home-move" data-mode="swap" data-period={slot.period} data-class={className} className="inline-flex min-h-11 items-center rounded-lg border bg-background px-3 text-sm">調動</Link>
                        <Link href={arrangeHref(date, slot.period, teacher, className, "cover")} data-testid="home-move" data-mode="cover" data-period={slot.period} data-class={className} className="inline-flex min-h-11 items-center rounded-lg border bg-background px-3 text-sm">代課</Link>
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function slotLine(slot: ResolvedSlot, className: string) {
  if (slot.duty) {
    const post = slot.location || className
    return slot.change.includes("代") && slot.baseTeachers.length ? `${post}(代${slot.baseTeachers.join("、")})` : post
  }
  const course = slot.course || className
  return slot.change.includes("代") && slot.baseTeachers.length ? `${course}(代${slot.baseTeachers.join("、")})` : course
}

function arrangeHref(date: string, period: string, teacher: string, className: string, mode: "swap" | "cover") {
  const query = new URLSearchParams({ date, period, teacher, class: className, mode })
  return `/arrange?${query}`
}
