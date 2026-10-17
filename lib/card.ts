import { dayChar } from "@/lib/dates"
import { PERIOD_ORDER, periodLabel, periodMeta } from "@/lib/periods"
import { plansToSwaps } from "@/lib/schedule"
import type { Plan, Swap } from "@/lib/types"

export type CardRow = {
  period: string
  content: string
  teacher: string
}

export type ConfirmationCard = {
  title: string
  dateLine: string
  teacherLine: string
  column: string
  rows: CardRow[]
  footer: string
}

function sameCover(left: Plan, right: Plan) {
  return left.mode === "cover" && right.mode === "cover" && left.date === right.date && left.teacher === right.teacher && (left.reason || "") === (right.reason || "")
}

export function arrangementPlans(plan: Plan, related: Plan[] = []) {
  if (plan.mode !== "cover") return [plan]
  const extras = related.filter((item) => item.id !== plan.id && sameCover(plan, item))
  return [plan, ...extras]
}

function periodText(period: string, date: string, severalDates: boolean) {
  const label = /^\d+$/.test(period) ? period : periodLabel(period)
  if (!severalDates) return label
  const [, month, day] = date.split("-")
  return `${Number(month)}-${Number(day)} ${label}`
}

function adjacentLessons(left: string, right: string) {
  const a = PERIOD_ORDER.get(left as never)
  const b = PERIOD_ORDER.get(right as never)
  return a != null && b != null && b === a + 1 && periodMeta(left).kind === "lesson" && periodMeta(right).kind === "lesson"
}

function sameNotice(left: Swap, right: Swap) {
  return left.date === right.date && left.className === right.className && left.newLesson === right.newLesson && (left.newTeachers || left.newTeacher) === (right.newTeachers || right.newTeacher)
}

export function confirmationCard(plan: Plan, related: Plan[] = []): ConfirmationCard {
  const group = arrangementPlans(plan, related)
  const cover = plan.mode === "cover"
  const swaps = plansToSwaps(group).sort((left: Swap, right: Swap) => {
    if (left.date !== right.date) return left.date < right.date ? -1 : 1
    const leftPeriod = PERIOD_ORDER.get(left.period as never) ?? 99
    const rightPeriod = PERIOD_ORDER.get(right.period as never) ?? 99
    return leftPeriod - rightPeriod
  })
  const dates = [...new Set(swaps.map((swap) => swap.date))]
  const severalDates = dates.length > 1
  const reason = plan.reason?.trim() || (cover ? "代課" : "調課")
  const rows: CardRow[] = []
  let open: { start: string; end: string; date: string; content: string; teacher: string } | null = null
  let previous: Swap | null = null
  function flush() {
    if (!open) return
    rows.push({
      period: rowLabel(open.start, open.end, open.date, severalDates),
      content: open.content,
      teacher: open.teacher,
    })
    open = null
  }
  for (const swap of swaps) {
    const content = swap.newLesson || swap.className
    const teacher = swap.newTeachers || swap.newTeacher
    if (open && previous && sameNotice(previous, swap) && adjacentLessons(open.end, swap.period)) {
      open.end = swap.period
    } else {
      flush()
      open = { start: swap.period, end: swap.period, date: swap.date, content, teacher }
    }
    previous = swap
  }
  flush()
  return {
    title: cover ? "代課安排" : "調課安排",
    dateLine: `日期：${dates.map((date) => `${date} (星期${dayChar(date)})`).join("、")}`,
    teacherLine: cover ? `請假老師：${plan.teacher} (${reason})` : `申請老師：${plan.teacher} (${reason})`,
    column: cover ? "代課老師" : "對調老師",
    rows,
    footer: cover ? "請相關『代課老師』回覆確認以上安排，謝謝配合！" : "請相關『調課老師』回覆確認以上安排，謝謝配合！",
  }
}

function rowLabel(start: string, end: string, date: string, severalDates: boolean) {
  if (start === end) return periodText(start, date, severalDates)
  const span = /^\d+$/.test(start) && /^\d+$/.test(end) ? `${start}-${end}` : `${start}-${end}`
  if (!severalDates) return span
  const [, month, day] = date.split("-")
  return `${Number(month)}-${Number(day)} ${span}`
}
