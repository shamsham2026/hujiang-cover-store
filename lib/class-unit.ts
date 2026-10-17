import type { Plan, PlanLeg } from "@/lib/types"

export function classLabels(value: string | undefined) {
  return [...new Set((value || "").split(/[、,，]/).map((part) => part.trim()).filter(Boolean))]
}

export function planClasses(plan: Plan) {
  const found = new Set<string>()
  for (const name of classLabels(plan.className)) found.add(name)
  for (const leg of plan.legs || []) {
    for (const name of classLabels(leg.className)) found.add(name)
    for (const name of leg.classes || []) {
      for (const label of classLabels(name)) found.add(label)
    }
  }
  if (!found.size) found.add(plan.duty ? "當值" : "其他")
  return [...found]
}

export function legMatchesClass(leg: PlanLeg, className: string) {
  return classLabels(leg.className).includes(className) || (leg.classes || []).some((name) => classLabels(name).includes(className))
}

function classRank(name: string) {
  const match = /^(\d+)(.*)$/.exec(name)
  return match ? ([0, Number(match[1]), match[2]] as const) : ([1, 0, name] as const)
}

export function compareClass(left: string, right: string) {
  const a = classRank(left)
  const b = classRank(right)
  if (a[0] !== b[0]) return a[0] - b[0]
  if (a[1] !== b[1]) return a[1] - b[1]
  return a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0
}
