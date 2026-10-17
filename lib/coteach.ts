import { isDuty, dutyLocation } from "@/lib/duty"
import { expandMorningLessons } from "@/lib/morning"
import type { Lesson } from "@/lib/types"

/**
 * 已知合教。即使試算表把兩位老師拆成不同列、或 6A／6B 分開記，同一節仍視為合教。
 * 4D數學標成「部份」：只有該節真的有兩位老師才合併，不把其他節的老師拉進來。
 */
export const KNOWN_COTEACH = [
  { id: "4A英文", classes: ["4A"], subjects: ["英文"] },
  { id: "4B中文", classes: ["4B"], subjects: ["中文"] },
  { id: "4D數學", classes: ["4D"], subjects: ["數學"], partial: true },
  { id: "3C中文", classes: ["3C"], subjects: ["中文", "中作"] },
  { id: "5B中文", classes: ["5B"], subjects: ["中文", "中作"] },
  { id: "6AB中文", classes: ["6A", "6B"], subjects: ["中文"] },
] as const

export type TeachUnit = {
  id: string
  day: string
  period: string
  className: string
  classes: string[]
  course: string
  subject: string
  teachers: string[]
  duty: boolean
  location: string
  coTeach: boolean
}

/** 6AB 是 6A 與 6B，不是把 6A 切走後剩下 B。 */
export function classesInCoursePrefix(course: string) {
  const lead = course.trim().match(/^(?:[1-6][A-D]{1,2})+/)
  if (!lead) return []
  const codes: string[] = []
  for (const match of lead[0].matchAll(/([1-6])([A-D]{1,2})/g)) {
    for (const section of match[2]) codes.push(`${match[1]}${section}`)
  }
  return codes
}

export function subjectOf(course: string, className: string) {
  const raw = course.trim()
  if (!raw) return ""
  if (isDuty("", raw) || raw.includes("當值") || raw.includes("班主任")) return raw
  const codes = classesInCoursePrefix(raw)
  const lead = raw.match(/^(?:[1-6][A-D]{1,2})+/)
  if (lead && (!className || codes.includes(className) || raw.startsWith(className))) return raw.slice(lead[0].length).trim() || raw
  if (className && raw.startsWith(className)) return raw.slice(className.length).trim() || raw
  return raw
}

export function knownGroup(className: string, subject: string) {
  return KNOWN_COTEACH.find((group) => group.classes.includes(className as never) && group.subjects.includes(subject as never))
}

const unitCache = new WeakMap<Lesson[], TeachUnit[]>()

export function buildTeachUnits(lessons: Lesson[]): TeachUnit[] {
  const cached = unitCache.get(lessons)
  if (cached) return cached

  const expanded = expandMorningLessons(lessons)
  const buckets = new Map<string, Lesson[]>()

  for (const lesson of expanded) {
    const duty = isDuty(lesson.period, lesson.course)
    if (duty) {
      const key = `${lesson.day}|${lesson.period}|${lesson.course}|${lesson.teacher}|duty`
      buckets.set(key, [lesson])
      continue
    }
    const subject = subjectOf(lesson.course, lesson.className)
    const group = knownGroup(lesson.className, subject)
    const classKey = group && group.classes.length > 1 ? group.id : lesson.className || subject
    const key = `${lesson.day}|${lesson.period}|${classKey}|${subject}`
    const list = buckets.get(key) || []
    list.push(lesson)
    buckets.set(key, list)
  }

  const units: TeachUnit[] = []
  for (const [key, rows] of buckets) {
    const first = rows[0]
    const duty = isDuty(first.period, first.course)
    const classes = [...new Set(rows.map((row) => row.className).filter(Boolean))]
    const teachers = orderedTeachers(rows)
    const subject = duty ? first.course : subjectOf(first.course, first.className)
    const course = rows.map((row) => row.course).sort((a, b) => a.length - b.length)[0] || first.course
    units.push({
      id: key,
      day: first.day,
      period: first.period,
      className: classes.length > 1 ? classes.join("、") : classes[0] || first.className,
      classes,
      course,
      subject,
      teachers,
      duty,
      location: dutyLocation(first.course) || (duty ? first.className : ""),
      coTeach: !duty && teachers.length > 1,
    })
  }

  unitCache.set(lessons, units)
  return units
}

export function unitTeachersLabel(teachers: string[]) {
  return teachers.filter(Boolean).join("、")
}

/** 本班課程的老師在前，跨班小組（例如 6AB中作的舒）排在後面。 */
function orderedTeachers(rows: Lesson[]) {
  const own: string[] = []
  const span: string[] = []
  for (const row of rows) {
    if (!row.teacher || own.includes(row.teacher) || span.includes(row.teacher)) continue
    if (classesInCoursePrefix(row.course).length > 1) span.push(row.teacher)
    else own.push(row.teacher)
  }
  return [...own, ...span]
}
