import { calendarOn } from "@/lib/calendar"
import { buildTeachUnits } from "@/lib/coteach"
import { isActivityRemark } from "@/lib/duty-posts"
import { markExternal } from "@/lib/external"
import { OBSERVATIONS, observationOn } from "@/lib/observations"
import { placementsFor } from "@/lib/resolve"
import { changesOn } from "@/lib/schedule"
import type { PlanLeg, SchoolData, Swap } from "@/lib/types"

const CLASS_CODE = /[1-6][A-D]/g
const GRADE_WORD: Record<string, string> = { 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6" }

export function textHasObservation(text: string) {
  return text.includes("觀課")
}

function classesNamed(text: string) {
  const found = new Set<string>()
  for (const match of text.matchAll(CLASS_CODE)) found.add(match[0])
  for (const match of text.matchAll(/P\.?\s*([1-6])/gi)) {
    for (const section of ["A", "B", "C", "D"]) found.add(`${match[1]}${section}`)
  }
  for (const match of text.matchAll(/([一二三四五六])年級/g)) {
    const grade = GRADE_WORD[match[1]]
    if (!grade) continue
    for (const section of ["A", "B", "C", "D"]) found.add(`${grade}${section}`)
  }
  return [...found]
}

function classNamesOf(className: string) {
  return className.split(/[、,，]/).map((item) => item.trim()).filter((item) => /^[1-6][A-D]$/.test(item))
}

/** 校長觀課不可調。課名、觀課時間表或校曆寫明班別才鎖；校曆沒寫班別時只記入紀錄。 */
export function observationReason(data: SchoolData, date: string, className: string, course = "", period = "") {
  if (textHasObservation(course)) {
    const who = classNamesOf(className)[0] || className
    return `${who || "這一節"} ${course}是校長觀課，這節不可調。`
  }
  if (period) {
    const booked = observationOn(date, className, period)
    if (booked) return `${booked.className} ${booked.course}是校長觀課，這節不可調。`
  }
  const day = calendarOn(data.calendar, date)
  if (!day) return ""
  const names = classNamesOf(className)
  for (const item of day.items) {
    if (!textHasObservation(item)) continue
    const named = classesNamed(item)
    const hit = names.find((name) => named.includes(name))
    if (hit) return `${hit}這天校曆是${item}，課堂不可調。`
  }
  return ""
}

export function fixedCause(reason: string) {
  if (reason.includes("觀課")) return "校長觀課"
  const calendar = reason.match(/校曆是([^，]+)/)
  if (calendar) return calendar[1]
  return reason.replace(/這節不可調。|課堂不可調。/g, "").trim() || reason
}

export function calendarObservationNote(data: SchoolData, date: string) {
  const day = calendarOn(data.calendar, date)
  if (!day) return ""
  const items = day.items.filter((item) => textHasObservation(item) && classesNamed(item).length === 0)
  return items.length ? `校曆：${items.join("、")}（未寫明班別）` : ""
}

export type SwappedRow = {
  key: string
  date: string
  period: string
  className: string
  from: string
  to: string
  course: string
  type: string
}

export function swappedOn(data: SchoolData, date: string, extra: Swap[] = []): SwappedRow[] {
  const last = new Map<string, Swap>()
  for (const swap of changesOn(data, date, extra)) {
    last.set(swap.key || `${swap.date}|${swap.className}|${swap.period}|${swap.origTeacher}`, swap)
  }
  return [...last.values()].map((swap) => ({
    key: swap.key,
    date: swap.date,
    period: swap.period,
    className: swap.className,
    from: swap.origTeacher,
    to: swap.newTeacher,
    course: swap.newLesson,
    type: swap.type,
  }))
}

export type FixedRow = {
  date: string
  period: string
  className: string
  course: string
  reason: string
}

export function fixedOn(data: SchoolData, date: string, extra: Swap[] = []): FixedRow[] {
  const units = buildTeachUnits(data.lessons)
  const rows: FixedRow[] = []
  const seen = new Set<string>()
  for (const placement of placementsFor(units, date, [...data.swaps, ...extra])) {
    if (placement.duty) continue
    const names = placement.classes.length ? placement.classes : [placement.className]
    for (const className of names) {
      const reason = observationReason(data, date, className, placement.course, placement.period)
      if (!reason) continue
      const key = `${className}|${placement.period}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ date, period: placement.period, className, course: placement.course, reason })
    }
  }
  return rows
}

export function fixedCatalogue(data: SchoolData): FixedRow[] {
  const rows: FixedRow[] = []
  const seen = new Set<string>()
  for (const item of OBSERVATIONS) {
    rows.push({
      date: item.date,
      period: item.period,
      className: item.className,
      course: item.course,
      reason: `${item.className} ${item.course}是校長觀課，這節不可調。`,
    })
  }
  for (const lesson of data.lessons) {
    if (!textHasObservation(lesson.course)) continue
    const key = `${lesson.day}|${lesson.className}|${lesson.period}|${lesson.course}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      date: "",
      period: lesson.period,
      className: lesson.className,
      course: lesson.course,
      reason: `星期${lesson.day} ${lesson.className} ${lesson.course}`,
    })
  }
  for (const day of data.calendar || []) {
    for (const item of day.items) {
      if (!textHasObservation(item)) continue
      const named = classesNamed(item)
      const key = `${day.date}|${item}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({
        date: day.date,
        period: "",
        className: named.join("、"),
        course: item,
        reason: named.length ? item : `${item}（未寫明班別）`,
      })
    }
  }
  return rows
}

export function planObservationError(data: SchoolData, plan: { date: string; className: string; period: string; course?: string; legs?: PlanLeg[] }) {
  const slots = plan.legs?.length
    ? plan.legs.map((leg) => ({ date: leg.date, period: leg.period, className: leg.className, course: leg.course }))
    : [{ date: plan.date, period: plan.period, className: plan.className, course: plan.course || "" }]
  for (const slot of slots) {
    const reason = observationReason(data, slot.date, slot.className, slot.course, slot.period)
    if (reason) return reason
  }
  return ""
}

export function remarkPlanError(_plan: { period: string; className: string; course: string; legs?: PlanLeg[] }) {
  return ""
}

export function markSlots<T extends { className: string; period: string; duty?: boolean; course: string; location?: string }>(data: SchoolData, date: string, slots: T[]) {
  return markExternal(data, date, slots).map((slot) => {
    const fixed = slot.duty ? "" : observationReason(data, date, slot.className, slot.course, slot.period)
    const remark = isActivityRemark(slot.period, slot.location || slot.className, slot.course)
    return {
      ...slot,
      ...(remark ? { remark: true as const } : {}),
      ...(fixed ? { fixed } : {}),
    }
  })
}
