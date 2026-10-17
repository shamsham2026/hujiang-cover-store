import { arrangementPlans } from "@/lib/card"
import { classLabels, compareClass } from "@/lib/class-unit"
import { classesInCoursePrefix } from "@/lib/coteach"
import { dayChar } from "@/lib/dates"
import { dutyLocation, isDuty } from "@/lib/duty"
import { legsOf } from "@/lib/schedule"
import type { Plan, PlanLeg } from "@/lib/types"

const REMARK = "備註:除上表列寫節數有調動外，其餘的依照教師個人或個別班別原本時間表上課。"

const SLIP_ROWS = [
  { ids: ["7:30", "7:45", "早會前"], label: "早會前", time: "7:30 - 8:15" },
  { ids: ["班主任節"], label: "班主任節", time: "8:10 - 8:35" },
  { ids: ["1"], label: "1", time: "8:35 - 9:05" },
  { ids: ["2"], label: "2", time: "9:05 - 9:35" },
  { ids: ["小息1"], label: "第一小息", time: "9:35 - 9:50" },
  { ids: ["3"], label: "3", time: "9:50 - 10:20" },
  { ids: ["4"], label: "4", time: "10:20 - 10:50" },
  { ids: ["小息2"], label: "第二小息", time: "10:50 - 11:05" },
  { ids: ["5"], label: "5", time: "11:05 - 11:35" },
  { ids: ["6"], label: "6", time: "11:35 - 12:05" },
  { ids: ["午膳"], label: "午膳", time: "12:05 - 12:45" },
  { ids: ["午息"], label: "午息", time: "12:45 - 1:00" },
  { ids: ["7"], label: "7", time: "1:00 - 1:30" },
  { ids: ["8"], label: "8", time: "1:30 - 2:00" },
  { ids: ["9"], label: "9", time: "2:00 - 2:30" },
  { ids: ["10"], label: "10", time: "2:30 - 3:00" },
  { ids: ["放學"], label: "放學當值", time: "" },
] as const

export type FormRow = {
  period: string
  time: string
  cells: string[]
}

export type FormSheet = {
  kind: "代課安排" | "調課安排"
  title: string
  className?: string
  dateLine: string
  reason: string
  headers: string[]
  rows: FormRow[]
  footer: string
  note: string
  sides: number
  /** Confirm-page name shown in download PDF（視覺用，唔一定互動） */
  confirmWho?: string
  /** Confirm page URL for PDF「確定」link annotation（/c/… 或 signed ?t=） */
  confirmUrl?: string
}

export function slipDate(iso: string) {
  if (!iso) return ""
  const [year, month, day] = iso.split("-")
  if (!year || !month || !day) return iso
  return `${Number(day)}-${Number(month)}-${year}`
}

function names(leg: PlanLeg | undefined) {
  if (!leg) return ""
  return (leg.teachers?.length ? leg.teachers : [leg.teacher]).filter(Boolean).join("、")
}

function sideDates(plan: Plan) {
  const legs = legsOf(plan)
  const found = [...new Set(legs.flatMap((leg) => [leg.date, leg.toDate]).filter(Boolean))]
  const rest = found.filter((date) => date !== plan.date)
  return [plan.date, ...rest].filter(Boolean)
}

function joinParts(parts: string[]) {
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))].join("、")
}

function dutyWritten(post: string) {
  return post ? `${post}(當值調動)` : "(當值調動)"
}

function coverContent(item: Plan) {
  if (item.duty || isDuty(item.period, item.course)) return dutyWritten(dutyLocation(item.course) || item.className || item.course)
  return item.course
}

function slotParts(plan: Plan, legs: PlanLeg[], date: string, period: string) {
  const leaving = legs.find((leg) => leg.date === date && leg.period === period)
  const arriving = legs.find((leg) => leg.toDate === date && leg.toPeriod === period && !(leg.date === date && leg.period === period))
  if (!leaving && !arriving) return { content: "", teacher: "" }
  const sample = arriving || leaving
  const duty = Boolean(plan.duty) || isDuty(period, sample?.course || "") || isDuty(sample?.period || "", sample?.course || "")
  if (duty) {
    const post = sample?.className || dutyLocation(sample?.course || "") || sample?.course || ""
    return { content: dutyWritten(post), teacher: names(arriving) || names(leaving) }
  }
  if (leaving && arriving) {
    const content = leaving.course === arriving.course ? leaving.course : `${leaving.course} → ${arriving.course}`
    return { content, teacher: names(arriving) }
  }
  if (leaving) return { content: leaving.course, teacher: names(leaving) }
  return { content: arriving?.course || "", teacher: names(arriving) }
}

function blankRow(label: string, time: string, width: number): FormRow {
  return { period: label, time, cells: Array.from({ length: width }, () => "") }
}

export function formSheet(plan: Plan, related: Plan[] = []): FormSheet {
  const cover = plan.mode === "cover"
  const reasonText = plan.reason?.trim() || (cover ? "代課" : "調課")
  const reason = `${plan.teacher}    ${reasonText}`.trim()
  if (cover) {
    const group = arrangementPlans(plan, related)
    const dates = [...new Set(group.map((item) => item.date).filter(Boolean))]
    return {
      kind: "代課安排",
      title: "2026/27 滬江小學 代課表格",
      dateLine: dates.map((date) => `${slipDate(date)}    星期${dayChar(date)}`).join("、"),
      reason,
      headers: ["教節", "班級/內容", "相關老師", "簽署"],
      rows: SLIP_ROWS.map((row) => {
        const ids: readonly string[] = row.ids
        const hits = group.filter((item) => ids.includes(item.period))
        return {
          period: row.label,
          time: row.time,
          cells: [
            joinParts(hits.map(coverContent)),
            joinParts(hits.map((item) => (item.partnerTeacher ? `${item.partnerTeacher}代` : ""))),
            "",
          ],
        }
      }),
      footer: "",
      note: "",
      sides: 1,
    }
  }

  const dates = sideDates(plan)
  const legs = legsOf(plan)
  const headers = ["教節", ...dates.flatMap((date) => [slipDate(date), "相關老師", "簽知"])]
  return {
    kind: "調課安排",
    title: "2026/27 滬江小學 調課 / 代課 安排表格",
    dateLine: dates.map((date) => slipDate(date)).join("、"),
    reason,
    headers,
    rows: SLIP_ROWS.map((row) => {
      const cells = dates.flatMap((date) => {
        const ids: readonly string[] = row.ids
        const parts = ids.map((period) => slotParts(plan, legs, date, period)).filter((part) => part.content || part.teacher)
        if (!parts.length) return ["", "", ""]
        return [joinParts(parts.map((part) => part.content)), joinParts(parts.map((part) => part.teacher)), ""]
      })
      return { period: row.label, time: row.time, cells: cells.length ? cells : blankRow(row.label, row.time, headers.length - 1).cells }
    }),
    footer: "",
    note: REMARK,
    sides: dates.length,
  }
}

function expandClassToken(token: string) {
  const multi = token.match(/^([1-6])([A-D]{2})$/)
  if (!multi) return [token]
  return [...multi[2]].map((section) => `${multi[1]}${section}`)
}

function namedClasses(value: string | undefined) {
  return classLabels(value).flatMap(expandClassToken)
}

/** 這一腳屬於這個班。跨班小組課（6AB中作）兩邊都算；6A 自己的課不會寫進 6B。 */
function legOwns(leg: PlanLeg, className: string) {
  if (namedClasses(leg.className).includes(className)) return true
  const prefix = classesInCoursePrefix(leg.course)
  if (prefix.includes(className)) return true
  if (prefix.length) return false
  return (leg.classes || []).some((name) => namedClasses(name).includes(className))
}

function sheetClasses(plan: Plan) {
  const found = new Set<string>()
  const consider = (className: string, course: string, classes?: string[]) => {
    for (const name of namedClasses(className)) found.add(name)
    const prefix = classesInCoursePrefix(course)
    for (const name of prefix) found.add(name)
    if (!prefix.length) for (const name of classes || []) for (const label of namedClasses(name)) found.add(label)
  }
  consider(plan.className, plan.course)
  for (const leg of legsOf(plan)) consider(leg.className, leg.course, leg.classes)
  if (!found.size) found.add(plan.duty ? "當值" : "其他")
  return [...found]
}

function joinNames(legs: PlanLeg[]) {
  return joinParts(legs.flatMap((leg) => (leg.teachers?.length ? leg.teachers : [leg.teacher])))
}

function swappedWith(leaving: PlanLeg, arriving: PlanLeg) {
  return arriving.toDate === leaving.date && arriving.toPeriod === leaving.period && arriving.date === leaving.toDate && arriving.period === leaving.toPeriod
}

function classSlot(className: string, owned: PlanLeg[], pool: PlanLeg[], date: string, period: string) {
  const leaving = owned.filter((leg) => leg.date === date && leg.period === period)
  if (!leaving.length) return { content: "", teacher: "" }
  const hosts = leaving.filter((leg) => namedClasses(leg.className).includes(className))
  const arriving = pool.filter((leg) => hosts.some((ownedLeg) => swappedWith(ownedLeg, leg)))
  const duty = leaving.some((leg) => isDuty(leg.period, leg.course))
  if (duty) {
    const sample = leaving[0]
    const post = namedClasses(sample.className)[0] || dutyLocation(sample.course) || sample.course
    return { content: dutyWritten(post), teacher: joinNames(arriving.length ? arriving : leaving) }
  }
  const moved = arriving.length > 0 && leaving.some((leg) => leg.date !== leg.toDate || leg.period !== leg.toPeriod)
  const left = joinParts(leaving.map((leg) => leg.course))
  if (!moved) return { content: left, teacher: joinNames(leaving) }
  const right = joinParts(arriving.map((leg) => leg.course))
  return { content: right && right !== left ? `${left} → ${right}` : left, teacher: joinNames(arriving) }
}

function classDates(plans: Plan[], legs: PlanLeg[]) {
  const found = [...new Set(legs.map((leg) => leg.date).filter(Boolean))]
  const first = plans.map((plan) => plan.date).find((date) => found.includes(date))
  const rest = found.filter((date) => date !== first).sort()
  return [first, ...rest].filter(Boolean) as string[]
}

function sheetForClass(plans: Plan[], className: string): FormSheet | null {
  const owned = plans.flatMap((plan) => legsOf(plan).filter((leg) => legOwns(leg, className)))
  if (!owned.length) return null
  const pool = plans.flatMap((plan) => legsOf(plan))
  const bits = plans.map((plan) => {
    const who = plan.teacher || plan.partnerTeacher
    const why = plan.reason?.trim() || (plan.mode === "cover" ? "代課" : "調課")
    return [who, why].filter(Boolean).join(" ")
  })
  const reason = `${className}    ${joinParts(bits)}`.trim()
  if (plans.every((plan) => plan.mode === "cover")) {
    const dates = [...new Set(plans.map((plan) => plan.date).filter(Boolean))]
    return {
      kind: "代課安排",
      title: "2026/27 滬江小學 代課表格",
      className,
      dateLine: dates.map((date) => `${slipDate(date)}    星期${dayChar(date)}`).join("、"),
      reason,
      headers: ["教節", "班級/內容", "相關老師", "簽署"],
      rows: SLIP_ROWS.map((row) => {
        const ids: readonly string[] = row.ids
        const hits = owned.filter((leg) => ids.includes(leg.period))
        return {
          period: row.label,
          time: row.time,
          cells: [
            joinParts(hits.map((leg) => (isDuty(leg.period, leg.course) ? dutyWritten(namedClasses(leg.className)[0] || dutyLocation(leg.course) || leg.course) : leg.course))),
            joinParts(hits.flatMap((leg) => (leg.teachers?.length ? leg.teachers : [leg.teacher]).filter(Boolean).map((name) => `${name}代`))),
            "",
          ],
        }
      }),
      footer: "",
      note: "",
      sides: 1,
    }
  }
  const dates = classDates(plans, owned)
  const headers = ["教節", ...dates.flatMap((date) => [slipDate(date), "相關老師", "簽知"])]
  return {
    kind: "調課安排",
    title: "2026/27 滬江小學 調課 / 代課 安排表格",
    className,
    dateLine: dates.map((date) => slipDate(date)).join("、"),
    reason,
    headers,
    rows: SLIP_ROWS.map((row) => {
      const cells = dates.flatMap((date) => {
        const ids: readonly string[] = row.ids
        const parts = ids.map((period) => classSlot(className, owned, pool, date, period)).filter((part) => part.content || part.teacher)
        if (!parts.length) return ["", "", ""]
        return [joinParts(parts.map((part) => part.content)), joinParts(parts.map((part) => part.teacher)), ""]
      })
      return { period: row.label, time: row.time, cells }
    }),
    footer: "",
    note: REMARK,
    sides: Math.max(dates.length, 1),
  }
}

/** 調課紙以班為單位：一班一張。同一班同一節的老師和小組課合併成一列。 */
export function classFormSheets(plans: Plan[]): FormSheet[] {
  const classes = new Set<string>()
  for (const plan of plans) for (const name of sheetClasses(plan)) classes.add(name)
  return [...classes].sort(compareClass).flatMap((className) => {
    const touching = plans.filter((plan) => sheetClasses(plan).includes(className))
    const sheet = sheetForClass(touching, className)
    return sheet ? [sheet] : []
  })
}
