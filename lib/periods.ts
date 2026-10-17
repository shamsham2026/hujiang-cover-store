export const PERIODS = [
  { id: "7:30", label: "早會前 7:30", time: "7:30–7:45", kind: "duty" },
  { id: "7:45", label: "早會前 7:45", time: "7:45–8:10", kind: "duty" },
  { id: "班主任節", label: "班主任節", time: "8:10–8:35", kind: "duty" },
  { id: "1", label: "第 1 節", time: "8:35–9:05", kind: "lesson" },
  { id: "2", label: "第 2 節", time: "9:05–9:35", kind: "lesson" },
  { id: "小息1", label: "第一小息", time: "9:35–9:50", kind: "duty" },
  { id: "3", label: "第 3 節", time: "9:50–10:20", kind: "lesson" },
  { id: "4", label: "第 4 節", time: "10:20–10:50", kind: "lesson" },
  { id: "小息2", label: "第二小息", time: "10:50–11:05", kind: "duty" },
  { id: "5", label: "第 5 節", time: "11:05–11:35", kind: "lesson" },
  { id: "6", label: "第 6 節", time: "11:35–12:05", kind: "lesson" },
  { id: "午膳", label: "午膳", time: "12:05–12:45", kind: "duty" },
  { id: "午息", label: "午息", time: "12:45–13:00", kind: "duty" },
  { id: "7", label: "第 7 節", time: "13:00–13:30", kind: "lesson" },
  { id: "8", label: "第 8 節", time: "13:30–14:00", kind: "lesson" },
  { id: "9", label: "第 9 節", time: "14:00–14:30", kind: "lesson" },
  { id: "10", label: "第 10 節", time: "14:30–15:00", kind: "lesson" },
  { id: "放學", label: "放學當值", time: "15:00 後", kind: "duty" },
] as const

export const PERIOD_ORDER = new Map(PERIODS.map((period, index) => [period.id, index]))

export const LESSON_PERIODS = PERIODS.filter((period) => period.kind === "lesson").map((period) => period.id)

export const GRADES = ["1", "2", "3", "4", "5", "6"] as const
export const SECTIONS = ["A", "B", "C", "D"] as const
export const CLASSES = GRADES.flatMap((grade) => SECTIONS.map((section) => `${grade}${section}`))

export const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const

export const REASONS = ["病假", "事假", "覆診", "帶隊", "會議", "進修", "IEP", "按教師調課", "其他"]

export function resolvedReason(preset: string, detail: string) {
  if (preset === "其他") return detail.trim()
  return preset.trim()
}

export function reasonReady(preset: string, detail: string) {
  return resolvedReason(preset, detail).length > 0
}

export function periodMeta(id: string) {
  return PERIODS.find((period) => period.id === id) ?? { id, label: id === "早會前" ? "早會前" : id, time: "", kind: "lesson" as const }
}

export function periodLabel(id: string) {
  return periodMeta(id).label
}

export function sortByPeriod<T extends { period: string }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const left = PERIOD_ORDER.get(a.period as (typeof PERIODS)[number]["id"]) ?? 99
    const right = PERIOD_ORDER.get(b.period as (typeof PERIODS)[number]["id"]) ?? 99
    return left - right
  })
}
