import { canCoverMorning, type MorningPeriod } from "@/lib/staff"
import { dutyLocation, isDuty } from "@/lib/duty"
import type { Lesson } from "@/lib/types"

export type MorningFit = MorningPeriod | "both" | "none"

export function morningFit(teacher: string): MorningFit {
  const at730 = canCoverMorning("7:30", teacher)
  const at745 = canCoverMorning("7:45", teacher)
  if (at730 && at745) return "both"
  if (at730) return "7:30"
  if (at745) return "7:45"
  return "none"
}

/**
 * 把試算表的「早會前」拆成 7:30 與 7:45。
 * 同一崗位如果同時有主任和只可上 7:45 的老師，就各放一節。
 * 只有一位老師時，放在他符合資格的那一節。主任兩邊都符合時放在 7:30，7:45 留給另外安排。
 */
export function assignMorningPeriod(teachers: string[]): Map<string, MorningPeriod> {
  const placed = new Map<string, MorningPeriod>()
  const both: string[] = []
  const none: string[] = []
  const count = (period: MorningPeriod) => [...placed.values()].filter((item) => item === period).length

  for (const teacher of teachers) {
    const fit = morningFit(teacher)
    if (fit === "7:30" || fit === "7:45") placed.set(teacher, fit)
    else if (fit === "both") both.push(teacher)
    else none.push(teacher)
  }

  for (const teacher of both) {
    if (count("7:30") === 0) placed.set(teacher, "7:30")
    else if (count("7:45") === 0) placed.set(teacher, "7:45")
    else placed.set(teacher, "7:30")
  }

  for (const teacher of none) {
    placed.set(teacher, count("7:30") === 0 ? "7:30" : "7:45")
  }

  return placed
}

export function expandMorningLessons(lessons: Lesson[]): Lesson[] {
  const morning = lessons.filter((lesson) => lesson.period === "早會前" || (lesson.course.includes("早會前") && isDuty(lesson.period, lesson.course) && lesson.period !== "7:30" && lesson.period !== "7:45"))
  const morningIds = new Set(morning)
  const rest = lessons.filter((lesson) => !morningIds.has(lesson))
  const groups = new Map<string, Lesson[]>()

  for (const lesson of morning) {
    const location = dutyLocation(lesson.course) || lesson.course
    const key = `${lesson.day}|${location}`
    const list = groups.get(key) || []
    list.push(lesson)
    groups.set(key, list)
  }

  const expanded: Lesson[] = [...rest]
  for (const group of groups.values()) {
    const slots = assignMorningPeriod(group.map((lesson) => lesson.teacher))
    for (const lesson of group) {
      expanded.push({ ...lesson, period: slots.get(lesson.teacher) || "7:30" })
    }
  }
  return expanded
}
