import type { Plan, RecordRow, Swap } from "@/lib/types"

const PERIOD_IDS = [
  "7:30", "7:45", "班主任節", "1", "2", "小息1", "3", "4", "小息2", "5", "6", "午膳", "午息", "7", "8", "9", "10", "放學",
] as const
const PERIOD_ORDER: Map<string, number> = new Map(PERIOD_IDS.map((id, index) => [id, index]))

/** 調動日期：畫面顯示嘅主日期（對調跨日仍以 plan.date 為準）。 */
export function movementDate(plan: Plan): string {
  return plan.date || plan.targetDate || ""
}

export function planDedupeKey(plan: Plan): string {
  const partner = plan.mode === "swap" ? ((plan as Plan & { partnerPeriod?: string }).partnerPeriod || "") : ""
  return `${plan.date}|${plan.className}|${plan.period}|${plan.mode}|${partner}`
}

function periodRank(period: string): number {
  const hit = PERIOD_ORDER.get(period)
  return hit === undefined ? 999 : hit
}

function preferPlan(a: Plan, b: Plan): Plan {
  const aConfirmed = Boolean((a as Plan & { tier?: string }).tier?.includes("確認") || (a.reason || "").includes("已確認") || a.id.includes("confirmed"))
  const bConfirmed = Boolean((b as Plan & { tier?: string }).tier?.includes("確認") || (b.reason || "").includes("已確認") || b.id.includes("confirmed"))
  if (aConfirmed !== bConfirmed) return aConfirmed ? a : b
  const aReason = (a.reason || "").length
  const bReason = (b.reason || "").length
  if (aReason !== bReason) return aReason >= bReason ? a : b
  return a.id.length >= b.id.length ? a : b
}

/** 顯示用去重：同一日／班／節／模式（對調含對手節）只留一筆；唔改永久庫。 */
export function dedupePlans(plans: Plan[]): Plan[] {
  const best = new Map<string, Plan>()
  const hidden: Plan[] = []
  for (const plan of plans) {
    const key = planDedupeKey(plan)
    const prev = best.get(key)
    if (!prev) {
      best.set(key, plan)
      continue
    }
    const keep = preferPlan(prev, plan)
    const drop = keep.id === prev.id ? plan : prev
    best.set(key, keep)
    hidden.push(drop)
  }
  return Array.from(best.values())
}

/** 紀錄／本次安排：調動日期新→舊，其後節次、班別。 */
export function sortPlansByMovementDate(plans: Plan[]): Plan[] {
  return [...plans].sort((left, right) => {
    const dateCmp = movementDate(right).localeCompare(movementDate(left))
    if (dateCmp) return dateCmp
    const periodCmp = periodRank(left.period) - periodRank(right.period)
    if (periodCmp) return periodCmp
    const classCmp = (left.className || "").localeCompare(right.className || "", "zh-Hant")
    if (classCmp) return classCmp
    return left.id.localeCompare(right.id)
  })
}

export function displayPlans(plans: Plan[]): { plans: Plan[]; hiddenDuplicateCount: number } {
  const deduped = dedupePlans(plans)
  return {
    plans: sortPlansByMovementDate(deduped),
    hiddenDuplicateCount: Math.max(0, plans.length - deduped.length),
  }
}

function joinTeachers(...parts: string[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    for (const name of part.split(/[、,，]/).map((item) => item.trim()).filter(Boolean)) {
      if (seen.has(name)) continue
      seen.add(name)
      out.push(name)
    }
  }
  return out.join("、")
}

/** 調課暫存：同一 key（日／班／節）合併原任／新任；協作雙行唔再雙顯。 */
export function mergeSwapsForDisplay(swaps: Swap[]): Swap[] {
  const byKey = new Map<string, Swap>()
  for (const swap of swaps) {
    const key = swap.key || `${swap.date}|${swap.className}|${swap.period}|${swap.type}`
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, { ...swap })
      continue
    }
    byKey.set(key, {
      ...prev,
      origTeacher: joinTeachers(prev.origTeacher, swap.origTeacher),
      newTeacher: joinTeachers(prev.newTeacher, swap.newTeacher, prev.newTeachers || "", swap.newTeachers || ""),
      newTeachers: joinTeachers(prev.newTeacher, swap.newTeacher, prev.newTeachers || "", swap.newTeachers || ""),
      status: [prev.status, swap.status].filter((item) => item && item.includes("已確定")).length
        ? "已確定"
        : prev.status || swap.status,
    })
  }
  return Array.from(byKey.values())
}

export function sortSwapsByDate(swaps: Swap[]): Swap[] {
  return [...swaps].sort((left, right) => {
    const dateCmp = (right.date || "").localeCompare(left.date || "")
    if (dateCmp) return dateCmp
    const periodCmp = periodRank(left.period) - periodRank(right.period)
    if (periodCmp) return periodCmp
    const classCmp = (left.className || "").localeCompare(right.className || "", "zh-Hant")
    if (classCmp) return classCmp
    return (left.key || "").localeCompare(right.key || "")
  })
}

export function recordDedupeKey(row: RecordRow): string {
  return `${row.date}|${row.period}|${row.absent}|${row.cover}|${row.kind}`
}

export function dedupeRecords(rows: RecordRow[]): RecordRow[] {
  const seen = new Set<string>()
  const out: RecordRow[] = []
  for (const row of rows) {
    const key = recordDedupeKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

export function sortRecordsByDate(rows: RecordRow[]): RecordRow[] {
  return [...rows].sort((left, right) => {
    const dateCmp = (right.date || "").localeCompare(left.date || "")
    if (dateCmp) return dateCmp
    const periodCmp = periodRank(left.period) - periodRank(right.period)
    if (periodCmp) return periodCmp
    const absentCmp = (left.absent || "").localeCompare(right.absent || "", "zh-Hant")
    if (absentCmp) return absentCmp
    return (left.kind || "").localeCompare(right.kind || "", "zh-Hant")
  })
}

export function displaySwaps(swaps: Swap[]): { swaps: Swap[]; mergedAway: number } {
  const merged = mergeSwapsForDisplay(swaps)
  return { swaps: sortSwapsByDate(merged), mergedAway: Math.max(0, swaps.length - merged.length) }
}

export function displayRecords(rows: RecordRow[]): { records: RecordRow[]; hiddenDuplicateCount: number } {
  const deduped = dedupeRecords(rows)
  return {
    records: sortRecordsByDate(deduped),
    hiddenDuplicateCount: Math.max(0, rows.length - deduped.length),
  }
}
