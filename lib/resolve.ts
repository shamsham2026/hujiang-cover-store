import { buildTeachUnits, classesInCoursePrefix, subjectOf, type TeachUnit } from "@/lib/coteach"
import { classLabels } from "@/lib/class-unit"
import { dayChar } from "@/lib/dates"
import { dutyLocation } from "@/lib/duty"
import { sortByPeriod } from "@/lib/periods"
import type { ResolvedSlot, SchoolData, Swap } from "@/lib/types"

export type Placement = {
  unitId: string
  day: string
  period: string
  className: string
  classes: string[]
  course: string
  subject: string
  teachers: string[]
  baseCourse: string
  baseTeachers: string[]
  duty: boolean
  location: string
  coTeach: boolean
  change: string
  empty?: boolean
}

function splitTeachers(value: string | undefined) {
  return (value || "")
    .split(/[、,，]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function aimedAt(unit: TeachUnit, swap: Swap) {
  const names = classLabels(swap.className)
  const targets = names.length ? names : [swap.className]
  return targets.some(
    (name) =>
      unit.classes.includes(name) ||
      name === unit.className ||
      classLabels(unit.className).includes(name) ||
      (unit.location !== "" && name === unit.location) ||
      (unit.duty && name === dutyLocation(unit.course))
  )
}

/**
 * 調入課堂用自己的班別。6A數學對上 6AB中作時，只改 6A 那一格，
 * 不要把小組的 6B 也寫成 6A數學。
 */
function swapHits(unit: TeachUnit, swap: Swap) {
  if (swap.period !== unit.period || !aimedAt(unit, swap)) return false
  if (unit.duty) return true
  const incoming = classesInCoursePrefix(swap.newLesson || "")
  if (!incoming.length) return true
  return incoming.some((name) => unit.classes.includes(name) || classLabels(unit.className).includes(name))
}

function uniqueNames(values: string[]) {
  return [...new Set(values.flatMap((value) => classLabels(value)).filter(Boolean))]
}

export function placementsFor(units: TeachUnit[], date: string, swaps: Swap[]): Placement[] {
  const day = dayChar(date)
  const todays = swaps.filter((swap) => swap.date === date)
  const placements: Placement[] = []

  for (const unit of units) {
    if (unit.day !== day) continue
    let teachers = [...unit.teachers]
    let course = unit.course
    let className = unit.className
    let classes = [...unit.classes]
    let subject = unit.subject
    let coTeach = unit.coTeach
    let change = ""
    const swap = [...todays].reverse().find((item) => swapHits(unit, item))
    if (swap) {
      const next = splitTeachers(swap.newTeachers || swap.newTeacher)
      if (next.length) teachers = next
      if (swap.newLesson) course = swap.newLesson
      change = swap.type || "調動"
      if (!unit.duty) {
        const incoming = classesInCoursePrefix(course)
        if (incoming.length) {
          const kept = classes.filter((name) => incoming.includes(name))
          classes = kept.length ? kept : incoming
          className = classes.join("、")
          subject = subjectOf(course, classes[0] || "")
        }
        coTeach = teachers.length > 1
      }
    }
    placements.push({
      unitId: unit.id,
      day: unit.day,
      period: unit.period,
      className,
      classes,
      course,
      subject,
      teachers: teachers.filter(Boolean),
      baseCourse: unit.course,
      baseTeachers: unit.teachers,
      duty: unit.duty,
      location: unit.location,
      coTeach,
      change,
    })
  }

  return collapseIncoming(placements)
}

/** 同一節、同一班、同一調入課堂只留一格。小組有多課室時，不能複製成多條正規班課。 */
function collapseIncoming(placements: Placement[]) {
  const kept: Placement[] = []
  const seen = new Map<string, Placement>()
  for (const placement of placements) {
    if (!placement.change || placement.duty) {
      kept.push(placement)
      continue
    }
    const key = `${placement.period}|${[...placement.classes].sort().join(",")}|${placement.course}|${placement.teachers.join("、")}`
    const prior = seen.get(key)
    if (!prior) {
      seen.set(key, placement)
      kept.push(placement)
      continue
    }
    prior.baseTeachers = uniqueNames([...prior.baseTeachers, ...placement.baseTeachers])
    prior.baseCourse = uniqueNames([prior.baseCourse, placement.baseCourse]).join("、")
  }
  return kept
}

export function withEmptyMorning(placements: Placement[]) {
  const locations = new Set<string>()
  for (const placement of placements) {
    if (placement.period === "7:30" || placement.period === "7:45") {
      if (placement.location) locations.add(placement.location)
    }
  }
  const extras: Placement[] = []
  for (const location of locations) {
    for (const period of ["7:30", "7:45"] as const) {
      const exists = placements.some((placement) => placement.period === period && placement.location === location)
      if (exists) continue
      extras.push({
        unitId: `empty|${period}|${location}`,
        day: "",
        period,
        className: location,
        classes: [],
        course: `早會前當值(${location})`,
        subject: `早會前當值(${location})`,
        teachers: [],
        baseCourse: `早會前當值(${location})`,
        baseTeachers: [],
        duty: true,
        location,
        coTeach: false,
        change: "",
        empty: true,
      })
    }
  }
  return [...placements, ...extras]
}

export function toSlot(placement: Placement, away = false): ResolvedSlot {
  const teachers = away ? placement.baseTeachers : placement.teachers
  const course = away ? placement.baseCourse : placement.course
  return {
    period: placement.period,
    className: placement.duty ? placement.location || placement.className : placement.className,
    course,
    teacher: teachers.join("、"),
    teachers,
    baseCourse: placement.baseCourse,
    baseTeacher: placement.baseTeachers[0] || "",
    baseTeachers: placement.baseTeachers,
    change: placement.change,
    away,
    duty: placement.duty,
    coTeach: !away && teachers.length > 1,
    location: placement.location,
    unitId: placement.unitId,
    empty: !away && placement.teachers.length === 0,
  }
}

export function slotsForClass(data: SchoolData, date: string, className: string, extra: Swap[] = []) {
  const units = buildTeachUnits(data.lessons)
  const placements = placementsFor(units, date, [...data.swaps, ...extra])
  return sortByPeriod(
    placements
      .filter((placement) => placement.classes.includes(className) || placement.className === className)
      .map((placement) => toSlot(placement))
  )
}

export function slotsForTeacher(data: SchoolData, date: string, teacher: string, extra: Swap[] = []) {
  const units = buildTeachUnits(data.lessons)
  const placements = placementsFor(units, date, [...data.swaps, ...extra])
  const current = sortByPeriod(
    placements.filter((placement) => placement.teachers.includes(teacher)).map((placement) => toSlot(placement))
  )
  const away = sortByPeriod(
    placements
      .filter((placement) => placement.baseTeachers.includes(teacher) && !placement.teachers.includes(teacher))
      .map((placement) => toSlot(placement, true))
  )
  return { current, away }
}

export function slotsForDuty(data: SchoolData, date: string, extra: Swap[] = []) {
  const units = buildTeachUnits(data.lessons)
  const placements = withEmptyMorning(placementsFor(units, date, [...data.swaps, ...extra]).filter((placement) => placement.duty))
  return sortByPeriod(placements.map((placement) => toSlot(placement)))
}
