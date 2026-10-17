import seed from "@/data/seed.json"
import { parseWorkbook, SHEET_URL } from "@/lib/parse-sheet"
import type { SchoolData } from "@/lib/types"

const EXPORT_URL = `${SHEET_URL}/export?format=xlsx`
const CACHE_MS = 5 * 60 * 1000

type Cache = {
  at: number
  data: SchoolData
  source: "live" | "seed"
  warning?: string
}

let cache: Cache | null = null

export async function loadBoard(force = false) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache
  try {
    const response = await fetch(EXPORT_URL, { cache: "no-store" })
    if (!response.ok) throw new Error(`試算表回應 ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    const data = parseWorkbook(buffer)
    if (data.lessons.length < 100) throw new Error("讀到的排課資料過少")
    cache = { at: Date.now(), data, source: "live" }
    return cache
  } catch (error) {
    const warning = error instanceof Error ? error.message : "無法讀取試算表"
    cache = {
      at: Date.now(),
      data: seed as SchoolData,
      source: "seed",
      warning: `改用上次匯出的副本。${warning}`,
    }
    return cache
  }
}
