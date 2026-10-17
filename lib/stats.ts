import type { RecordRow, Swap, Teacher } from "@/lib/types"
import type { HourAdjustmentsDoc, TeacherHourDelta } from "@/lib/hour-adjustments"

export type HourStat = {
  short: string
  full: string
  leave: number
  cover: number
  balance: number
  leaveDelta?: number
  coverDelta?: number
}

type Mark = {
  date: string
  period: string
  className: string
  teacher: string
}

export type TallyOptions = {
  adjustments?: Record<string, Pick<TeacherHourDelta, "leaveDelta" | "coverDelta">>
  exclusions?: string[] | Set<string>
}

function people(value: string) {
  return value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean)
}

function loose(mark: Mark) {
  return `${mark.date}|${mark.period}|${mark.teacher}`
}

function addMark(bucket: Map<string, Mark>, mark: Mark) {
  const shared = loose(mark)
  if (!mark.className) {
    for (const existing of bucket.values()) {
      if (loose(existing) === shared) return
    }
    bucket.set(`${shared}|`, mark)
    return
  }
  for (const [key, existing] of bucket) {
    if (!existing.className && loose(existing) === shared) bucket.delete(key)
  }
  const exact = `${shared}|${mark.className}`
  if (!bucket.has(exact)) bucket.set(exact, mark)
}

function countByTeacher(bucket: Map<string, Mark>) {
  const counts = new Map<string, number>()
  for (const mark of bucket.values()) counts.set(mark.teacher, (counts.get(mark.teacher) || 0) + 1)
  return counts
}

/** 調課列唔計時數；只有代課（同非調課紀錄）先計。請假與代課各算一節；同一日期、節次、班別、老師只計一次。 */
export function countsTowardHours(kind: string) {
  const k = (kind || "").trim()
  if (k.includes("調課")) return false
  return true
}

/** Exclusion / persistence key for a 總紀錄表 row. */
export function exclusionKey(row: Pick<RecordRow, "date" | "period" | "absent" | "cover" | "kind">) {
  return `${row.date}|${row.period}|${row.absent}|${row.cover}|${row.kind}`
}

/** Display label for records 時數 column. */
export function hoursDisplay(kind: string, count?: string, excluded?: boolean) {
  if (!countsTowardHours(kind) || excluded) return "唔計"
  const n = (count || "").trim()
  if (n && /^\d+(\.\d+)?$/.test(n)) return n
  return "1"
}


function exclusionSet(exclusions?: string[] | Set<string>) {
  if (!exclusions) return new Set<string>()
  return exclusions instanceof Set ? exclusions : new Set(exclusions)
}

/** Skip a 課堂代課 swap when a matching record exclusion exists (date + period + absent/cover teachers). */
function swapMatchesExclusion(swap: Swap, excluded: Set<string>) {
  if (!excluded.size) return false
  for (const key of excluded) {
    const parts = key.split("|")
    if (parts.length < 5) continue
    const [date, period, absent, cover] = parts
    if (date !== swap.date) continue
    if (period !== swap.period) continue
    const orig = people(swap.origTeacher)
    const neu = people(swap.newTeacher || swap.newTeachers || "")
    if (absent && !orig.includes(absent)) continue
    if (cover && !neu.includes(cover)) continue
    return true
  }
  return false
}

export function tallyHours(
  teachers: Teacher[],
  records: RecordRow[],
  swaps: Swap[],
  options?: TallyOptions | HourAdjustmentsDoc,
): HourStat[] {
  const leave = new Map<string, Mark>()
  const cover = new Map<string, Mark>()
  const excluded = exclusionSet(options?.exclusions)
  const adjustments = options && "adjustments" in options && options.adjustments ? options.adjustments : {}

  for (const swap of swaps) {
    if (swap.type !== "課堂代課") continue
    if (swapMatchesExclusion(swap, excluded)) continue
    for (const teacher of people(swap.origTeacher)) {
      addMark(leave, { date: swap.date, period: swap.period, className: swap.className, teacher })
    }
    for (const teacher of people(swap.newTeacher || swap.newTeachers || "")) {
      addMark(cover, { date: swap.date, period: swap.period, className: swap.className, teacher })
    }
  }
  for (const row of records) {
    if (!countsTowardHours(row.kind)) continue
    if (excluded.has(exclusionKey(row))) continue
    if (row.absent) addMark(leave, { date: row.date, period: row.period, className: "", teacher: row.absent })
    if (row.cover) addMark(cover, { date: row.date, period: row.period, className: "", teacher: row.cover })
  }

  const leaveCount = countByTeacher(leave)
  const coverCount = countByTeacher(cover)
  const known = new Map<string, string>()
  for (const teacher of teachers) {
    if (teacher.short) known.set(teacher.short, teacher.full || teacher.short)
  }
  for (const teacher of [...leaveCount.keys(), ...coverCount.keys(), ...Object.keys(adjustments)]) {
    if (!known.has(teacher)) known.set(teacher, teacher)
  }

  return [...known.entries()]
    .map(([short, full]) => {
      const leaveDelta = adjustments[short]?.leaveDelta || 0
      const coverDelta = adjustments[short]?.coverDelta || 0
      const leaveHours = Math.max(0, (leaveCount.get(short) || 0) + leaveDelta)
      const coverHours = Math.max(0, (coverCount.get(short) || 0) + coverDelta)
      return {
        short,
        full,
        leave: leaveHours,
        cover: coverHours,
        balance: coverHours - leaveHours,
        leaveDelta,
        coverDelta,
      }
    })
    .sort((left, right) => right.cover - left.cover || left.full.localeCompare(right.full, "zh-Hant") || left.short.localeCompare(right.short, "zh-Hant"))
}
