/**
 * 早會當值與代課優先名單。
 * 之後改老師，只改這個檔案的名字即可。
 */

/** 主任。7:30 與 7:45 都可以代或調。 */
export const DIRECTORS = ["俊", "忻", "玉", "錦", "黃", "邢", "梓", "蕭", "琪"] as const

/** 副校。只可代或調 7:30。 */
export const VICE_PRINCIPALS = ["袁", "羅"] as const

/**
 * 莉是主任，也是班主任，不代早會。
 * 7:30 和 7:45 的代課、調課名單都排除她。
 */
export const MORNING_EXCLUDED = ["莉"] as const

/**
 * 非班主任。只可代或調 7:45。
 * 試算表簡稱是「燁」，名單裡的「燤」一併接受。
 */
export const NON_HOMEROOM = ["蔡", "舒", "寶", "裕", "燁", "燤", "燕", "萬", "吳", "悠"] as const

/** 有空時永遠排在代課名單最前。 */
export const PRIORITY_COVER = ["曉晴", "朗"] as const

const DIRECTOR_SET = new Set<string>(DIRECTORS)
const VICE_SET = new Set<string>(VICE_PRINCIPALS)
const EXCLUDED_SET = new Set<string>(MORNING_EXCLUDED)
const NON_HOMEROOM_SET = new Set<string>(NON_HOMEROOM)
const PRIORITY_SET = new Set<string>(PRIORITY_COVER)

export type MorningPeriod = "7:30" | "7:45"

export function isDirector(short: string) {
  return DIRECTOR_SET.has(short)
}

export function isVicePrincipal(short: string) {
  return VICE_SET.has(short)
}

export function isNonHomeroom(short: string) {
  return NON_HOMEROOM_SET.has(short)
}

export function isMorningExcluded(short: string) {
  return EXCLUDED_SET.has(short)
}

export function isPriorityCover(short: string, fullName = "") {
  if (PRIORITY_SET.has(short)) return true
  return fullName.includes("曉晴")
}

/** 7:30 只限主任、副校。7:45 只限主任與非班主任名單。莉兩邊都不可以。 */
export function canCoverMorning(period: MorningPeriod, short: string) {
  if (EXCLUDED_SET.has(short)) return false
  if (period === "7:30") return DIRECTOR_SET.has(short) || VICE_SET.has(short)
  return DIRECTOR_SET.has(short) || NON_HOMEROOM_SET.has(short)
}

export function morningBlockReason(period: string, short: string) {
  if (period !== "7:30" && period !== "7:45") return null
  if (EXCLUDED_SET.has(short)) return "莉不代早會（主任兼班主任）"
  if (canCoverMorning(period, short)) return null
  if (period === "7:30") return "7:30 只限主任及副校"
  return "7:45 只限主任及非班主任名單"
}
