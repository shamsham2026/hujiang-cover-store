import { periodLabel } from "@/lib/periods"
import { canCoverMorning, morningBlockReason, type MorningPeriod } from "@/lib/staff"
import { dismissalConcurrent, dismissalConcurrentWarning, sameDayDutyMessage } from "@/lib/duty"
import { canonicalDutyPost, isActivityRemark } from "@/lib/duty-posts"
import { venueMoveWarning, type VenueOccupant } from "@/lib/venues"
import type { PlanLeg } from "@/lib/types"

export type CycleLesson = {
  id: string
  day: string
  date: string
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

export type Occupant = {
  unitId: string
  period: string
  className: string
  classes: string[]
  course: string
  subject: string
  teachers: string[]
  duty: boolean
}

export type SwapCycle = {
  id: string
  tier: "同日對調" | "同日三方" | "同日四方" | "跨日對調" | "跨日三方"
  sameDay: boolean
  legs: PlanLeg[]
  summary: string
  warnings: string[]
}

export type BlockedSwap = {
  summary: string
  reason: string
}

export type SwapSearch = {
  cycles: SwapCycle[]
  blocked: BlockedSwap[]
  prompt: string
  dutyNote: string
}

const TIER_ORDER = ["同日對調", "同日三方", "同日四方", "跨日對調", "跨日三方"]

function names(teachers: string[]) {
  return teachers.filter(Boolean).join("、") || "未編"
}

function legSummary(leg: PlanLeg) {
  return `${names(leg.teachers)} ${leg.course} ${periodLabel(leg.period)}→${periodLabel(leg.toPeriod)}`
}

export function legsFromChain(chain: CycleLesson[]): PlanLeg[] {
  return chain.map((lesson, index) => {
    const next = chain[(index + 1) % chain.length]
    return {
      date: lesson.date,
      period: lesson.period,
      toDate: next.date,
      toPeriod: next.period,
      className: lesson.classes[0] || lesson.className,
      classes: lesson.classes,
      course: lesson.course,
      teacher: lesson.teachers[0] || "",
      teachers: lesson.teachers,
    }
  })
}

function periodHits(byDate: Map<string, Occupant[]>, teacher: string, date: string, period: string, exceptIds: Set<string>) {
  const rows = byDate.get(date) || []
  return rows.filter((row) => {
    if (row.period !== period || exceptIds.has(row.unitId) || !row.teachers.includes(teacher)) return false
    if (isActivityRemark(row.period, row.className, row.course)) return false
    return true
  })
}

function occupantsAt(byDate: Map<string, Occupant[]>, date: string, period: string, exceptIds: Set<string>): VenueOccupant[] {
  return (byDate.get(date) || [])
    .filter((row) => row.period === period && !exceptIds.has(row.unitId))
    .map((row) => ({ className: row.className, classes: row.classes, course: row.course }))
}

type Attempt = { ok: true; warnings: string[] } | { ok: false; kind: "busy" | "venue" | "role"; reason: string }

function tryChain(chain: CycleLesson[], byDate: Map<string, Occupant[]>): Attempt {
  const warnings: string[] = []
  for (let index = 0; index < chain.length; index += 1) {
    const moving = chain[index]
    const dest = chain[(index + 1) % chain.length]
    const except = new Set<string>([dest.id])
    for (const teacher of moving.teachers) {
      if (moving.duty && (dest.period === "7:30" || dest.period === "7:45")) {
        const role = morningBlockReason(dest.period, teacher)
        if (role) return { ok: false, kind: "role", reason: `${teacher}：${role}` }
      }
      const hits = periodHits(byDate, teacher, dest.date, dest.period, except)
      if (dismissalConcurrent(dest.period, hits) && moving.period === "放學" && moving.duty) {
        const posts = hits.map((row) => canonicalDutyPost(row.className || row.course))
        warnings.push(`${teacher} ${dismissalConcurrentWarning(posts)}。`)
      } else if (hits.length) {
        const coteach = moving.coTeach ? "合教老師要一起調，" : ""
        return {
          ok: false,
          kind: "busy",
          reason: `${coteach}${teacher} 在${periodLabel(dest.period)}已有其他課堂或當值。`,
        }
      }
    }
    const venue = venueMoveWarning({
      occupants: occupantsAt(byDate, dest.date, dest.period, new Set()),
      incoming: { className: moving.className, classes: moving.classes, course: moving.course },
      outgoing: { className: dest.className, classes: dest.classes, course: dest.course },
    })
    if (venue.length) return { ok: false, kind: "venue", reason: venue[0] }
  }
  return { ok: true, warnings }
}

function toCycle(chain: CycleLesson[], byDate: Map<string, Occupant[]>): SwapCycle | null {
  const attempt = tryChain(chain, byDate)
  if (!attempt.ok) return null
  const sameDay = chain.every((lesson) => lesson.date === chain[0].date)
  const size = chain.length
  const tier = sameDay
    ? size === 2
      ? "同日對調"
      : size === 3
        ? "同日三方"
        : "同日四方"
    : size === 2
      ? "跨日對調"
      : "跨日三方"
  const legs = legsFromChain(chain)
  const last = legs[legs.length - 1]
  const head = chain[0]
  if (last.toDate !== head.date || last.toPeriod !== head.period) return null
  const several = new Set(chain.map((lesson) => lesson.date)).size > 1
  const arrow = chain.map((lesson) => `${several ? `${lesson.date.slice(5)} ` : ""}${names(lesson.teachers)} ${periodLabel(lesson.period)}`).join(" → ")
  return {
    id: chain.map((lesson) => lesson.id).join(">"),
    tier,
    sameDay,
    legs,
    summary: `${arrow} → 回到${names(head.teachers)}的${periodLabel(head.period)}`,
    warnings: attempt.warnings,
  }
}

function pushUnique(list: SwapCycle[], cycle: SwapCycle | null, cap: number) {
  if (!cycle || list.length >= cap) return
  if (list.some((item) => item.id === cycle.id)) return
  list.push(cycle)
}

export function searchLessonCycles(source: CycleLesson, pool: CycleLesson[], byDate: Map<string, Occupant[]>, pinnedDate = ""): SwapSearch {
  if (source.duty) {
    return { cycles: [], blocked: [], prompt: "", dutyNote: sameDayDutyMessage() }
  }

  const pinned = pinnedDate.trim()
  const others = pool.filter((lesson) => lesson.id !== source.id && !lesson.duty && sharesClass(source, lesson) && (!pinned || lesson.date === pinned))
  const same = pinned && pinned !== source.date ? [] : others.filter((lesson) => lesson.date === source.date)
  const cross = pinned === source.date ? [] : others.filter((lesson) => lesson.date !== source.date)
  const cycles: SwapCycle[] = []
  const blocked: BlockedSwap[] = []
  const busyNotes: string[] = []

  const consider = (chain: CycleLesson[], cap: number, recordBlock: boolean) => {
    const attempt = tryChain(chain, byDate)
    if (attempt.ok) {
      pushUnique(cycles, toCycle(chain, byDate), cap)
      return
    }
    if (!recordBlock) return
    const summary = chain.map((lesson) => `${names(lesson.teachers)} ${periodLabel(lesson.period)}`).join(" → ")
    if ((attempt.kind === "venue" || attempt.kind === "busy") && blocked.length < 4) blocked.push({ summary, reason: attempt.reason })
    if (attempt.kind === "busy" && busyNotes.length < 3) busyNotes.push(attempt.reason)
  }

  for (const partner of same) consider([source, partner], 12, true)

  const skipSameMulti = Boolean(pinned) && cycles.some((cycle) => cycle.tier === "同日對調")
  let three = 0
  for (const second of skipSameMulti ? [] : same) {
    if (three >= 6) break
    for (const third of same) {
      if (third.id === second.id) continue
      const before = cycles.length
      consider([source, second, third], 6 + cycles.filter((item) => item.tier !== "同日三方").length, false)
      if (cycles.length > before && cycles[cycles.length - 1]?.tier === "同日三方") three += 1
      if (three >= 6) break
    }
  }

  let four = 0
  let fourChecks = 0
  if (!skipSameMulti && same.length <= 10) {
    for (const second of same) {
      if (four >= 3 || fourChecks > 250) break
      for (const third of same) {
        if (third.id === second.id) continue
        for (const fourth of same) {
          if (fourth.id === second.id || fourth.id === third.id) continue
          fourChecks += 1
          if (fourChecks > 250 || four >= 3) break
          const before = cycles.length
          consider([source, second, third, fourth], 99, false)
          if (cycles.length > before && cycles[cycles.length - 1]?.tier === "同日四方") four += 1
        }
        if (four >= 3 || fourChecks > 250) break
      }
    }
  }

  for (const partner of cross.slice(0, pinned ? cross.length : 24)) consider([source, partner], 8 + cycles.filter((item) => item.tier !== "跨日對調").length, Boolean(pinned))

  const skipCrossMulti = Boolean(pinned) && cycles.some((cycle) => cycle.tier === "跨日對調")
  const crossSample = skipCrossMulti ? [] : cross.slice(0, pinned ? cross.length : 12)
  let crossThree = 0
  for (const second of crossSample) {
    if (crossThree >= 4) break
    for (const third of [...same, ...crossSample]) {
      if (third.id === second.id) continue
      const before = cycles.length
      consider([source, second, third], 99, false)
      if (cycles.length > before && cycles[cycles.length - 1]?.tier === "跨日三方") crossThree += 1
      if (crossThree >= 4) break
    }
  }

  cycles.sort((left, right) => TIER_ORDER.indexOf(left.tier) - TIER_ORDER.indexOf(right.tier) || left.summary.localeCompare(right.summary, "zh-Hant"))

  const hasDirect = cycles.some((cycle) => cycle.tier === "同日對調")
  const hasMulti = cycles.some((cycle) => cycle.tier === "同日三方" || cycle.tier === "同日四方")
  let prompt = ""
  if (!hasDirect && hasMulti) {
    prompt = `這節不能直接對調，需要多方調課。${busyNotes[0] || ""} 下面每一圈的最後一節都會回到原老師的課表。`.replace(/\s+/g, " ").trim()
  } else if (!hasDirect && busyNotes.length) {
    prompt = `這節不能直接對調。${busyNotes[0]}`
  } else if (hasMulti && busyNotes.length) {
    prompt = `有老師不能直接對調，需要多方調課。${busyNotes[0]} 下面每一圈的最後一節都會回到原老師的課表。`
  }

  return { cycles, blocked, prompt, dutyNote: "" }
}

/** 把 source 的課調到 target 那一格。直接對調不成時，才用三方、四方，而且第一跳必須落在指定那一節。 */
export function searchMoveOnto(source: CycleLesson, target: CycleLesson, pool: CycleLesson[], byDate: Map<string, Occupant[]>): SwapSearch {
  if (source.duty || target.duty) {
    return { cycles: [], blocked: [], prompt: "當值不能用這個方式調到指定課節。", dutyNote: sameDayDutyMessage() }
  }
  const cycles: SwapCycle[] = []
  const blocked: BlockedSwap[] = []
  const others = pool.filter((lesson) => lesson.id !== source.id && lesson.id !== target.id && !lesson.duty && sharesClass(source, lesson))

  const consider = (chain: CycleLesson[]) => {
    const cycle = toCycle(chain, byDate)
    if (cycle) {
      pushUnique(cycles, cycle, 4)
      return
    }
    const attempt = tryChain(chain, byDate)
    if (!attempt.ok && blocked.length < 3) {
      const summary = chain.map((lesson) => `${names(lesson.teachers)} ${periodLabel(lesson.period)}`).join(" → ")
      blocked.push({ summary, reason: attempt.reason })
    }
  }

  consider([source, target])
  if (!cycles.length) {
    for (const other of others) {
      consider([source, target, other])
      if (cycles.length >= 3) break
    }
  }
  if (!cycles.length && others.length <= 8) {
    let checks = 0
    for (const second of others) {
      for (const third of others) {
        if (second.id === third.id) continue
        checks += 1
        if (checks > 80 || cycles.length >= 2) break
        consider([source, target, second, third])
      }
      if (cycles.length >= 2) break
    }
  }

  const prompt = cycles.length
    ? ""
    : blocked[0]?.reason || `${names(source.teachers)}的${periodLabel(source.period)}不能調到${periodLabel(target.period)}。`
  return { cycles, blocked, prompt, dutyNote: "" }
}

function sharesClass(left: CycleLesson, right: CycleLesson) {
  if (left.classes.some((className) => right.classes.includes(className))) return true
  return left.className !== "" && left.className === right.className
}

export function searchDutySwaps(source: CycleLesson, targetDate: string, candidates: CycleLesson[], byDate: Map<string, Occupant[]>): SwapSearch {
  if (!source.duty) return searchLessonCycles(source, candidates, byDate)
  if (source.date === targetDate) {
    return { cycles: [], blocked: [], prompt: "", dutyNote: sameDayDutyMessage() }
  }

  const cycles: SwapCycle[] = []
  const blocked: BlockedSwap[] = []
  for (const partner of candidates) {
    if (partner.id === source.id || !partner.duty) continue
    if (partner.date !== targetDate) continue
    if (partner.period !== source.period) continue
    if (isActivityRemark(partner.period, partner.location || partner.className, partner.course)) continue
    if (partner.teachers.some((teacher) => source.teachers.includes(teacher))) continue
    const attempt = tryChain([source, partner], byDate)
    if (!attempt.ok) {
      if (blocked.length < 40) {
        blocked.push({
          summary: `${names(source.teachers)} ${dutyName(source)} ⇄ ${names(partner.teachers)} ${dutyName(partner)}`,
          reason: attempt.reason,
        })
      }
      continue
    }
    const cycle = toCycle([{ ...source }, { ...partner }], byDate)
    if (cycle) {
      const summary = `${source.date.slice(5)} ${names(source.teachers)} ${dutyName(source)} → ${partner.date.slice(5)} ${names(partner.teachers)} ${dutyName(partner)} → 回到${names(source.teachers)}的${dutyName(source)}`
      cycles.push({ ...cycle, summary, tier: "跨日對調", sameDay: false })
    }
  }

  const role = source.period === "7:30" || source.period === "7:45" ? morningRoleLine(source.period, source.teachers) : ""
  return {
    cycles,
    blocked,
    prompt: cycles.length === 0 ? "這一天沒有可對調的同節當值。" : "",
    dutyNote: role,
  }
}

function dutyName(lesson: CycleLesson) {
  return lesson.location || lesson.className || periodLabel(lesson.period)
}

function morningRoleLine(period: MorningPeriod, teachers: string[]) {
  const blockedTeacher = teachers.find((teacher) => !canCoverMorning(period, teacher))
  if (!blockedTeacher) return ""
  return morningBlockReason(period, blockedTeacher) || ""
}

export function cyclesThrough(search: SwapSearch, partnerId: string) {
  return search.cycles.filter((cycle) => cycle.id.includes(partnerId))
}
