"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { readPlans, writePlans } from "@/lib/plans"
import type { Plan } from "@/lib/types"

/** Remote 係成員資格真相；成功讀到遠端（包括空陣列）就以遠端為準。
 *  例外：剛本機寫入、遠端尚未追上嘅 pending id，暫時保留，避免「加入即消失」。 */
export function mergeSharedPlans(local: Plan[], remote: Plan[] | null, pendingIds?: Set<string>) {
  if (remote == null) return local
  if (!pendingIds?.size) return remote
  const remoteIds = new Set(remote.map((plan) => plan.id))
  const keep = local.filter((plan) => pendingIds.has(plan.id) && !remoteIds.has(plan.id))
  if (!keep.length) return remote
  return [...keep, ...remote]
}

async function readRemote(): Promise<Plan[] | null> {
  try {
    const response = await fetch("/api/arrangements", { cache: "no-store" })
    if (!response.ok) return null
    const body = (await response.json()) as { plans?: Plan[] }
    return Array.isArray(body.plans) ? body.plans : []
  } catch {
    return null
  }
}

async function postPlan(plan: Plan) {
  const response = await fetch("/api/arrangements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  })
  if (!response.ok) throw new Error("安排未能儲存。")
}

async function deletePlan(id: string) {
  const response = await fetch("/api/arrangements", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  })
  if (!response.ok) throw new Error("安排未能移除。")
}

export function useSharedPlans() {
  const [plans, setPlans] = useState<Plan[]>([])
  const plansRef = useRef(plans)
  const writing = useRef(0)
  const pendingIds = useRef(new Set<string>())
  const pendingTimer = useRef<number | null>(null)
  plansRef.current = plans

  const refresh = useCallback(async () => {
    if (writing.current) return
    const remote = await readRemote()
    if (writing.current) return
    const next = mergeSharedPlans(readPlans(), remote, pendingIds.current)
    setPlans(next)
    writePlans(next)
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15000)
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
      if (pendingTimer.current) window.clearTimeout(pendingTimer.current)
    }
  }, [refresh])

  return {
    plans,
    replacePlans: async (next: Plan[]) => {
      const prev = plansRef.current
      writing.current += 1
      setPlans(next)
      writePlans(next)
      const added = next.filter((plan) => !prev.some((row) => row.id === plan.id)).map((plan) => plan.id)
      for (const id of added) pendingIds.current.add(id)
      if (added.length) {
        if (pendingTimer.current) window.clearTimeout(pendingTimer.current)
        pendingTimer.current = window.setTimeout(() => {
          pendingIds.current.clear()
          pendingTimer.current = null
        }, 12000)
      }
      try {
        const nextIds = new Set(next.map((plan) => plan.id))
        const prevIds = new Set(prev.map((plan) => plan.id))
        await Promise.all([
          ...next
            .filter((plan) => {
              const old = prev.find((row) => row.id === plan.id)
              return !old || JSON.stringify(old) !== JSON.stringify(plan)
            })
            .map((plan) => postPlan(plan)),
          ...[...prevIds].filter((id) => !nextIds.has(id)).map((id) => deletePlan(id)),
        ])
      } finally {
        writing.current -= 1
      }
    },
    refresh,
  }
}
