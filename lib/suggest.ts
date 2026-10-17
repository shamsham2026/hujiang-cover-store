import { buildTeachUnits, type TeachUnit } from "@/lib/coteach"
import { dayChar, schoolWeek } from "@/lib/dates"
import { dismissalConcurrent, dismissalConcurrentWarning, isDuty, sameDayDutyMessage } from "@/lib/duty"
import { canonicalDutyPost, isActivityRemark } from "@/lib/duty-posts"
import { observationReason } from "@/lib/movement"
import { LESSON_PERIODS } from "@/lib/periods"
import { morningBlockReason } from "@/lib/staff"
import { rankCoverTeachers, type RankInput } from "@/lib/ranking"
import { searchDutySwaps, searchLessonCycles, type CycleLesson, type Occupant, type SwapSearch } from "@/lib/cycles"
import { placementsFor, type Placement } from "@/lib/resolve"
import { lockMessage, teacherBusy } from "@/lib/schedule"
import type { SchoolData, Swap } from "@/lib/types"

function fullName(data: SchoolData, short: string) {
  return data.teachers.find((teacher) => teacher.short === short)?.full || ""
}

function absenceMap(data: SchoolData) {
  const map = new Map<string, number>()
  for (const row of data.records) {
    if (!row.absent) continue
    map.set(row.absent, (map.get(row.absent) || 0) + 1)
  }
  return map
}

function teachesSet(units: TeachUnit[]) {
  const set = new Set<string>()
  for (const unit of units) {
    if (unit.duty) continue
    for (const className of unit.classes) {
      for (const teacher of unit.teachers) set.add(`${teacher}|${className}`)
    }
  }
  return set
}

function toOccupant(placement: Placement): Occupant {
  return {
    unitId: placement.unitId,
    period: placement.period,
    className: placement.className,
    classes: placement.classes,
    course: placement.course,
    subject: placement.subject,
    teachers: placement.teachers,
    duty: placement.duty,
  }
}

export function occupancyByDate(units: TeachUnit[], dates: string[], swaps: Swap[]) {
  const map = new Map<string, Occupant[]>()
  for (const date of dates) {
    map.set(date, placementsFor(units, date, swaps).map(toOccupant))
  }
  return map
}

function nameDuty(lesson: CycleLesson): CycleLesson {
  if (!lesson.duty) return lesson
  const post = canonicalDutyPost(lesson.location || lesson.course || lesson.className)
  if (!post) return lesson
  return { ...lesson, className: post, classes: [post], location: post }
}

function placementLesson(placement: Placement, date: string): CycleLesson {
  return {
    id: placement.unitId,
    day: dayChar(date),
    date,
    period: placement.period,
    className: placement.className,
    classes: placement.classes.length ? placement.classes : placement.className ? [placement.className] : [],
    course: placement.course,
    subject: placement.subject,
    teachers: placement.teachers,
    duty: placement.duty,
    location: placement.location,
    coTeach: placement.coTeach || placement.teachers.length > 1,
  }
}

function freeCount(teacher: string, placements: Placement[]) {
  let count = 0
  for (const period of LESSON_PERIODS) {
    const busy = placements.some((placement) => placement.period === period && placement.teachers.includes(teacher))
    if (!busy) count += 1
  }
  return count
}

function allTeachers(data: SchoolData, units: TeachUnit[]) {
  const names = new Set<string>()
  for (const teacher of data.teachers) if (teacher.short) names.add(teacher.short)
  for (const unit of units) for (const teacher of unit.teachers) names.add(teacher)
  return [...names]
}

export function coverCandidates(args: {
  data: SchoolData
  date: string
  period: string
  className?: string
  exclude?: string[]
  swaps?: Swap[]
}) {
  const units = buildTeachUnits(args.data.lessons)
  const swaps = [...args.data.swaps, ...(args.swaps || [])]
  const placements = placementsFor(units, args.date, swaps)
  const absences = absenceMap(args.data)
  const taught = teachesSet(units)
  const excluded = new Set(args.exclude || [])
  const className = args.className || ""
  const inputs: RankInput[] = []

  for (const teacher of allTeachers(args.data, units)) {
    if (excluded.has(teacher)) continue
    const hits = placements.filter(
      (placement) =>
        placement.period === args.period &&
        placement.teachers.includes(teacher) &&
        !isActivityRemark(placement.period, placement.location || placement.className, placement.course)
    )
    const concurrent = dismissalConcurrent(args.period, hits)
    const busy = hits.length > 0 && !concurrent
    const posts = concurrent
      ? hits.map((placement) => canonicalDutyPost(placement.location || placement.className || placement.course))
      : []
    const role = morningBlockReason(args.period, teacher)
    const eligible = !role
    inputs.push({
      teacher,
      fullName: fullName(args.data, teacher),
      freeCount: freeCount(teacher, placements),
      absenceCount: absences.get(teacher) || 0,
      teachesClass: className ? taught.has(`${teacher}|${className}`) : false,
      busy,
      eligible,
      ineligibleReason: role || undefined,
      warning: concurrent ? dismissalConcurrentWarning(posts) : undefined,
    })
  }

  return rankCoverTeachers(inputs)
}

export function suggestForSlot(args: {
  data: SchoolData
  date: string
  unitId: string
  targetDate?: string
  swaps?: Swap[]
}): { search: SwapSearch; period: string; duty: boolean } | null {
  const units = buildTeachUnits(args.data.lessons)
  const swaps = [...args.data.swaps, ...(args.swaps || [])]
  const week = [...new Set([...schoolWeek(args.date), args.targetDate || ""].filter(Boolean))]
  const byDate = occupancyByDate(units, week, swaps)
  const sourcePlacement = (byDate.get(args.date) || []).find((row) => row.unitId === args.unitId)
  const template = units.find((item) => item.id === args.unitId)
  if (!sourcePlacement && !template) return null
  const source = sourcePlacement
    ? placementLesson(
        {
          unitId: sourcePlacement.unitId,
          day: dayChar(args.date),
          period: sourcePlacement.period,
          className: sourcePlacement.className,
          classes: sourcePlacement.classes,
          course: sourcePlacement.course,
          subject: sourcePlacement.subject,
          teachers: sourcePlacement.teachers,
          baseCourse: sourcePlacement.course,
          baseTeachers: sourcePlacement.teachers,
          duty: sourcePlacement.duty,
          location: template?.location || "",
          coTeach: template?.coTeach || sourcePlacement.teachers.length > 1,
          change: "",
        },
        args.date
      )
    : null
  if (!source || source.teachers.length === 0) return null

  const watched = observationReason(args.data, source.date, source.className, source.course, source.period)
  if (watched) {
    return { search: { cycles: [], blocked: [], prompt: watched, dutyNote: "" }, period: source.period, duty: false }
  }

  const sourceLocked = lockPrompt(args.data, source)
  if (sourceLocked) {
    return {
      search: { cycles: [], blocked: [], prompt: "", dutyNote: "" },
      period: source.period,
      duty: Boolean(source.duty || template?.duty),
    }
  }

  if (source.duty || (template && isDuty(template.period, template.course))) {
    const named = nameDuty(source)
    const target = args.targetDate && args.targetDate !== args.date ? args.targetDate : ""
    if (!target) {
      return { search: { cycles: [], blocked: [], prompt: "", dutyNote: sameDayDutyMessage() }, period: source.period, duty: true }
    }
    if (!byDate.has(target)) byDate.set(target, placementsFor(units, target, swaps).map(toOccupant))
    const candidates = (byDate.get(target) || []).filter((row) => row.duty).map((row) =>
      nameDuty(placementLesson(
        {
          unitId: row.unitId,
          day: dayChar(target),
          period: row.period,
          className: row.className,
          classes: row.classes,
          course: row.course,
          subject: row.subject,
          teachers: row.teachers,
          baseCourse: row.course,
          baseTeachers: row.teachers,
          duty: true,
          location: "",
          coTeach: false,
          change: "",
        },
        target
      ))
    )
    return { search: applyLocks(args.data, searchDutySwaps(named, target, candidates, byDate)), period: source.period, duty: true }
  }

  const pinned = args.targetDate || ""
  const poolDates = pinned ? [pinned] : schoolWeek(args.date)
  if (pinned && !byDate.has(pinned)) byDate.set(pinned, placementsFor(units, pinned, swaps).map(toOccupant))
  const pool: CycleLesson[] = []
  for (const date of poolDates) {
    for (const row of byDate.get(date) || []) {
      if (row.duty) continue
      if (!row.classes.some((className) => source.classes.includes(className)) && row.className !== source.className) continue
      pool.push(
        placementLesson(
          {
            unitId: row.unitId,
            day: dayChar(date),
            period: row.period,
            className: row.className,
            classes: row.classes,
            course: row.course,
            subject: row.subject,
            teachers: row.teachers,
            baseCourse: row.course,
            baseTeachers: row.teachers,
            duty: false,
            location: "",
            coTeach: row.teachers.length > 1,
            change: "",
          },
          date
        )
      )
    }
  }
  return { search: applyLocks(args.data, searchLessonCycles(source, pool, byDate, pinned)), period: source.period, duty: false }
}

function lockPrompt(data: SchoolData, lesson: { date: string; className: string; classes?: string[]; period: string }) {
  const names = lesson.classes?.length ? lesson.classes : lesson.className.split(/[、,，]/).map((item) => item.trim()).filter(Boolean)
  const messages = names.map((name) => lockMessage(data, lesson.date, name, lesson.period)).filter(Boolean)
  return [...new Set(messages)].join("")
}

function applyLocks(data: SchoolData, search: SwapSearch): SwapSearch {
  const cycles = search.cycles.filter((cycle) => cycle.legs.every((leg) => !lockPrompt(data, leg)))
  return { ...search, cycles, prompt: cycles.length ? search.prompt : "" }
}

export function teacherIsFree(data: SchoolData, date: string, teacher: string, period: string, swaps: Swap[] = []) {
  return !teacherBusy(data, date, teacher, period, swaps)
}
