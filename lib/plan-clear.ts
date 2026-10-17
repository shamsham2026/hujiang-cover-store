import { arrangementPlans } from "@/lib/card"
import type { Plan } from "@/lib/types"

/** 確認紀錄精簡形；id 通常 = arrangementId(plan)（現況 ≈ plan.id）。 */
export type ConfirmRef = {
  id: string
  date?: string
  period?: string
  className?: string
  teachers?: string
  lesson?: string
  kind?: string
}

function parts(value: string | undefined) {
  return (value || "")
    .split(/[、,，|]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function datePeriodMatch(plan: Plan, item: ConfirmRef) {
  const dates = parts(item.date)
  const periods = parts(item.period)
  if (!dates.length || !periods.length) return false
  const dateOk = dates.includes(plan.date) || Boolean(plan.targetDate && dates.includes(plan.targetDate))
  const periodOk = periods.includes(plan.period) || Boolean(plan.partnerPeriod && periods.includes(plan.partnerPeriod))
  return dateOk && periodOk
}

/** 由確認紀錄搵要清出嘅活躍 plan id（主＋related 一組）。 */
export function planIdsClearedByConfirmations(plans: Plan[], items: ConfirmRef[]): Set<string> {
  const clear = new Set<string>()
  if (!plans.length || !items.length) return clear
  const ids = new Set(items.map((item) => item.id).filter(Boolean))

  for (const plan of plans) {
    const hit = ids.has(plan.id) || items.some((item) => datePeriodMatch(plan, item))
    if (!hit) continue
    for (const row of arrangementPlans(plan, plans)) clear.add(row.id)
  }
  return clear
}

export function removePlansByIds(plans: Plan[], ids: Set<string>): Plan[] {
  if (!ids.size) return plans
  return plans.filter((plan) => !ids.has(plan.id))
}

/** 本機通知對話確認成功後：清 notice.plan＋related。 */
export function removeNoticeGroup(plans: Plan[], plan: Plan | null | undefined, related: Plan[] = []): Plan[] {
  if (!plan) return plans
  const group = arrangementPlans(plan, [...related, ...plans])
  const ids = new Set(group.map((row) => row.id))
  return removePlansByIds(plans, ids)
}
