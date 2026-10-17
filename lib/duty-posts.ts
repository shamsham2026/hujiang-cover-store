/** 早會前和放學的正式崗位。其餘放學活動只是備註：不佔當值、不出現在列表。每天誰當哪一崗以總表為準。 */

const MORNING_730 = ["C1", "C2", "B12", "E"] as const
const MORNING_745 = ["C1", "C2", "B12"] as const
const DISMISSAL = [
  "1A",
  "1A*",
  "1B",
  "1B*",
  "1C",
  "1C*",
  "1D",
  "1D*",
  "2AB",
  "2AB*",
  "2CD",
  "2CD*",
  "P3",
  "P3*",
  "P4",
  "P4*",
  "P56",
  "P56*",
  "車1",
  "車2",
  "車3",
  "門",
  "活",
  "咪",
  "康1",
  "康2",
  "康3",
  "康4",
  "過",
  "南",
  "褓/過",
] as const

const DISMISSAL_BASE = new Set<string>(["1A", "1B", "1C", "1D", "2AB", "2CD", "P3", "P4", "P56"])

const ORDER: Record<string, readonly string[]> = {
  "7:30": MORNING_730,
  "7:45": MORNING_745,
  放學: DISMISSAL,
}

const ALIAS: Record<string, string> = {
  "1車": "車1",
  "2車": "車2",
  "3車": "車3",
}

const DISPLAY: Record<string, string> = {
  車1: "1車",
  車2: "2車",
  車3: "3車",
}

export function listedDutyPeriod(period: string) {
  return period in ORDER
}

/**
 * 去掉空格，車次統一成試算表的車1、車2、車3。
 * 放學的星號是另一個崗位（1C*），要保留；「1B *」收成 1B*。
 * 早會、小息的星號仍是同一個崗位。
 */
export function canonicalDutyPost(raw: string) {
  const wrapped = raw.match(/當值\((.+)\)/)
  const compact = (wrapped?.[1] || raw).replace(/\s+/g, "").trim()
  const unstarred = compact.replace(/\*/g, "")
  const aliased = ALIAS[unstarred] || unstarred
  if (compact.includes("*") && DISMISSAL_BASE.has(aliased)) return `${aliased}*`
  return aliased
}

/** 放學 1A 與 1A* 是同一班的崗位，對調時視作同一個。 */
export function sameDutyPost(left: string, right: string) {
  return dutyMatchKey(left) === dutyMatchKey(right)
}

function dutyMatchKey(post: string) {
  const key = canonicalDutyPost(post)
  if (key.endsWith("*") && DISMISSAL_BASE.has(key.slice(0, -1))) return key.slice(0, -1)
  return key
}

export function displayDutyPost(canonical: string) {
  return DISPLAY[canonical] || canonical
}

export function listedDuty(period: string, canonical: string) {
  return ORDER[period]?.includes(canonical) ?? false
}

export function dutyPostRank(period: string, canonical: string) {
  const index = ORDER[period]?.indexOf(canonical) ?? -1
  return index === -1 ? 999 : index
}

/** 放學列上、指定崗位以外的項目是活動備註，不佔當值、也不攤在課表上。 */
export function isActivityRemark(period: string, location: string, course = "") {
  if (period !== "放學") return false
  const key = canonicalDutyPost(location || course)
  if (!key) return false
  return !listedDuty(period, key)
}

export function activityNames(slots: Array<{ period: string; className?: string; course?: string; location?: string }>) {
  const names: string[] = []
  for (const slot of slots) {
    const place = slot.location || slot.className || ""
    if (!isActivityRemark(slot.period, place, slot.course || "")) continue
    const name = canonicalDutyPost(place || slot.course || "")
    if (name) names.push(/[A-Za-z]/.test(name) ? name.toUpperCase() : name)
  }
  return [...new Set(names)]
}

export function activityHint(slots: Array<{ period: string; className?: string; course?: string; location?: string }>) {
  const names = activityNames(slots)
  return names.length ? `可能有 ${names.join("、")} 活動` : ""
}

export function hideActivityRemarks<T extends { period: string; remark?: boolean; location?: string; className?: string; course?: string }>(slots: T[]) {
  return slots.filter((slot) => !slot.remark && !isActivityRemark(slot.period, slot.location || slot.className || "", slot.course || ""))
}

export function cycleShowsRemark(legs: Array<{ period: string; className: string; course: string }>) {
  return legs.some((leg) => isActivityRemark(leg.period, leg.className, leg.course))
}
