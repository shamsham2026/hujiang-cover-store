export type TeacherHourDelta = {
  leaveDelta: number
  coverDelta: number
}

export type HourAdjustmentsDoc = {
  adjustments: Record<string, TeacherHourDelta>
  exclusions: string[]
}

export const HOUR_ADJUSTMENTS_LS_KEY = "hujiang-hour-adjustments"

export function emptyHourAdjustments(): HourAdjustmentsDoc {
  return { adjustments: {}, exclusions: [] }
}

export function parseHourAdjustments(raw: unknown): HourAdjustmentsDoc {
  if (!raw || typeof raw !== "object") return emptyHourAdjustments()
  const value = raw as { adjustments?: unknown; exclusions?: unknown }
  const adjustments: Record<string, TeacherHourDelta> = {}
  if (value.adjustments && typeof value.adjustments === "object") {
    for (const [short, entry] of Object.entries(value.adjustments as Record<string, unknown>)) {
      if (!short || !entry || typeof entry !== "object") continue
      const row = entry as { leaveDelta?: unknown; coverDelta?: unknown }
      const leaveDelta = typeof row.leaveDelta === "number" && Number.isFinite(row.leaveDelta) ? Math.trunc(row.leaveDelta) : 0
      const coverDelta = typeof row.coverDelta === "number" && Number.isFinite(row.coverDelta) ? Math.trunc(row.coverDelta) : 0
      if (leaveDelta === 0 && coverDelta === 0) continue
      adjustments[short] = { leaveDelta, coverDelta }
    }
  }
  const exclusions = Array.isArray(value.exclusions)
    ? [...new Set(value.exclusions.filter((item): item is string => typeof item === "string" && item.length > 0))]
    : []
  return { adjustments, exclusions }
}

export function readHourAdjustmentsLocal(): HourAdjustmentsDoc {
  if (typeof window === "undefined") return emptyHourAdjustments()
  try {
    return parseHourAdjustments(JSON.parse(localStorage.getItem(HOUR_ADJUSTMENTS_LS_KEY) || "null"))
  } catch {
    return emptyHourAdjustments()
  }
}

export function writeHourAdjustmentsLocal(doc: HourAdjustmentsDoc) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(HOUR_ADJUSTMENTS_LS_KEY, JSON.stringify(doc))
  } catch {
    // ignore quota / private mode
  }
}

export function mergeHourAdjustments(primary: HourAdjustmentsDoc, fallback: HourAdjustmentsDoc): HourAdjustmentsDoc {
  const adjustments = { ...fallback.adjustments, ...primary.adjustments }
  const exclusions = [...new Set([...fallback.exclusions, ...primary.exclusions])]
  return parseHourAdjustments({ adjustments, exclusions })
}
