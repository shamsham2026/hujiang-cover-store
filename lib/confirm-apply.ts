import { gasCallsForPlan } from "@/lib/gas-payload"
import type { InboxItem } from "@/lib/confirmations"
import { arrangementFacts } from "@/lib/confirmations"
import type { Plan } from "@/lib/types"

export function confirmApplyPayload(plan: Plan, related: Plan[], item: InboxItem) {
  const calls = gasCallsForPlan(plan, [plan, ...related])
  const facts = arrangementFacts(plan, related)
  const swap = calls.find((call) => call.kind === "swap")
  const entries = calls.find((call) => call.kind === "entries")
  const cover = calls.find((call) => call.kind === "cover")
  return {
    action: "applyConfirmedArrangement" as const,
    id: item.id,
    who: item.who,
    when: item.when,
    keys: facts.keys,
    log: item,
    swap: swap?.kind === "swap" ? swap.payload : null,
    entries: entries?.kind === "entries" ? entries.payload : null,
    cover: cover?.kind === "cover" ? cover.payload : null,
  }
}
