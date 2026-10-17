import { calendarOn, examForClass } from "@/lib/calendar"
import { buildTeachUnits } from "@/lib/coteach"
import { externalExchange, externalProgramme, externalSwapPlan } from "@/lib/external"
import { observationReason } from "@/lib/movement"
import { lockMessage } from "@/lib/schedule"
import { coverCandidates } from "@/lib/suggest"
import { searchDutySwaps, searchLessonCycles, searchMoveOnto, type CycleLesson, type Occupant, type SwapCycle } from "@/lib/cycles"
import { schoolWeek } from "@/lib/dates"
import { canonicalDutyPost, isActivityRemark, listedDuty, listedDutyPeriod, sameDutyPost } from "@/lib/duty-posts"
import { PERIOD_ORDER, periodLabel, periodMeta } from "@/lib/periods"
import { placementsFor, type Placement } from "@/lib/resolve"
import type { SchoolData, Swap } from "@/lib/types"

export type CoverChoice = {
  teacher: string
  reason: string
}

export type ArrangementItem = {
  id: string
  unitId: string
  role: "keep" | "meeting" | "block"
  date: string
  period: string
  className: string
  course: string
  teachers: string[]
  toDate: string
  toPeriod: string
  /** keep 預設調課。meeting 同擋住的其他班預設代課，調動最少。 */
  initial: "swap" | "cover"
  swap: SwapCycle | null
  /** 可選的對調方案（含預設 swap）；UI 選調課時列出 */
  swaps: SwapCycle[]
  blockedBy: string[]
  covers: CoverChoice[]
  note: string
}

export type AdoptedCover = {
  date: string
  period: string
  className: string
  course: string
  teacher: string
  teachers: string[]
  coverTeacher: string
  reason: string
}

export type AdoptBundle = {
  cycles: SwapCycle[]
  covers: AdoptedCover[]
  reason: string
}

export type TaskResult = {
  lines: string[]
  problems: string[]
  cycles: SwapCycle[]
  items: ArrangementItem[]
}

function emptyResult(problems: string[]): TaskResult {
  return { lines: [], problems, cycles: [], items: [] }
}

function lessonFrom(placement: Placement, date: string): CycleLesson {
  return {
    id: placement.unitId,
    day: placement.day,
    date,
    period: placement.period,
    className: placement.className,
    classes: placement.classes.length ? placement.classes : placement.className ? [placement.className] : [],
    course: placement.course,
    subject: placement.subject,
    teachers: placement.teachers,
    duty: placement.duty,
    location: placement.location,
    coTeach: placement.coTeach,
  }
}

function loadWeek(data: SchoolData, dates: string[], swaps: Swap[]) {
  const units = buildTeachUnits(data.lessons)
  const byDate = new Map<string, Placement[]>()
  for (const date of dates) byDate.set(date, placementsFor(units, date, swaps))
  return byDate
}

function sharesClass(left: { className: string; classes: string[] }, right: { className: string; classes: string[] }) {
  if (left.classes.some((className) => right.classes.includes(className))) return true
  return left.className !== "" && left.className === right.className
}

function names(teachers: string[]) {
  return teachers.filter(Boolean).join("、") || "未編"
}

function cycleLine(cycle: SwapCycle) {
  const when = [...new Set(cycle.legs.map((leg) => leg.date.slice(5)))].join("、")
  const classes = [...new Set(cycle.legs.map((leg) => leg.className))].join("、")
  return `${when} ${classes}：${cycle.summary}`
}

function closedReason(data: SchoolData, date: string, className: string, period = "") {
  const day = calendarOn(data.calendar, date)
  if (!day) return ""
  if (day.holiday) return `${date}是假期，沒有課堂可調。`
  const grade = Number(className[0])
  if (!period) {
    const full = day.exams.find((exam) => exam.label !== "考試" && !exam.periods?.length && exam.label !== "中作考試" && (exam.grades.length === 0 || exam.grades.includes(grade)))
    if (full) return `${date} ${className}是${full.label}，這天沒有平常課堂可調。`
    return ""
  }
  const exam = examForClass(day, className, period)
  if (exam) return `${date} ${className} ${periodLabel(period)}是${exam}，這一節沒有平常課堂可調。`
  return ""
}

function sortPeriods(periods: string[]) {
  return [...periods].sort((left, right) => (PERIOD_ORDER.get(left as never) ?? 99) - (PERIOD_ORDER.get(right as never) ?? 99))
}

function cloneBoard(board: Map<string, Occupant[]>) {
  return new Map([...board].map(([date, rows]) => [date, rows.map((row) => ({ ...row, teachers: [...row.teachers], classes: [...row.classes] }))]))
}

function stillThere(board: Map<string, Occupant[]>, lesson: CycleLesson) {
  return (board.get(lesson.date) || []).some((row) => row.unitId === lesson.id && row.period === lesson.period)
}

function sameTeachers(left: string[], right: string[]) {
  return [...left].filter(Boolean).sort().join("、") === [...right].filter(Boolean).sort().join("、")
}

function classHit(lesson: { className: string; classes: string[] }, className: string) {
  return lesson.className === className || lesson.classes.includes(className) || lesson.classes[0] === className
}

function occupantsOf(byDate: Map<string, Placement[]>) {
  const occupants = new Map<string, Occupant[]>()
  for (const [date, rows] of byDate) {
    occupants.set(date, rows.map((row) => ({
      unitId: row.unitId,
      period: row.period,
      className: row.className,
      classes: row.classes,
      course: row.course,
      subject: row.subject,
      teachers: row.teachers,
      duty: row.duty,
    })))
  }
  return occupants
}

function hopBlockers(board: Map<string, Occupant[]>, moving: CycleLesson, dest: CycleLesson) {
  return (board.get(dest.date) || []).filter((row) =>
    row.period === dest.period &&
    row.unitId !== dest.id &&
    row.teachers.some((teacher) => moving.teachers.includes(teacher))
  )
}

function uniqueRows(rows: Occupant[]) {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.unitId)) return false
    seen.add(row.unitId)
    return true
  })
}

function teacherOn(board: Map<string, Occupant[]>, teachers: string[], date: string, period: string) {
  return (board.get(date) || []).some((row) => row.period === period && row.teachers.some((teacher) => teachers.includes(teacher)))
}

type MeetingGuard = { teachers: Set<string>; slots: Set<string> } | null

function meetingSafe(cycle: SwapCycle, meeting: MeetingGuard) {
  if (!meeting) return true
  return cycle.legs.every((leg) => {
    const place = `${leg.toDate}|${leg.toPeriod}`
    if (!meeting.slots.has(place)) return true
    return !leg.teachers.some((teacher) => meeting.teachers.has(teacher))
  })
}

function unitsIn(cycle: SwapCycle, catalog: CycleLesson[], board: Map<string, Occupant[]>) {
  const ids: string[] = []
  for (const leg of cycle.legs) {
    const match = catalog.find((lesson) =>
      stillThere(board, lesson) &&
      lesson.date === leg.date &&
      lesson.period === leg.period &&
      sameTeachers(lesson.teachers, leg.teachers) &&
      classHit(lesson, leg.className) &&
      !ids.includes(lesson.id)
    )
    if (!match) return null
    ids.push(match.id)
  }
  return ids
}

function applyCycle(board: Map<string, Occupant[]>, cycle: SwapCycle, catalog: CycleLesson[]) {
  const ids = unitsIn(cycle, catalog, board)
  if (!ids) return false
  const moves = ids.map((id, index) => {
    for (const [date, rows] of board) {
      const row = rows.find((item) => item.unitId === id)
      if (row) return { date, row, toDate: cycle.legs[index].toDate, toPeriod: cycle.legs[index].toPeriod }
    }
    return null
  })
  if (moves.some((move) => !move)) return false
  for (const move of moves) {
    if (!move) continue
    const rows = board.get(move.date) || []
    board.set(move.date, rows.filter((row) => row.unitId !== move.row.unitId))
  }
  for (const move of moves) {
    if (!move) continue
    const rows = board.get(move.toDate) || []
    rows.push({ ...move.row, period: move.toPeriod, teachers: [...move.row.teachers], classes: [...move.row.classes] })
    board.set(move.toDate, rows)
  }
  return true
}

function poolFor(catalog: CycleLesson[], board: Map<string, Occupant[]>, lesson: CycleLesson, blocked: Set<string>) {
  return catalog.filter((item) => stillThere(board, item) && sharesClass(item, lesson) && !blocked.has(item.id) && !item.duty)
}

function findLesson(catalog: CycleLesson[], board: Map<string, Occupant[]>, row: Occupant) {
  return catalog.find((lesson) => lesson.id === row.unitId && stillThere(board, lesson)) || null
}

function externalAllowed(data: SchoolData, cycle: SwapCycle) {
  return cycle.legs.every((leg) => !lockMessage(data, leg.date, leg.className, leg.period))
}

function usableCycle(data: SchoolData, cycle: SwapCycle, catalog: CycleLesson[], board: Map<string, Occupant[]>, blocked: Set<string>, meeting: MeetingGuard, freeSlot?: { teachers: string[]; date: string; period: string }) {
  if (!externalAllowed(data, cycle) || !meetingSafe(cycle, meeting)) return false
  const ids = unitsIn(cycle, catalog, board)
  if (!ids || ids.some((id) => blocked.has(id))) return false
  if (!freeSlot) return true
  const trial = cloneBoard(board)
  if (!applyCycle(trial, cycle, catalog)) return false
  return !teacherOn(trial, freeSlot.teachers, freeSlot.date, freeSlot.period)
}

function relocate(
  data: SchoolData,
  lesson: CycleLesson,
  catalog: CycleLesson[],
  board: Map<string, Occupant[]>,
  blocked: Set<string>,
  meeting: MeetingGuard,
  depth: number,
): SwapCycle[] | null {
  if (blocked.has(lesson.id) || lesson.duty) return null
  const freeSlot = { teachers: lesson.teachers, date: lesson.date, period: lesson.period }
  const pool = poolFor(catalog, board, lesson, blocked)
  const search = searchLessonCycles(lesson, pool, board)
  const direct = search.cycles.find((cycle) => usableCycle(data, cycle, catalog, board, blocked, meeting, freeSlot))
  if (direct) return [direct]
  if (depth <= 0) return null

  const partners = pool.filter((item) => item.id !== lesson.id).slice(0, 8)
  for (const partner of partners) {
    const trial = cloneBoard(board)
    const nested: SwapCycle[] = []
    let stuck = false
    for (let round = 0; round < 3; round += 1) {
      const blocks = uniqueRows([...hopBlockers(trial, lesson, partner), ...hopBlockers(trial, partner, lesson)])
      if (!blocks.length) break
      const block = blocks[0]
      if (block.duty) {
        stuck = true
        break
      }
      const blockLesson = findLesson(catalog, trial, block)
      if (!blockLesson) {
        stuck = true
        break
      }
      const guard = new Set(blocked)
      guard.add(lesson.id)
      guard.add(partner.id)
      const cleared = relocate(data, blockLesson, catalog, trial, guard, meeting, 0)
      if (!cleared) {
        stuck = true
        break
      }
      for (const cycle of cleared) {
        if (!applyCycle(trial, cycle, catalog)) {
          stuck = true
          break
        }
        nested.push(cycle)
      }
      if (stuck) break
    }
    if (stuck || teacherOn(trial, lesson.teachers, partner.date, partner.period) || teacherOn(trial, partner.teachers, lesson.date, lesson.period)) continue
    const again = searchLessonCycles(lesson, poolFor(catalog, trial, lesson, blocked), trial)
    const cycle = again.cycles.find((item) => usableCycle(data, item, catalog, trial, blocked, meeting, freeSlot))
    if (cycle) return [...nested, cycle]
  }
  return null
}

function landOn(
  data: SchoolData,
  source: CycleLesson,
  target: CycleLesson,
  catalog: CycleLesson[],
  board: Map<string, Occupant[]>,
  blocked: Set<string>,
  meeting: MeetingGuard,
) {
  const pool = [...poolFor(catalog, board, source, blocked), source, target]
  const search = searchMoveOnto(source, target, pool, board)
  const picked = search.cycles.find((cycle) => usableCycle(data, cycle, catalog, board, blocked, meeting))
  return { picked, prompt: search.prompt }
}

function moveOnto(
  data: SchoolData,
  source: CycleLesson,
  target: CycleLesson,
  catalog: CycleLesson[],
  board: Map<string, Occupant[]>,
  blocked: Set<string>,
  meeting: MeetingGuard,
): { cycles: SwapCycle[]; problem: string } | { cycles: SwapCycle[]; problem: "" } {
  const first = landOn(data, source, target, catalog, board, blocked, meeting)
  if (first.picked) return { cycles: [first.picked], problem: "" }

  const trial = cloneBoard(board)
  const nested: SwapCycle[] = []
  let dutyNote = ""
  for (let round = 0; round < 4; round += 1) {
    const blocks = uniqueRows([...hopBlockers(trial, source, target), ...hopBlockers(trial, target, source)])
    if (!blocks.length) break
    const block = blocks[0]
    if (block.duty) {
      dutyNote = `${names(block.teachers)}在${periodLabel(block.period)}已有當值，這次調課不會挪動當值。`
      break
    }
    const blockLesson = findLesson(catalog, trial, block)
    if (!blockLesson) {
      dutyNote = `${names(block.teachers)}在${block.className || "其他崗位"}的${periodLabel(block.period)}擋住了，調不開。`
      break
    }
    const guard = new Set(blocked)
    guard.add(source.id)
    guard.add(target.id)
    const cleared = relocate(data, blockLesson, catalog, trial, guard, meeting, 1)
    if (!cleared) {
      dutyNote = `${names(block.teachers)}在${block.className}的${periodLabel(block.period)}擋住了，這一班沒有可調開的節次。`
      break
    }
    for (const cycle of cleared) {
      if (!applyCycle(trial, cycle, catalog)) {
        dutyNote = `${block.className}的調法無法套用。`
        break
      }
      nested.push(cycle)
    }
    if (dutyNote) break
  }

  const blocksLeft = uniqueRows([...hopBlockers(trial, source, target), ...hopBlockers(trial, target, source)])
  if (blocksLeft.length || dutyNote) {
    return { cycles: [], problem: dutyNote || first.prompt || `${names(source.teachers)}的${periodLabel(source.period)}不能調到${periodLabel(target.period)}。` }
  }

  const second = landOn(data, source, target, catalog, trial, blocked, meeting)
  if (!second.picked) {
    return { cycles: [], problem: second.prompt || `${names(source.teachers)}的${periodLabel(source.period)}不能調到${periodLabel(target.period)}。` }
  }
  return { cycles: [...nested, second.picked], problem: "" }
}

function coverList(data: SchoolData, date: string, period: string, className: string, exclude: string[], swaps: Swap[]): CoverChoice[] {
  return coverCandidates({ data, date, period, className, exclude, swaps }).eligible.slice(0, 8).map((row) => ({
    teacher: row.teacher,
    reason: row.reason,
  }))
}

function releaseTeachers(board: Map<string, Occupant[]>, unitIds: Set<string>) {
  const next = cloneBoard(board)
  for (const [date, rows] of next) {
    next.set(date, rows.map((row) => (unitIds.has(row.unitId) ? { ...row, teachers: [] } : row)))
  }
  return next
}

function replaceBoard(board: Map<string, Occupant[]>, next: Map<string, Occupant[]>) {
  board.clear()
  for (const [date, rows] of next) board.set(date, rows)
}

function toExternalCycle(date: string, source: CycleLesson, partner: { className: string; period: string; programme: string; course: string; teachers: string[]; summary: string }, partnerDate: string): SwapCycle {
  const plan = externalSwapPlan(date, {
    className: source.className,
    period: source.period,
    programme: partner.programme,
    course: source.course,
    teachers: source.teachers,
  }, partner, partnerDate)
  return {
    id: `external|${source.className}|${source.period}|${partner.className}|${partner.period}|${partnerDate}`,
    tier: date === partnerDate ? "同日對調" : "跨日對調",
    sameDay: date === partnerDate,
    legs: plan.legs || [],
    summary: partner.summary,
    warnings: [],
  }
}

function externalMove(data: SchoolData, source: CycleLesson, target: CycleLesson, swaps: Swap[]) {
  const sourceProgramme = externalProgramme(data, source.date, source.className, source.period)
  const targetProgramme = externalProgramme(data, target.date, target.className, target.period)
  if (!sourceProgramme && !targetProgramme) return { cycle: null as SwapCycle | null, note: "", problem: "" }
  if (!sourceProgramme && targetProgramme) {
    const locked = lockMessage(data, target.date, target.className, target.period)
    return { cycle: null as SwapCycle | null, note: "", problem: `${locked}普通課堂不能調進校外導師課堂。` }
  }
  const partnerDate = targetProgramme ? target.date : source.date
  const exchange = externalExchange(data, source.date, source.className, source.period, swaps, partnerDate === source.date ? "" : partnerDate)
  const match = targetProgramme ? exchange.partners.find((item) => item.className === target.className && item.period === target.period) || null : null
  if (targetProgramme && !match) {
    const why = exchange.blocked.find((item) => item.summary.includes(target.className))
    return { cycle: null as SwapCycle | null, note: "", problem: why ? `${why.summary}：${why.reason}` : `${source.className}不能跟${target.className}這節校外導師對調。` }
  }
  const partner = match || exchange.partners[0]
  if (!partner) {
    const detail = exchange.blocked.slice(0, 4).map((item) => `${item.summary}：${item.reason}`).join(" ")
    return { cycle: null as SwapCycle | null, note: "", problem: detail || exchange.message || `${source.className} ${periodLabel(source.period)}是校外導師，這一天沒有另一班可以對調。` }
  }
  const classes = [...new Set(exchange.partners.map((item) => item.className))].join("、")
  const when = partnerDate === source.date ? "當日" : partnerDate
  const note = match
    ? `這兩節都是校外導師，從${when}這幾班對調：${classes}。`
    : `校外導師只跟${when}這幾班對調：${classes}。`
  return { cycle: toExternalCycle(source.date, source, partner, partnerDate), note, problem: "" }
}

function adoptExternal(board: Map<string, Occupant[]>, catalog: CycleLesson[], used: Set<string>, cycle: SwapCycle) {
  const ids = unitsIn(cycle, catalog, board)
  if (ids && applyCycle(board, cycle, catalog)) ids.forEach((id) => used.add(id))
}

function leastSwap(data: SchoolData, source: CycleLesson, target: CycleLesson, catalog: CycleLesson[], board: Map<string, Occupant[]>, blocked: Set<string>, meeting: MeetingGuard) {
  const found = landOn(data, source, target, catalog, board, blocked, meeting)
  return {
    direct: found.picked && found.picked.legs.length === 2 ? found.picked : null,
    any: found.picked,
    prompt: found.prompt,
  }
}

function lessonBlockers(board: Map<string, Occupant[]>, source: CycleLesson, target: CycleLesson, reserved: Set<string>) {
  return uniqueRows([...hopBlockers(board, source, target), ...hopBlockers(board, target, source)]).filter((row) => !row.duty && !reserved.has(row.unitId))
}

function catalogFrom(byDate: Map<string, Placement[]>) {
  const catalog: CycleLesson[] = []
  for (const [date, rows] of byDate) {
    for (const row of rows) {
      if (row.duty) continue
      catalog.push(lessonFrom(row, date))
    }
  }
  return catalog
}

function dutyPostName(row: { location: string; course: string; className: string }) {
  const located = canonicalDutyPost(row.location)
  if (located) return located
  const wrapped = row.course.match(/[（(]([^）)]+)[）)]/)
  if (wrapped) return canonicalDutyPost(wrapped[1])
  return canonicalDutyPost(row.className)
}

function classDutyPost(period: string, className: string) {
  if (period === "班主任節") return className
  if (period !== "放學") return ""
  if (/^1[A-D]$/.test(className)) return className
  if (className === "2A" || className === "2B") return "2AB"
  if (className === "2C" || className === "2D") return "2CD"
  if (className.startsWith("3")) return "P3"
  if (className.startsWith("4")) return "P4"
  if (className.startsWith("5") || className.startsWith("6")) return "P56"
  return ""
}

function teacherDutyPeriod(period: string) {
  return period === "7:30" || period === "7:45" || period === "小息1" || period === "小息2" || period === "午膳" || period === "午息"
}

function dutyLesson(row: Placement, date: string): CycleLesson {
  const post = dutyPostName(row)
  const lesson = lessonFrom(row, date)
  return {
    ...lesson,
    className: post || lesson.className,
    classes: post ? [post] : lesson.classes,
    location: post || lesson.location,
    duty: true,
  }
}

function dutyCatalogFrom(byDate: Map<string, Placement[]>) {
  const catalog: CycleLesson[] = []
  for (const [date, rows] of byDate) {
    for (const row of rows) {
      if (!row.duty || row.teachers.length === 0) continue
      catalog.push(dutyLesson(row, date))
    }
  }
  return catalog
}

function findDutyLesson(catalog: CycleLesson[], date: string, period: string, className: string, teacher: string) {
  const rows = catalog.filter((lesson) => lesson.date === date && lesson.period === period)
  if (period === "放學" || period === "班主任節") {
    const post = classDutyPost(period, className)
    if (!post) return null
    if (period === "放學" && !listedDuty(period, post)) return null
    const matches = rows.filter((lesson) => sameDutyPost(dutyPostName(lesson), post))
    return matches.find((lesson) => teacher && lesson.teachers.includes(teacher)) || matches[0] || null
  }
  if (!teacherDutyPeriod(period) || !teacher) return null
  const owned = rows.filter((lesson) => lesson.teachers.includes(teacher))
  if (listedDutyPeriod(period)) return owned.find((lesson) => listedDuty(period, dutyPostName(lesson))) || null
  return owned[0] || null
}

function samePostPartners(catalog: CycleLesson[], source: CycleLesson, date: string) {
  const post = dutyPostName(source)
  if (!post) return []
  return catalog.filter((lesson) =>
    lesson.date === date &&
    lesson.period === source.period &&
    lesson.id !== source.id &&
    sameDutyPost(dutyPostName(lesson), post) &&
    !lesson.teachers.some((name) => source.teachers.includes(name))
  )
}


function packSwaps(swap: SwapCycle | null, extras: SwapCycle[] = []): { swap: SwapCycle | null; swaps: SwapCycle[] } {
  const list: SwapCycle[] = []
  const seen = new Set<string>()
  for (const cycle of [swap, ...extras]) {
    if (!cycle || seen.has(cycle.id)) continue
    seen.add(cycle.id)
    list.push(cycle)
  }
  return { swap: list[0] || null, swaps: list }
}

function dutyItem(source: CycleLesson, targetDate: string, swap: SwapCycle | null, covers: CoverChoice[]): ArrangementItem {
  return {
    id: `keep|${source.id}|${source.date}|duty`,
    unitId: source.id,
    role: "keep",
    date: source.date,
    period: source.period,
    className: source.className,
    course: source.course,
    teachers: source.teachers,
    toDate: targetDate,
    toPeriod: source.period,
    initial: swap ? "swap" : "cover",
    ...packSwaps(swap),
    blockedBy: [],
    covers,
    note: "",
  }
}

function arrangeDuty(args: {
  data: SchoolData
  period: string
  className: string
  teacher: string
  sourceDate: string
  targetDate: string
  swaps: Swap[]
  board: Map<string, Occupant[]>
  duties: CycleLesson[]
}): { item: ArrangementItem | null; cycle: SwapCycle | null; problem: string } {
  const source = findDutyLesson(args.duties, args.sourceDate, args.period, args.className, args.teacher)
  if (!source || !stillThere(args.board, source)) return { item: null, cycle: null, problem: `${periodLabel(args.period)}沒有當值。` }
  const covers = coverList(args.data, source.date, source.period, source.className, source.teachers, args.swaps)
  let cycle: SwapCycle | null = null
  if (args.sourceDate !== args.targetDate) {
    const partners = samePostPartners(args.duties, source, args.targetDate).filter((lesson) => stillThere(args.board, lesson))
    const found = searchDutySwaps(source, args.targetDate, partners, args.board)
    cycle = found.cycles.find((item) => {
      const trial = cloneBoard(args.board)
      const ids = unitsIn(item, args.duties, trial)
      return Boolean(ids && applyCycle(trial, item, args.duties))
    }) || null
    if (cycle) applyCycle(args.board, cycle, args.duties)
  }
  if (!cycle && covers.length === 0) return { item: null, cycle: null, problem: `${periodLabel(args.period)}調不開。` }
  return { item: dutyItem(source, args.targetDate, cycle, covers), cycle, problem: "" }
}

export function planBlockMove(args: {
  data: SchoolData
  className: string
  sourceDate: string
  sourcePeriods: string[]
  targetDate: string
  targetPeriods: string[]
  swaps?: Swap[]
  teacher?: string
}): TaskResult {
  const sourcePeriods = sortPeriods(args.sourcePeriods.filter(Boolean))
  const targetPeriods = sortPeriods(args.targetPeriods.filter(Boolean))
  if (!args.className) return emptyResult(["先選擇班別。"])
  if (!args.sourceDate || !args.targetDate) return emptyResult(["先選擇原來日期和調往日期。"])
  if (sourcePeriods.length === 0 || targetPeriods.length === 0) return emptyResult(["先選擇要調的節次。"])
  if (sourcePeriods.length !== targetPeriods.length) return emptyResult(["原來的節數和調往的節數要一樣。"])

  const dutyOnly = sourcePeriods.every((period) => periodMeta(period).kind === "duty") && targetPeriods.every((period) => periodMeta(period).kind === "duty")
  const holiday = [args.sourceDate, args.targetDate].map((date) => {
    const day = calendarOn(args.data.calendar, date)
    return day?.holiday ? `${date}是假期，沒有課堂可調。` : ""
  }).find(Boolean)
  if (holiday) return emptyResult([holiday])
  if (!dutyOnly) {
    const closed = closedReason(args.data, args.sourceDate, args.className) || closedReason(args.data, args.targetDate, args.className)
    if (closed) return emptyResult([closed])
  }

  const swaps = [...args.data.swaps, ...(args.swaps || [])]
  const dates = [...new Set([...schoolWeek(args.sourceDate), ...schoolWeek(args.targetDate), args.sourceDate, args.targetDate])]
  const byDate = loadWeek(args.data, dates, swaps)
  const board = occupantsOf(byDate)
  const catalog = catalogFrom(byDate)
  const duties = dutyCatalogFrom(byDate)
  const classPool = catalog.filter((lesson) => sharesClass(lesson, { className: args.className, classes: [args.className] }))

  const cycles: SwapCycle[] = []
  const items: ArrangementItem[] = []
  const lines: string[] = [`${args.className}：${sourcePeriods.map((period, index) => `${periodLabel(period)} → ${periodLabel(targetPeriods[index])}`).join("、")}`]
  const problems: string[] = []
  const used = new Set<string>()
  const reserved = new Set(classPool.filter((lesson) => (
    (lesson.date === args.sourceDate && sourcePeriods.includes(lesson.period)) ||
    (lesson.date === args.targetDate && targetPeriods.includes(lesson.period))
  )).map((lesson) => lesson.id))

  sourcePeriods.forEach((sourcePeriod, index) => {
    const targetPeriod = targetPeriods[index]
    const sourceDuty = periodMeta(sourcePeriod).kind === "duty"
    const targetDuty = periodMeta(targetPeriod).kind === "duty"
    if (sourceDuty || targetDuty) {
      if (!sourceDuty || !targetDuty || sourcePeriod !== targetPeriod) {
        if (!problems.includes("當值要調去同一種當值。")) problems.push("當值要調去同一種當值。")
        return
      }
      const duty = arrangeDuty({
        data: args.data,
        period: sourcePeriod,
        className: args.className,
        teacher: args.teacher || "",
        sourceDate: args.sourceDate,
        targetDate: args.targetDate,
        swaps,
        board,
        duties,
      })
      if (duty.problem) problems.push(duty.problem)
      if (duty.cycle) {
        cycles.push(duty.cycle)
        lines.push(cycleLine(duty.cycle))
      }
      if (duty.item) items.push(duty.item)
      return
    }
    const source = classPool.find((lesson) => lesson.date === args.sourceDate && lesson.period === sourcePeriod && stillThere(board, lesson))
    const target = classPool.find((lesson) => lesson.date === args.targetDate && lesson.period === targetPeriod && stillThere(board, lesson))
    if (!source) {
      problems.push(`${args.sourceDate} ${args.className} ${periodLabel(sourcePeriod)}沒有課堂。`)
      return
    }
    if (!target) {
      problems.push(`${args.targetDate} ${args.className} ${periodLabel(targetPeriod)}沒有課堂，不能把課調過去。`)
      return
    }
    if (source.id === target.id) {
      problems.push(`${periodLabel(sourcePeriod)}和${periodLabel(targetPeriod)}是同一節。`)
      return
    }
    const examPeriod = closedReason(args.data, args.sourceDate, args.className, sourcePeriod) || closedReason(args.data, args.targetDate, args.className, targetPeriod)
    if (examPeriod) {
      problems.push(examPeriod)
      return
    }
    const watched = observationReason(args.data, args.sourceDate, args.className, source.course, source.period) || observationReason(args.data, args.targetDate, args.className, target.course, target.period)
    if (watched) {
      problems.push(watched)
      return
    }
    const external = externalMove(args.data, source, target, swaps)
    if (external.problem || external.cycle) {
      if (external.problem) problems.push(external.problem)
      if (external.cycle) {
        adoptExternal(board, catalog, used, external.cycle)
        cycles.push(external.cycle)
        lines.push(cycleLine(external.cycle))
        items.push({
          id: `keep|${source.id}|${source.date}|external`,
          unitId: source.id,
          role: "keep",
          date: source.date,
          period: source.period,
          className: source.className,
          course: source.course,
          teachers: source.teachers,
          toDate: external.cycle.legs[0]?.toDate || source.date,
          toPeriod: external.cycle.legs[0]?.toPeriod || source.period,
          initial: "swap",
          ...packSwaps(external.cycle),
                    blockedBy: [],
          covers: coverList(args.data, source.date, source.period, source.className, source.teachers, swaps),
          note: external.note,
        })
      }
      return
    }

    const plain = leastSwap(args.data, source, target, catalog, board, used, null)
    if (plain.direct) {
      const ids = unitsIn(plain.direct, catalog, board)
      if (!ids || !applyCycle(board, plain.direct, catalog)) {
        problems.push(`${names(source.teachers)} ${source.course} 的調法無法套用到課表。`)
        return
      }
      ids.forEach((id) => used.add(id))
      cycles.push(plain.direct)
      lines.push(cycleLine(plain.direct))
      items.push(keepItem(source, target, plain.direct, [], "兩人對調，不必牽動其他班。", coverList(args.data, source.date, source.period, source.className, source.teachers, swaps)))
      return
    }

    const blockers = lessonBlockers(board, source, target, reserved).filter((row) => !used.has(row.unitId))
    if (blockers.length) {
      const blockedBy: string[] = []
      let solvable = true
      for (const block of blockers) {
        const lesson = findLesson(catalog, board, block)
        if (!lesson) {
          solvable = false
          continue
        }
        const id = `block|${lesson.id}|${lesson.date}`
        blockedBy.push(id)
        if (items.some((item) => item.id === id)) continue
        const covers = coverList(args.data, lesson.date, lesson.period, lesson.className, lesson.teachers, swaps)
        const away = searchLessonCycles(lesson, poolFor(catalog, board, lesson, used), board)
        const swap = away.cycles.find((cycle) => usableCycle(args.data, cycle, catalog, board, used, null, {
          teachers: lesson.teachers,
          date: lesson.date,
          period: lesson.period,
        })) || null
        const initial = covers.length > 0 ? "cover" : "swap"
        if (!covers.length && !swap) solvable = false
        items.push({
          id,
          unitId: lesson.id,
          role: "block",
          date: lesson.date,
          period: lesson.period,
          className: lesson.className,
          course: lesson.course,
          teachers: lesson.teachers,
          toDate: lesson.date,
          toPeriod: lesson.period,
          initial,
          ...packSwaps(swap),
          blockedBy: [],
          covers,
          note: covers.length
            ? `${names(lesson.teachers)}騰出後，${args.className}就可以對調。這班預設代課。`
            : `${lesson.className}沒有可代課的老師。`,
        })
        if (!covers.length && !swap) problems.push(`${names(lesson.teachers)} ${lesson.className} ${periodLabel(lesson.period)}沒有代課老師，亦調不開。`)
      }
      const released = releaseTeachers(board, new Set(blockers.map((row) => row.unitId)))
      const freed = leastSwap(args.data, source, target, catalog, released, used, null)
      const chosen = freed.direct
      if (chosen && solvable) {
        const next = releaseTeachers(board, new Set(blockers.map((row) => row.unitId)))
        const ids = unitsIn(chosen, catalog, next)
        if (ids && applyCycle(next, chosen, catalog)) {
          replaceBoard(board, next)
          ids.forEach((id) => used.add(id))
        }
        cycles.push(chosen)
        lines.push(`先代課${blockers.map((row) => row.className).join("、")}，再${cycleLine(chosen)}`)
      } else if (!chosen && plain.any) {
        const ids = unitsIn(plain.any, catalog, board)
        if (ids && applyCycle(board, plain.any, catalog)) {
          ids.forEach((id) => used.add(id))
          cycles.push(plain.any)
          lines.push(cycleLine(plain.any))
          items.push(keepItem(source, target, plain.any, [], "同一班多方調課，不必牽動其他班。", coverList(args.data, source.date, source.period, source.className, source.teachers, swaps)))
          return
        }
      } else if (!chosen) {
        problems.push(`${names(source.teachers)} ${source.course} 不能調到 ${args.targetDate} ${periodLabel(targetPeriod)}。${freed.prompt || plain.prompt}`)
      }
      items.push(keepItem(source, target, chosen, blockedBy, chosen ? `先處理${blockers.map((row) => row.className).join("、")}，這節就可以對調。` : `${names(source.teachers)}仍未能調到${periodLabel(targetPeriod)}。`, coverList(args.data, source.date, source.period, source.className, source.teachers, swaps)))
      return
    }

    if (plain.any) {
      const ids = unitsIn(plain.any, catalog, board)
      if (!ids || !applyCycle(board, plain.any, catalog)) {
        problems.push(`${names(source.teachers)} ${source.course} 的調法無法套用到課表。`)
        return
      }
      ids.forEach((id) => used.add(id))
      cycles.push(plain.any)
      lines.push(cycleLine(plain.any))
      items.push(keepItem(source, target, plain.any, [], "同一班多方調課。", coverList(args.data, source.date, source.period, source.className, source.teachers, swaps)))
      return
    }
    problems.push(`${names(source.teachers)} ${source.course} 不能調到 ${args.targetDate} ${periodLabel(targetPeriod)}。${plain.prompt}`)
  })

  return { lines, problems, cycles, items }
}

function keepItem(source: CycleLesson, target: CycleLesson, swap: SwapCycle | null, blockedBy: string[], note: string, covers: CoverChoice[]): ArrangementItem {
  return {
    id: `keep|${source.id}|${source.date}|${target.id}`,
    unitId: source.id,
    role: "keep",
    date: source.date,
    period: source.period,
    className: source.className,
    course: source.course,
    teachers: source.teachers,
    toDate: target.date,
    toPeriod: target.period,
    initial: "swap",
    ...packSwaps(swap),
    blockedBy,
    covers,
    note,
  }
}

function remarkHold(byDate: Map<string, Placement[]>, date: string, period: string, teacher: string) {
  return (byDate.get(date) || []).some((row) => row.period === period && row.teachers.includes(teacher) && isActivityRemark(row.period, row.location, row.course))
}

function dutyMeetingSwap(data: SchoolData, job: CycleLesson, duties: CycleLesson[], board: Map<string, Occupant[]>, used: Set<string>, meeting: MeetingGuard) {
  const dates = [...new Set(duties.map((lesson) => lesson.date))].filter((date) => date !== job.date).sort()
  for (const date of dates) {
    const partners = samePostPartners(duties, job, date).filter((lesson) => stillThere(board, lesson) && !lesson.teachers.some((teacher) => meeting?.teachers.has(teacher)))
    const found = searchDutySwaps(job, date, partners, board)
    const cycle = found.cycles.find((item) => meetingSafe(item, meeting) && usableCycle(data, item, duties, board, used, meeting)) || null
    if (cycle) return cycle
  }
  return null
}

export function planMeeting(args: {
  data: SchoolData
  date: string
  periods: string[]
  teachers: string[]
  swaps?: Swap[]
}): TaskResult {
  const periods = sortPeriods(args.periods.filter(Boolean))
  const teachers = [...new Set(args.teachers.filter(Boolean))]
  if (!args.date) return emptyResult(["先選擇會議日期。"])
  if (!periods.length) return emptyResult(["先選擇會議節次。"])
  if (!teachers.length) return emptyResult(["先選擇要開會的老師。"])

  const meetDay = calendarOn(args.data.calendar, args.date)
  if (meetDay?.holiday) return emptyResult([`${args.date}是假期，沒有課堂可調。`])
  const hasDuty = periods.some((period) => periodMeta(period).kind === "duty")
  const wholeExam = meetDay?.exams.find((exam) => exam.grades.length === 0 && exam.label !== "考試" && exam.label !== "中作考試" && !exam.periods?.length)
  if (wholeExam && !hasDuty) return emptyResult([`${args.date}是${wholeExam.label}，這天沒有平常課堂可調。`])

  const swaps = [...args.data.swaps, ...(args.swaps || [])]
  const dates = schoolWeek(args.date)
  const byDate = loadWeek(args.data, dates, swaps)
  const board = occupantsOf(byDate)
  const catalog = catalogFrom(byDate)
  const duties = dutyCatalogFrom(byDate)
  const meeting: MeetingGuard = { teachers: new Set(teachers), slots: new Set(periods.map((period) => `${args.date}|${period}`)) }
  const jobs: CycleLesson[] = []
  const seen = new Set<string>()

  for (const period of periods) {
    if (periodMeta(period).kind === "duty") {
      for (const lesson of duties) {
        if (lesson.date !== args.date || lesson.period !== period) continue
        if (!lesson.teachers.some((teacher) => meeting.teachers.has(teacher))) continue
        if (seen.has(lesson.id)) continue
        seen.add(lesson.id)
        jobs.push(lesson)
      }
      continue
    }
    for (const row of byDate.get(args.date) || []) {
      if (row.period !== period || row.duty) continue
      if (!row.teachers.some((teacher) => meeting.teachers.has(teacher))) continue
      if (seen.has(row.unitId)) continue
      seen.add(row.unitId)
      const lesson = catalog.find((item) => item.id === row.unitId && item.date === args.date)
      if (lesson) jobs.push(lesson)
    }
  }

  const free = teachers.filter((teacher) => !jobs.some((job) => job.teachers.includes(teacher)) && !periods.some((period) => remarkHold(byDate, args.date, period, teacher)))
  const lines = free.length ? [`${free.join("、")}在所選節次沒有課堂，可以直接開會。`] : []
  const problems: string[] = []
  for (const period of periods) {
    if (periodMeta(period).kind !== "duty") continue
    for (const teacher of teachers) {
      if (jobs.some((job) => job.period === period && job.teachers.includes(teacher))) continue
      if (remarkHold(byDate, args.date, period, teacher)) problems.push(`${teacher} ${periodLabel(period)}調不開。`)
    }
  }
  const cycles: SwapCycle[] = []
  const items: ArrangementItem[] = []
  const used = new Set<string>()

  for (const job of jobs) {
    if (!stillThere(board, job)) {
      lines.push(`${names(job.teachers)} ${job.className} ${periodLabel(job.period)}已一併調開。`)
      continue
    }
    if (job.duty) {
      const covers = coverList(args.data, job.date, job.period, job.className, job.teachers, swaps)
      const swap = dutyMeetingSwap(args.data, job, duties, board, used, meeting)
      if (!covers.length && !swap) problems.push(`${names(job.teachers)} ${job.className} ${periodLabel(job.period)}調不開。`)
      else {
        items.push({
          id: `meeting|${job.id}|${job.date}`,
          unitId: job.id,
          role: "meeting",
          date: job.date,
          period: job.period,
          className: job.className,
          course: job.course,
          teachers: job.teachers,
          toDate: swap?.legs[0]?.toDate || job.date,
          toPeriod: swap?.legs[0]?.toPeriod || job.period,
          initial: covers.length ? "cover" : "swap",
          ...packSwaps(swap),
          blockedBy: [],
          covers,
          note: "",
        })
      }
      continue
    }
    const exam = examForClass(meetDay, job.className, job.period)
    if (exam) {
      problems.push(`${args.date} ${job.className} ${periodLabel(job.period)}是${exam}，這一節沒有平常課堂可調。`)
      continue
    }
    const watched = observationReason(args.data, job.date, job.className, job.course, job.period)
    if (watched) {
      problems.push(watched)
      continue
    }
    const programme = externalProgramme(args.data, job.date, job.className, job.period)
    if (programme) {
      const exchange = externalExchange(args.data, job.date, job.className, job.period, swaps)
      const partner = exchange.partners.find((item) => !item.teachers.some((teacher) => meeting.teachers.has(teacher)))
      const covers = coverList(args.data, job.date, job.period, job.className, job.teachers, swaps)
      if (!partner) {
        if (covers.length) {
          lines.push(`${names(job.teachers)} ${job.className} ${periodLabel(job.period)}可以代課。`)
          items.push({
            id: `meeting|${job.id}|${job.date}`,
            unitId: job.id,
            role: "meeting",
            date: job.date,
            period: job.period,
            className: job.className,
            course: job.course,
            teachers: job.teachers,
            toDate: job.date,
            toPeriod: job.period,
            initial: "cover",
            ...packSwaps(null),
                        blockedBy: [],
            covers,
            note: `校外導師「${programme}」可以由校內老師代課。`,
          })
        } else {
          problems.push(exchange.message || `${job.className} ${periodLabel(job.period)}是校外導師，這一天沒有另一班可以對調，亦沒有可代課的老師。`)
        }
        continue
      }
      const cycle = toExternalCycle(job.date, job, partner, job.date)
      const arriving = cycle.legs.some((leg) => leg.toDate === job.date && leg.toPeriod === job.period && leg.teachers.some((teacher) => meeting.teachers.has(teacher)))
      if (arriving) {
        problems.push(`${job.className} ${periodLabel(job.period)}對調後仍有開會老師留在這一節。`)
        continue
      }
      adoptExternal(board, catalog, used, cycle)
      cycles.push(cycle)
      const classes = [...new Set(exchange.partners.map((item) => item.className))].join("、")
      lines.push(cycleLine(cycle))
      items.push({
        id: `meeting|${job.id}|${job.date}`,
        unitId: job.id,
        role: "meeting",
        date: job.date,
        period: job.period,
        className: job.className,
        course: job.course,
        teachers: job.teachers,
        toDate: cycle.legs[0]?.toDate || job.date,
        toPeriod: cycle.legs[0]?.toPeriod || job.period,
        initial: "swap",
        ...packSwaps(cycle),
        blockedBy: [],
        covers,
        note: `校外導師只跟當日這幾班對調：${classes}。`,
      })
      continue
    }
    const covers = coverList(args.data, job.date, job.period, job.className, job.teachers, swaps)
    const search = searchLessonCycles(job, poolFor(catalog, board, job, used), board)
    const safe = search.cycles.filter((cycle) => meetingSafe(cycle, meeting) && usableCycle(args.data, cycle, catalog, board, used, meeting))
    let swap: SwapCycle | null = safe.find((cycle) => cycle.legs.length === 2) || safe[0] || null
    const blockedBy: string[] = []
    if (!swap) {
      const partners = poolFor(catalog, board, job, used).filter((lesson) => lesson.id !== job.id).slice(0, 6)
      const rows = uniqueRows(partners.flatMap((partner) => [...hopBlockers(board, job, partner), ...hopBlockers(board, partner, job)])).filter((row) => !row.duty && row.unitId !== job.id)
      for (const block of rows.slice(0, 3)) {
        const lesson = findLesson(catalog, board, block)
        if (!lesson) continue
        const id = `block|${lesson.id}|${lesson.date}`
        blockedBy.push(id)
        if (items.some((item) => item.id === id)) continue
        const blockCovers = coverList(args.data, lesson.date, lesson.period, lesson.className, lesson.teachers, swaps)
        const away = searchLessonCycles(lesson, poolFor(catalog, board, lesson, used), board)
        const awaySafe = away.cycles.filter((cycle) => usableCycle(args.data, cycle, catalog, board, used, meeting, {
          teachers: lesson.teachers,
          date: lesson.date,
          period: lesson.period,
        }))
        const awaySwap = awaySafe[0] || null
        items.push({
          id,
          unitId: lesson.id,
          role: "block",
          date: lesson.date,
          period: lesson.period,
          className: lesson.className,
          course: lesson.course,
          teachers: lesson.teachers,
          toDate: lesson.date,
          toPeriod: lesson.period,
          initial: blockCovers.length ? "cover" : "swap",
          ...packSwaps(awaySwap, awaySafe.slice(0, 8)),
          blockedBy: [],
          covers: blockCovers,
          note: `${names(lesson.teachers)}擋住調課。預設代課，調動較少。`,
        })
      }
      if (blockedBy.length) {
        const released = releaseTeachers(board, new Set(rows.slice(0, 3).map((row) => row.unitId)))
        const again = searchLessonCycles(job, poolFor(catalog, released, job, used), released)
        const againSafe = again.cycles.filter((cycle) => meetingSafe(cycle, meeting) && usableCycle(args.data, cycle, catalog, released, used, meeting))
        swap = againSafe.find((cycle) => cycle.legs.length === 2) || againSafe[0] || null
        if (againSafe.length) safe.push(...againSafe)
      }
    }
    const packed = packSwaps(swap, safe.slice(0, 8))
    swap = packed.swap
    if (!covers.length && !swap) problems.push(`${names(job.teachers)} ${job.className} ${periodLabel(job.period)} ${job.course} 調不開，亦沒有可代課的老師。`)
    else lines.push(covers.length ? `${names(job.teachers)} ${job.className} ${periodLabel(job.period)}可以代課，不必調課。` : `${names(job.teachers)} ${job.className} ${periodLabel(job.period)}沒有代課老師，要調課。`)
    items.push({
      id: `meeting|${job.id}|${job.date}`,
      unitId: job.id,
      role: "meeting",
      date: job.date,
      period: job.period,
      className: job.className,
      course: job.course,
      teachers: job.teachers,
      toDate: swap?.legs[0]?.toDate || job.date,
      toPeriod: swap?.legs[0]?.toPeriod || job.period,
      initial: covers.length ? "cover" : "swap",
      ...packed,
      blockedBy: swap && packed.swaps.length ? [] : blockedBy,
      covers,
      note: covers.length ? "這節可以由別人代，老師去開會。若節奏要保留，改為調課。" : "沒有可代課的老師。",
    })
  }

  return { lines, problems, cycles, items }
}
