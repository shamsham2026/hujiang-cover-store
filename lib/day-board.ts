import { buildTeachUnits } from "@/lib/coteach"
import { classesInCoursePrefix, subjectOf } from "@/lib/coteach"
import { canonicalDutyPost, displayDutyPost, dutyPostRank, listedDuty, listedDutyPeriod } from "@/lib/duty-posts"
import { CLASSES, PERIODS, periodMeta } from "@/lib/periods"
import { placementsFor, withEmptyMorning, type Placement } from "@/lib/resolve"
import type { SchoolData, Swap } from "@/lib/types"

const CLASS_CODE = /^[1-6][A-D]$/

export type BoardDuty = {
  location: string
  teachers: string
  baseTeachers: string
  /** 代課時是原任，顯示成 玉(代袁)。 */
  cover: string
  changed: boolean
  empty: boolean
  remark: boolean
}

export type BoardCell = {
  course: string
  teachers: string
  baseTeachers: string
  /** 代課時是原任，顯示成 玉(代袁)。 */
  cover: string
  changed: boolean
  duty: boolean
  empty: boolean
}

export type BoardRowModel = {
  period: string
  label: string
  time: string
  duty: boolean
  schoolWide: BoardDuty[]
  cells: Record<string, BoardCell>
}

function classCodeOf(placement: Placement) {
  if (CLASS_CODE.test(placement.className)) return placement.className
  if (CLASS_CODE.test(placement.location)) return placement.location
  const match = placement.course.match(/\(([1-6][A-D])\)/)
  return match?.[1] || ""
}

function people(names: string[]) {
  return names.filter(Boolean).join("、")
}

function changed(placement: Placement) {
  const current = people(placement.teachers)
  const base = people(placement.baseTeachers)
  return Boolean(placement.change) && base.length > 0 && base !== current
}

function coverFor(placement: Placement) {
  if (!placement.change.includes("代")) return ""
  const current = people(placement.teachers)
  const base = people(placement.baseTeachers)
  if (!base || base === current) return ""
  return base
}

function joinCover(left: string, right: string) {
  const names = [...left.split("、"), ...right.split("、")].map((item) => item.trim()).filter(Boolean)
  return [...new Set(names)].join("、")
}

function uniqueJoin(left: string, right: string) {
  return joinCover(left, right)
}

function shortCourse(course: string, className: string) {
  const subject = subjectOf(course, className)
  if (subject !== course) return subject
  const codes = classesInCoursePrefix(course)
  if (codes.length && className && codes[0]?.[0] === className[0]) return subjectOf(course, codes[0])
  return course
}

export function dayBoard(data: SchoolData, date: string, extra: Swap[] = [], classNames: readonly string[] = CLASSES): BoardRowModel[] {
  const units = buildTeachUnits(data.lessons)
  const placements = withEmptyMorning(placementsFor(units, date, [...data.swaps, ...extra]))
  const visible = new Set(classNames)
  const school = new Map<string, BoardDuty[]>()
  const cells = new Map<string, Record<string, BoardCell>>()

  function putCell(period: string, className: string, cell: BoardCell) {
    const row = cells.get(period) || {}
    const prev = row[className]
    if (!prev) {
      row[className] = cell
    } else {
      row[className] = {
        ...prev,
        course: uniqueJoin(prev.course, cell.course),
        teachers: uniqueJoin(prev.teachers, cell.teachers),
        baseTeachers: uniqueJoin(prev.baseTeachers, cell.baseTeachers),
        cover: joinCover(prev.cover, cell.cover),
        changed: prev.changed || cell.changed,
        duty: prev.duty && cell.duty,
        empty: prev.empty && cell.empty,
      }
    }
    cells.set(period, row)
  }

  function addSchool(period: string, location: string, placement: Placement, remark = false) {
    const list = school.get(period) || []
    const current = people(placement.teachers)
    const base = people(placement.baseTeachers)
    const existing = list.find((item) => item.location === location && item.remark === remark)
    if (existing) {
      if (current && !existing.teachers.split("、").includes(current)) {
        existing.teachers = [existing.teachers, current].filter(Boolean).join("、")
      }
      if (base && !existing.baseTeachers.split("、").includes(base)) {
        existing.baseTeachers = [existing.baseTeachers, base].filter(Boolean).join("、")
      }
      existing.cover = joinCover(existing.cover, coverFor(placement))
      existing.changed = existing.changed || changed(placement)
      existing.empty = existing.teachers.length === 0
    } else {
      list.push({
        location,
        teachers: current,
        baseTeachers: base,
        cover: coverFor(placement),
        changed: changed(placement),
        empty: current.length === 0,
        remark,
      })
    }
    school.set(period, list)
  }

  for (const placement of placements) {
    if (placement.duty && listedDutyPeriod(placement.period)) {
      if (placement.unitId.startsWith("empty|")) continue
      const key = canonicalDutyPost(placement.location || placement.course)
      if (!key) continue
      if (!listedDuty(placement.period, key)) continue
      addSchool(placement.period, displayDutyPost(key), placement)
      continue
    }

    if (placement.duty) {
      const className = classCodeOf(placement)
      if (className) {
        if (!visible.has(className)) continue
        putCell(placement.period, className, {
          course: "",
          teachers: people(placement.teachers),
          baseTeachers: people(placement.baseTeachers),
          cover: coverFor(placement),
          changed: changed(placement),
          duty: true,
          empty: Boolean(placement.empty) || placement.teachers.length === 0,
        })
        continue
      }
      addSchool(placement.period, placement.location || placement.course, placement)
      continue
    }

    const targets = placement.classes.filter((className) => visible.has(className))
    for (const className of targets) {
      putCell(placement.period, className, {
        course: shortCourse(placement.course, className),
        teachers: people(placement.teachers),
        baseTeachers: people(placement.baseTeachers),
        cover: coverFor(placement),
        changed: changed(placement),
        duty: false,
        empty: placement.teachers.length === 0,
      })
    }
  }

  return PERIODS.map((period) => {
    const meta = periodMeta(period.id)
    const duties = (school.get(period.id) || []).sort((left, right) => {
      if (listedDutyPeriod(period.id)) {
        if (left.remark !== right.remark) return left.remark ? 1 : -1
        if (left.remark) return left.location.localeCompare(right.location, "zh-Hant")
        return dutyPostRank(period.id, canonicalDutyPost(left.location)) - dutyPostRank(period.id, canonicalDutyPost(right.location))
      }
      if (left.empty !== right.empty) return left.empty ? 1 : -1
      return left.location.localeCompare(right.location, "zh-Hant")
    })
    return {
      period: period.id,
      label: meta.label,
      time: meta.time,
      duty: meta.kind === "duty",
      schoolWide: duties,
      cells: cells.get(period.id) || {},
    }
  })
}
