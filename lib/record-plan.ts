import type { Plan, PlanMode, RecordRow, Swap } from "@/lib/types"

function isCoverLabel(value: string) {
  return (value || "").includes("代課")
}

export function modeFromLabel(value: string): PlanMode {
  return isCoverLabel(value) ? "cover" : "swap"
}

export function downloadLabel(value: string) {
  return isCoverLabel(value) ? "下載代課紙" : "下載調課紙"
}

export function planFromSwap(swap: Swap): Plan {
  const mode = modeFromLabel(swap.type)
  const course = (swap.newLesson || "").trim()
  return {
    id: `swap:${swap.key}:${swap.newTeacher || ""}`,
    mode,
    date: swap.date,
    targetDate: swap.date,
    period: swap.period,
    className: swap.className || "",
    course,
    teacher: swap.origTeacher || "",
    partnerTeacher: swap.newTeacher || swap.newTeachers || "",
    partnerPeriod: swap.period,
    partnerCourse: course,
    reason: swap.type || "",
    tier: mode === "cover" ? "代課" : "調課",
  }
}

function teachersMatch(a: string, b: string) {
  const left = (a || "").trim()
  const right = (b || "").trim()
  if (!left || !right) return false
  return left === right || left.includes(right) || right.includes(left)
}

export function planFromRecord(
  row: RecordRow,
  swaps: Swap[] = [],
  plans: Plan[] = [],
): Plan {
  const mode = modeFromLabel(row.kind)
  const matchedSwap = swaps.find(
    (swap) =>
      swap.date === row.date &&
      swap.period === row.period &&
      teachersMatch(swap.origTeacher, row.absent) &&
      teachersMatch(swap.newTeacher || swap.newTeachers || "", row.cover),
  )
  if (matchedSwap) {
    const plan = planFromSwap(matchedSwap)
    // Prefer row kind for mode/label consistency on records table
    return { ...plan, mode, tier: mode === "cover" ? "代課" : "調課" }
  }
  const matchedPlan = plans.find(
    (plan) =>
      plan.date === row.date &&
      plan.period === row.period &&
      teachersMatch(plan.teacher, row.absent) &&
      teachersMatch(plan.partnerTeacher, row.cover),
  )
  if (matchedPlan) {
    return { ...matchedPlan, mode, tier: mode === "cover" ? "代課" : matchedPlan.tier || "調課" }
  }
  return {
    id: `record:${row.date}|${row.period}|${row.absent}|${row.cover}|${row.kind}`,
    mode,
    date: row.date,
    targetDate: row.date,
    period: row.period,
    className: "",
    course: "",
    teacher: row.absent || "",
    partnerTeacher: row.cover || "",
    partnerPeriod: row.period,
    partnerCourse: "",
    reason: row.kind || "",
    tier: mode === "cover" ? "代課" : "調課",
  }
}
