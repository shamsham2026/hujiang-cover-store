import type { Plan } from "@/lib/types"

const KEY = "hujiang-plans"
const GAS_KEY = "hujiang-gas-url"
const HIDDEN_KEY = "hujiang-hidden-swap-keys"

export function readPlans(): Plan[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Plan[]) : []
  } catch {
    return []
  }
}

export function writePlans(plans: Plan[]) {
  window.localStorage.setItem(KEY, JSON.stringify(plans))
  window.dispatchEvent(new Event("hujiang-plans"))
}

export function readGasUrl() {
  if (typeof window === "undefined") return ""
  return window.localStorage.getItem(GAS_KEY) || ""
}

export function writeGasUrl(url: string) {
  window.localStorage.setItem(GAS_KEY, url.trim())
}

export function readHiddenKeys() {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(HIDDEN_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0) : []
  } catch {
    return []
  }
}

export function writeHiddenKeys(keys: string[]) {
  window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...new Set(keys)]))
}
