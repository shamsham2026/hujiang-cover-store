import { arrangementPlans } from "@/lib/card"
import { plansToSwaps } from "@/lib/schedule"
import type { Plan, Swap } from "@/lib/types"

export type InboxItem = {
  id: string
  who: string
  when: string
  date: string
  period: string
  className: string
  teachers: string
  lesson: string
  kind: string
  sheetWritten: boolean
}

export function parseConfirmMarker(status: string) {
  if (!status.includes("已確定") && !status.includes("新確認")) return null
  const parts = status.split("|")
  if (parts.length >= 4) return { who: parts[1] || "", when: parts[2] || "", id: parts[3] || "" }
  return { who: "", when: "", id: "" }
}

export function arrangementId(plan: Plan) {
  return plan.id || `p-${plan.mode}-${plan.date}-${plan.className}-${plan.period}-${plan.teacher}`
}

export function arrangementFacts(plan: Plan, related: Plan[] = []) {
  const group = arrangementPlans(plan, related)
  const swaps = plansToSwaps(group)
  const unique = (values: string[]) => [...new Set(values.filter(Boolean))]
  return {
    id: arrangementId(plan),
    date: unique(swaps.map((swap) => swap.date)).join("、"),
    period: unique(swaps.map((swap) => swap.period)).join("、"),
    className: unique(swaps.map((swap) => swap.className)).join("、"),
    teachers: unique(swaps.flatMap((swap) => [swap.origTeacher, swap.newTeacher])).join("、"),
    lesson: unique(swaps.map((swap) => swap.newLesson)).join("、"),
    kind: plan.mode === "cover" ? "代課安排" : "調課安排",
    keys: unique(swaps.map((swap) => swap.key)),
  }
}

export function defaultConfirmer(plan: Plan, related: Plan[] = []) {
  const swaps = plansToSwaps(arrangementPlans(plan, related))
  return [...new Set(swaps.map((swap) => swap.newTeacher).filter(Boolean))].join("、")
}

export function inboxFromSwaps(swaps: Swap[]): InboxItem[] {
  const groups = new Map<string, { marker: { who: string; when: string; id: string }; rows: Swap[] }>()
  for (const swap of swaps) {
    const marker = parseConfirmMarker(swap.status || "")
    if (!marker) continue
    const id = marker.id || swap.key
    const group = groups.get(id) || { marker, rows: [] }
    group.rows.push(swap)
    groups.set(id, group)
  }
  return [...groups.entries()].map(([id, group]) => ({
    id,
    who: group.marker.who || [...new Set(group.rows.map((row) => row.newTeacher).filter(Boolean))].join("、"),
    when: group.marker.when,
    date: [...new Set(group.rows.map((row) => row.date))].join("、"),
    period: [...new Set(group.rows.map((row) => row.period))].join("、"),
    className: [...new Set(group.rows.map((row) => row.className).filter(Boolean))].join("、"),
    teachers: [...new Set(group.rows.flatMap((row) => [row.origTeacher, row.newTeacher]).filter(Boolean))].join("、"),
    lesson: [...new Set(group.rows.map((row) => row.newLesson).filter(Boolean))].join("、"),
    kind: group.rows[0]?.type || "",
    sheetWritten: true,
  }))
}

export function mergeInbox(lists: InboxItem[][]) {
  const map = new Map<string, InboxItem>()
  for (const list of lists) {
    for (const item of list) {
      const prev = map.get(item.id)
      if (!prev) {
        map.set(item.id, item)
        continue
      }
      map.set(item.id, {
        ...prev,
        ...item,
        who: item.who || prev.who,
        when: item.when || prev.when,
        sheetWritten: prev.sheetWritten || item.sheetWritten,
      })
    }
  }
  return [...map.values()].sort((left, right) => (left.when < right.when ? 1 : left.when > right.when ? -1 : 0))
}

export function formatConfirmWhen(iso: string) {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}
