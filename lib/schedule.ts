import { buildTeachUnits } from "@/lib/coteach"
import { dayChar, formatLongDate, nextSchoolDay, parseISO, schoolWeek, toISO } from "@/lib/dates"
import { dismissalConcurrent, dismissalConcurrentWarning, dutyLocation, isDuty, sameDayDutyMessage } from "@/lib/duty"
import { activityHint, canonicalDutyPost, isActivityRemark } from "@/lib/duty-posts"
import { periodLabel, PERIODS } from "@/lib/periods"
import { placementsFor, slotsForClass, slotsForDuty, slotsForTeacher } from "@/lib/resolve"
import { morningBlockReason } from "@/lib/staff"
import { venueMoveWarning } from "@/lib/venues"
import type { Lesson, LockedLesson, Plan, PlanLeg, ResolvedSlot, SchoolData, Swap } from "@/lib/types"

export { dayChar, formatLongDate, nextSchoolDay, parseISO, schoolWeek, toISO }
export { dutyLocation, periodLabel }

const MONTHS: Record<string, number> = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
}

export function teacherName(data: SchoolData, short: string) {
  return data.teachers.find((teacher) => teacher.short === short)?.full || short
}

export function legsOf(plan: Plan): PlanLeg[] {
  if (plan.legs && plan.legs.length > 0) return plan.legs
  if (plan.mode === "cover") {
    return [
      {
        date: plan.date,
        period: plan.period,
        toDate: plan.date,
        toPeriod: plan.period,
        className: plan.className,
        course: plan.course,
        teacher: plan.partnerTeacher,
        teachers: plan.partnerTeachers?.length ? plan.partnerTeachers : [plan.partnerTeacher],
      },
    ]
  }
  const teachers = plan.teachers?.length ? plan.teachers : [plan.teacher]
  const partners = plan.partnerTeachers?.length ? plan.partnerTeachers : [plan.partnerTeacher]
  return [
    {
      date: plan.date,
      period: plan.period,
      toDate: plan.targetDate,
      toPeriod: plan.partnerPeriod,
      className: plan.className,
      course: plan.course,
      teacher: plan.teacher,
      teachers,
    },
    {
      date: plan.targetDate,
      period: plan.partnerPeriod,
      toDate: plan.date,
      toPeriod: plan.period,
      className: plan.className,
      course: plan.partnerCourse,
      teacher: plan.partnerTeacher,
      teachers: partners,
    },
  ]
}

export function plansToSwaps(plans: Plan[]): Swap[] {
  return plans.flatMap((plan) => {
    if (plan.mode === "cover") {
      return [
        {
          date: plan.date,
          day: dayChar(plan.date),
          period: plan.period,
          className: plan.className,
          origTeacher: plan.teacher,
          newTeacher: plan.partnerTeacher,
          newLesson: plan.course,
          type: "課堂代課",
          key: `${plan.date}_${plan.className}_${plan.period}`,
        },
      ]
    }

    const legs = legsOf(plan)
    const swaps: Swap[] = []
    const seen = new Set<string>()
    for (const incoming of legs) {
      const occupant = legs.find(
        (leg) => leg.date === incoming.toDate && leg.period === incoming.toPeriod && (leg.date !== incoming.date || leg.period !== incoming.period)
      )
      const origTeachers = (occupant?.teachers?.length ? occupant.teachers : [occupant?.teacher || ""]).filter(Boolean)
      const arriving = (incoming.teachers?.length ? incoming.teachers : [incoming.teacher]).filter(Boolean)
      const type = incoming.date === incoming.toDate ? "課堂調動" : "跨天調動"
      const className = occupant?.className || incoming.className
      const key = `${incoming.toDate}_${className}_${incoming.toPeriod}`
      if (seen.has(key)) continue
      seen.add(key)
      swaps.push({
        date: incoming.toDate,
        day: dayChar(incoming.toDate),
        period: incoming.toPeriod,
        className,
        origTeacher: origTeachers.join("、"),
        newTeacher: arriving.join("、"),
        newTeachers: arriving.join("、"),
        newLesson: incoming.course,
        type,
        key,
      })
    }
    return swaps
  })
}

export function classSlots(data: SchoolData, date: string, className: string, extra: Swap[] = []): ResolvedSlot[] {
  return slotsForClass(data, date, className, extra)
}

export function teacherSlots(data: SchoolData, date: string, teacher: string, extra: Swap[] = []) {
  return slotsForTeacher(data, date, teacher, extra)
}

export function teacherActivityHint(data: SchoolData, date: string, teacher: string, extra: Swap[] = []) {
  if (!teacher) return ""
  const slots = schoolWeek(date).flatMap((day) => teacherSlots(data, day, teacher, extra).current)
  return activityHint(slots)
}

export function dutySlots(data: SchoolData, date: string, extra: Swap[] = []) {
  return slotsForDuty(data, date, extra)
}

function periodHits(data: SchoolData, date: string, teacher: string, period: string, extra: Swap[] = []) {
  const units = buildTeachUnits(data.lessons)
  return placementsFor(units, date, [...data.swaps, ...extra]).filter(
    (placement) =>
      placement.period === period &&
      placement.teachers.includes(teacher) &&
      !isActivityRemark(placement.period, placement.location || placement.className, placement.course)
  )
}

export function teacherBusy(data: SchoolData, date: string, teacher: string, period: string, extra: Swap[] = []) {
  const hits = periodHits(data, date, teacher, period, extra)
  if (dismissalConcurrent(period, hits)) return false
  return hits.length > 0
}

/** 已在另一個放學崗位。可以兼任，只作提示。 */
export function dismissalOverlapMessage(data: SchoolData, date: string, teacher: string, extra: Swap[] = []) {
  if (!teacher) return ""
  const hits = periodHits(data, date, teacher, "放學", extra).filter((placement) => placement.duty)
  if (!hits.length) return ""
  const posts = hits.map((placement) => canonicalDutyPost(placement.location || placement.className || placement.course))
  return `${teacherName(data, teacher)} ${dismissalConcurrentWarning(posts)}。`
}

function classRanges(slot: string) {
  if (!slot.includes(":")) return null
  const found: { className: string; range: string }[] = []
  for (const part of slot.split(",")) {
    const match = part.trim().match(/^([1-6][A-D])\s*:\s*(\d+\s*-\s*\d+|\d+)$/)
    if (match) found.push({ className: match[1], range: match[2].replace(/\s/g, "") })
  }
  return found.length ? found : null
}

function classListed(lockClass: string, className: string) {
  if (!lockClass || !className) return false
  if (lockClass === className) return true
  const parts = lockClass.split(/[、,，]/).map((item) => item.trim())
  if (parts.includes(className)) return true
  const grade = className.match(/^([1-6])[A-D]$/)
  if (grade && lockClass === `P.${grade[1]}`) return true
  return false
}

export function locksFor(data: SchoolData, date: string, className: string, period: string) {
  const [, month, day] = date.split("-").map(Number)
  return data.locked.filter((lock) => {
    const match = lock.dateLabel.match(/(\d+)\s+([A-Za-z]{3})/)
    if (!match) return false
    if (Number(match[1]) !== day || MONTHS[match[2]] !== month) return false
    const ranges = classRanges(lock.slot)
    if (ranges) return ranges.some((range) => range.className === className && periodInSlot(period, range.range))
    if (!lock.slot) return false
    if (!classListed(lock.className, className)) return false
    return periodInSlot(period, lock.slot)
  })
}

export function lockMessage(data: SchoolData, date: string, className: string, period: string) {
  const names = className.split(/[、,，]/).map((item) => item.trim()).filter(Boolean)
  const locks = (names.length ? names : [className]).flatMap((name) => locksFor(data, date, name, period))
  if (!locks.length) return ""
  const programmes = [...new Set(locks.map((lock) => lock.programme).filter(Boolean))]
  const label = /^\d+$/.test(period) ? `第 ${period} 節` : periodLabel(period)
  return `${names[0] || className} ${label}有校外導師「${programmes.join("、")}」。`
}

export function withHidden(data: SchoolData, hiddenKeys: string[]) {
  if (!hiddenKeys.length) return data
  const hidden = new Set(hiddenKeys)
  return { ...data, swaps: data.swaps.filter((swap) => !hidden.has(swap.key)) }
}

export function revertPreview(data: SchoolData, plans: Plan[], hiddenKeys: string[] = []) {
  const rows = plansToSwaps(plans)
  const visible = withHidden(data, hiddenKeys)
  const reverted = withHidden(data, [...hiddenKeys, ...rows.map((row) => row.key)])
  const seen = new Set<string>()
  const cells = rows.flatMap((row) => {
    if (seen.has(row.key)) return []
    seen.add(row.key)
    const current = classSlots(visible, row.date, row.className, rows).find((slot) => slot.period === row.period)
    const base = classSlots(reverted, row.date, row.className, []).find((slot) => slot.period === row.period)
    return [
      {
        date: row.date,
        className: row.className,
        period: row.period,
        teacher: current?.teacher || row.newTeacher,
        course: current?.course || row.newLesson,
        baseTeacher: base?.teacher || row.origTeacher,
        baseCourse: base?.course || "",
      },
    ]
  })
  return { rows, cells }
}

export function planLockMessage(
  data: SchoolData,
  plan: { date: string; className: string; period: string; targetDate?: string; partnerPeriod?: string; mode?: string; legs?: PlanLeg[] }
) {
  const slots = plan.legs?.length
    ? plan.legs.map((leg) => ({ date: leg.date, className: leg.className, period: leg.period }))
    : [{ date: plan.date, className: plan.className, period: plan.period }]
  if (!plan.legs?.length && plan.mode === "swap" && plan.partnerPeriod) {
    slots.push({ date: plan.targetDate || plan.date, className: plan.className, period: plan.partnerPeriod })
  }
  const messages: string[] = []
  for (const slot of slots) {
    const message = lockMessage(data, slot.date, slot.className, slot.period)
    if (message && !messages.includes(message)) messages.push(message)
  }
  return messages.join("")
}

function periodInSlot(period: string, slot: string) {
  if (!slot) return false
  if (slot === period) return true
  const [start, end] = slot.split("-").map(Number)
  const current = Number(period)
  if (!Number.isNaN(start) && !Number.isNaN(end) && !Number.isNaN(current)) {
    return current >= start && current <= end
  }
  return false
}

export function swapWarnings(data: SchoolData, plan: Omit<Plan, "id">, extra: Swap[] = []) {
  const warnings: string[] = []
  if (!plan.partnerTeacher) warnings.push("請選擇代課或對調老師。")
  if (plan.partnerTeacher === plan.teacher) warnings.push("原任老師與接手老師是同一人。")

  const locked = lockMessage(data, plan.date, plan.className, plan.period)
  if (locked) warnings.push(locked)

  const duty = plan.duty || isDuty(plan.period, plan.course)
  if (duty && plan.mode === "swap" && plan.date === plan.targetDate) warnings.push(sameDayDutyMessage())

  const role = morningBlockReason(plan.period, plan.partnerTeacher)
  if (role) warnings.push(role)

  const teachers = plan.teachers?.length ? plan.teachers : [plan.teacher]
  for (const teacher of teachers) {
    if (teacher === plan.teacher) continue
    if (plan.mode === "swap" && teacherBusy(data, plan.targetDate, teacher, plan.partnerPeriod, extra)) {
      warnings.push(`合教老師 ${teacherName(data, teacher)} 在${periodLabel(plan.partnerPeriod)}未能騰空。`)
    }
  }

  if (plan.mode === "cover") {
    if (plan.partnerTeacher && teacherBusy(data, plan.date, plan.partnerTeacher, plan.period, extra)) {
      warnings.push(`${teacherName(data, plan.partnerTeacher)} 在${periodLabel(plan.period)}已有課堂或當值。`)
    } else if (plan.period === "放學" && plan.partnerTeacher) {
      const overlap = dismissalOverlapMessage(data, plan.date, plan.partnerTeacher, extra)
      if (overlap) warnings.push(overlap)
    }
    return warnings
  }

  if (!plan.partnerPeriod) warnings.push("請選擇對調的那一節。")
  if (plan.date === plan.targetDate && plan.partnerPeriod === plan.period) warnings.push("對調的兩節是同一教節。")
  if (plan.partnerTeacher && teacherBusy(data, plan.date, plan.partnerTeacher, plan.period, extra)) {
    warnings.push(`${teacherName(data, plan.partnerTeacher)} 在原日期的${periodLabel(plan.period)}未能騰空。`)
  }
  if (teacherBusy(data, plan.targetDate, plan.teacher, plan.partnerPeriod, extra)) {
    warnings.push(`${teacherName(data, plan.teacher)} 在受調日期的${periodLabel(plan.partnerPeriod)}未能騰空。`)
  }

  const units = buildTeachUnits(data.lessons)
  const origin = placementsFor(units, plan.date, [...data.swaps, ...extra]).filter(
    (placement) => placement.period === plan.period && (placement.classes.includes(plan.className) || placement.location === plan.className)
  )
  const destination = placementsFor(units, plan.targetDate, [...data.swaps, ...extra]).filter(
    (placement) => placement.period === plan.partnerPeriod
  )
  if (origin[0]) {
    warnings.push(
      ...venueMoveWarning({
        occupants: destination.map((placement) => ({ className: placement.className, classes: placement.classes, course: placement.course })),
        incoming: { className: origin[0].className, classes: origin[0].classes, course: origin[0].course },
        outgoing: destination.find((placement) => placement.teachers.includes(plan.partnerTeacher))
          ? {
              className: plan.className,
              classes: [plan.className],
              course: plan.partnerCourse,
            }
          : null,
      })
    )
  }

  const targetLocked = lockMessage(data, plan.targetDate, plan.className, plan.partnerPeriod)
  if (targetLocked) warnings.push(targetLocked)
  return warnings
}

export function changesOn(data: SchoolData, date: string, extra: Swap[] = []) {
  return [...data.swaps, ...extra].filter((swap) => swap.date === date)
}

export function classHasChange(data: SchoolData, date: string, className: string, extra: Swap[] = []) {
  return changesOn(data, date, extra).some((swap) => swap.className === className)
}

export function describeLock(lock: LockedLesson) {
  return `${lock.className} · ${lock.programme} · ${lock.slot || lock.weekday}`
}

export function lessonPeriods() {
  return PERIODS.filter((period) => period.kind === "lesson").map((period) => period.id)
}

export type { Lesson }
