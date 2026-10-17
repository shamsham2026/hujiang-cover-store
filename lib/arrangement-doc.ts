import { SIX_D_PLAN_ID, sixDConfirmedPlan, ping20261016Plans, PING_PLAN_IDS } from "@/lib/known-arrangements"
import type { Plan } from "@/lib/types"

/** version 3：活躍 plans 只留進行中；known／已確認歸入 archived，唔再幽靈返 /arrange／/slip。 */
export const ARRANGEMENT_VERSION = 3

export type ArrangementDoc = {
  version: number
  plans: Plan[]
  archived: Plan[]
}

export function emptyArrangementDoc(): ArrangementDoc {
  return { version: 0, plans: [], archived: [] }
}

function isPlan(value: unknown): value is Plan {
  if (!value || typeof value !== "object") return false
  const plan = value as Partial<Plan>
  return typeof plan.id === "string" && plan.id.length > 0 && (plan.mode === "cover" || plan.mode === "swap") && typeof plan.date === "string"
}

const KNOWN_IDS = new Set<string>([SIX_D_PLAN_ID, ...PING_PLAN_IDS])

export function isKnownPlanId(id: string) {
  return KNOWN_IDS.has(id)
}

export function knownSeedPlans(): Plan[] {
  return [sixDConfirmedPlan(), ...ping20261016Plans()]
}

export function parseArrangementDoc(raw: string): ArrangementDoc {
  try {
    const value = JSON.parse(raw) as { version?: unknown; plans?: unknown; archived?: unknown }
    const plans = Array.isArray(value.plans) ? value.plans.filter(isPlan) : []
    const archived = Array.isArray(value.archived) ? value.archived.filter(isPlan) : []
    const version = typeof value.version === "number" && Number.isFinite(value.version) ? value.version : 0
    return { version, plans, archived }
  } catch {
    return emptyArrangementDoc()
  }
}

function mergeById(primary: Plan[], extra: Plan[]): Plan[] {
  const byId = new Map(primary.map((plan) => [plan.id, plan]))
  for (const plan of extra) {
    if (!byId.has(plan.id)) byId.set(plan.id, plan)
  }
  return Array.from(byId.values())
}

/** 升級到 v3：known／示範歷史移出活躍位，只留 archived；之後唔再寫返 plans。 */
export function withKnownArrangements(doc: ArrangementDoc): ArrangementDoc {
  if (doc.version >= ARRANGEMENT_VERSION) {
    // 保險：即使 version 已係 3，活躍位若仍有 known id 亦清走
    const leaked = doc.plans.filter((plan) => KNOWN_IDS.has(plan.id))
    if (!leaked.length) return doc
    const active = doc.plans.filter((plan) => !KNOWN_IDS.has(plan.id))
    return {
      version: ARRANGEMENT_VERSION,
      plans: active,
      archived: mergeById(doc.archived, leaked),
    }
  }

  const byId = new Map(doc.plans.map((plan) => [plan.id, plan]))
  // v1→v2 曾把 known bake 入 plans；v3 改為只入 archived
  const seeds = knownSeedPlans()
  const fromPlans = doc.plans.filter((plan) => KNOWN_IDS.has(plan.id))
  const archived = mergeById(doc.archived, [...fromPlans, ...seeds])
  const active = Array.from(byId.values()).filter((plan) => !KNOWN_IDS.has(plan.id))
  return { version: ARRANGEMENT_VERSION, plans: active, archived }
}

export function upsertPlan(doc: ArrangementDoc, plan: Plan): ArrangementDoc {
  const plans = [plan, ...doc.plans.filter((row) => row.id !== plan.id)]
  // 新加入活躍時，若之前喺 archived 同 id，唔自動刪 archived（歷史可並存；活躍優先顯示）
  return { version: Math.max(doc.version, ARRANGEMENT_VERSION), plans, archived: doc.archived }
}

export function removePlan(doc: ArrangementDoc, id: string): ArrangementDoc {
  return {
    version: Math.max(doc.version, ARRANGEMENT_VERSION),
    plans: doc.plans.filter((plan) => plan.id !== id),
    archived: doc.archived,
  }
}

/** 確認完成：由活躍移入 archived（保留完整 plan 俾 /records 重下）。 */
export function archivePlans(doc: ArrangementDoc, moving: Plan[]): ArrangementDoc {
  const ids = new Set(moving.map((plan) => plan.id).filter(Boolean))
  if (!ids.size) return doc
  const kept = doc.plans.filter((plan) => !ids.has(plan.id))
  const moved = doc.plans.filter((plan) => ids.has(plan.id))
  const extras = moving.filter((plan) => plan?.id && !moved.some((row) => row.id === plan.id))
  return {
    version: Math.max(doc.version, ARRANGEMENT_VERSION),
    plans: kept,
    archived: mergeById(doc.archived, [...moved, ...extras]),
  }
}
