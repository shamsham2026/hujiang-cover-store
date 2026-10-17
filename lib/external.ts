import { buildTeachUnits } from "@/lib/coteach"
import { CLASSES, periodLabel } from "@/lib/periods"
import { placementsFor } from "@/lib/resolve"
import { classSlots, lockMessage, locksFor, teacherBusy } from "@/lib/schedule"
import type { Plan, PlanLeg, SchoolData, Swap } from "@/lib/types"
import { venueMoveWarning } from "@/lib/venues"

export type ExternalLesson = {
  className: string
  period: string
  programme: string
  course: string
  teachers: string[]
}

export type ExternalExchange = {
  programme: string
  partners: Array<ExternalLesson & { summary: string }>
  blocked: Array<{ summary: string; reason: string }>
  message: string
}

export function markExternal<T extends { className: string; period: string; duty?: boolean }>(data: SchoolData, date: string, slots: T[]) {
  return slots.map((slot) => {
    if (slot.duty || !slot.className) return slot
    const programme = externalProgramme(data, date, slot.className, slot.period)
    return programme ? { ...slot, externalProgramme: programme } : slot
  })
}

export function externalProgramme(data: SchoolData, date: string, className: string, period: string) {
  const names = className.split(/[、,，]/).map((item) => item.trim()).filter(Boolean)
  const programmes = (names.length ? names : [className]).flatMap((name) => locksFor(data, date, name, period).map((lock) => lock.programme))
  return [...new Set(programmes.filter(Boolean))].join("、")
}

export function externalLessons(data: SchoolData, date: string, extra: Swap[] = []): ExternalLesson[] {
  const found: ExternalLesson[] = []
  const seen = new Set<string>()
  for (const className of CLASSES) {
    for (const slot of classSlots(data, date, className, extra)) {
      if (slot.duty || slot.empty || slot.teachers.length === 0) continue
      const programme = externalProgramme(data, date, className, slot.period)
      if (!programme) continue
      const key = `${className}|${slot.period}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push({
        className,
        period: slot.period,
        programme,
        course: slot.course,
        teachers: slot.teachers,
      })
    }
  }
  return found
}

function samePeople(left: string[], right: string[]) {
  const a = [...left].sort().join("、")
  const b = [...right].sort().join("、")
  return a !== "" && a === b
}

function venueClash(data: SchoolData, date: string, period: string, extra: Swap[], incoming: { className: string; course: string }, outgoing: { className: string; course: string }) {
  const units = buildTeachUnits(data.lessons)
  const placements = placementsFor(units, date, [...data.swaps, ...extra]).filter((placement) => placement.period === period && !placement.duty)
  return venueMoveWarning({
    occupants: placements.map((placement) => ({ className: placement.className, classes: placement.classes, course: placement.course })),
    incoming: { className: incoming.className, classes: [incoming.className], course: incoming.course },
    outgoing: { className: outgoing.className, classes: [outgoing.className], course: outgoing.course },
  })[0] || ""
}

function exchangeBlock(data: SchoolData, sourceDate: string, source: ExternalLesson, targetDate: string, target: ExternalLesson, extra: Swap[]) {
  if (samePeople(source.teachers, target.teachers)) return `${source.teachers.join("、")} 兩邊都是這位老師。`
  for (const teacher of source.teachers) {
    if (teacherBusy(data, targetDate, teacher, target.period, extra)) return `${teacher} 在${targetDate === sourceDate ? "" : `${targetDate} `}${periodLabel(target.period)}已有課堂。`
  }
  for (const teacher of target.teachers) {
    if (teacherBusy(data, sourceDate, teacher, source.period, extra)) return `${teacher} 在${targetDate === sourceDate ? "" : `${sourceDate} `}${periodLabel(source.period)}已有課堂。`
  }
  return venueClash(data, targetDate, target.period, extra, source, target) || venueClash(data, sourceDate, source.period, extra, target, source)
}

export function externalExchange(data: SchoolData, date: string, className: string, period: string, extra: Swap[] = [], partnerDate = ""): ExternalExchange {
  const programme = externalProgramme(data, date, className, period)
  if (!programme) return { programme: "", partners: [], blocked: [], message: "" }
  const wanted = partnerDate || date
  const dayWord = wanted === date ? "這一天" : "所選日期"
  const sourceLessons = externalLessons(data, date, extra)
  const lessons = wanted === date ? sourceLessons : externalLessons(data, wanted, extra)
  const source = sourceLessons.find((lesson) => lesson.className === className && lesson.period === period) || {
    className,
    period,
    programme,
    course: "",
    teachers: [],
  }
  const others = lessons.filter((lesson) => wanted !== date || !(lesson.className === className && lesson.period === period))
  if (!others.length || source.teachers.length === 0) {
    return { programme, partners: [], blocked: [], message: `${dayWord}沒有另一節校外導師可以跟「${programme}」對調。` }
  }
  const partners: ExternalExchange["partners"] = []
  const blocked: ExternalExchange["blocked"] = []
  for (const other of others) {
    const when = wanted === date ? "" : `${wanted} `
    const summary = `${className} ${periodLabel(period)}「${programme}」↔ ${other.className} ${when}${periodLabel(other.period)}「${other.programme}」`
    const reason = exchangeBlock(data, date, source, wanted, other, extra)
    if (reason) blocked.push({ summary, reason })
    else partners.push({ ...other, summary })
  }
  return {
    programme,
    partners,
    blocked,
    message: partners.length ? "" : `${dayWord}沒有可以跟「${programme}」對調的校外導師課堂。`,
  }
}

export function externalSwapPlan(date: string, source: ExternalLesson, partner: ExternalLesson, partnerDate = date): Plan {
  const legs: PlanLeg[] = [
    {
      date,
      period: source.period,
      toDate: partnerDate,
      toPeriod: partner.period,
      className: source.className,
      course: source.course,
      teacher: source.teachers[0] || "",
      teachers: source.teachers,
    },
    {
      date: partnerDate,
      period: partner.period,
      toDate: date,
      toPeriod: source.period,
      className: partner.className,
      course: partner.course,
      teacher: partner.teachers[0] || "",
      teachers: partner.teachers,
    },
  ]
  return {
    id: "draft",
    mode: "swap",
    date,
    targetDate: partnerDate,
    period: source.period,
    className: source.className,
    course: source.course,
    teacher: source.teachers[0] || "",
    teachers: source.teachers,
    partnerTeacher: partner.teachers[0] || "",
    partnerTeachers: partner.teachers,
    partnerPeriod: partner.period,
    partnerCourse: partner.course,
    reason: "",
    tier: date === partnerDate ? "同日對調" : "跨日對調",
    legs,
  }
}

export function externalSwapError(data: SchoolData, plan: { mode?: string; date: string; className: string; period: string; targetDate?: string; legs?: PlanLeg[] }) {
  const slots = plan.legs?.length
    ? plan.legs.map((leg) => ({ date: leg.date, className: leg.className, period: leg.period }))
    : [{ date: plan.date, className: plan.className, period: plan.period }]
  const marked = slots.map((slot) => ({ ...slot, programme: externalProgramme(data, slot.date, slot.className, slot.period) }))
  const external = marked.filter((slot) => slot.programme)
  if (!external.length || plan.mode === "cover") return ""
  const lead = lockMessage(data, external[0].date, external[0].className, external[0].period)
  if (marked.some((slot) => !slot.programme)) {
    return `${lead}只可跟校外導師課堂對調。`
  }
  return ""
}
