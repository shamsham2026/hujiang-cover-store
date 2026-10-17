import { isPriorityCover } from "@/lib/staff"

export type RankInput = {
  teacher: string
  fullName?: string
  freeCount: number
  absenceCount: number
  teachesClass: boolean
  busy: boolean
  eligible: boolean
  ineligibleReason?: string
  warning?: string
}

export type RankedTeacher = RankInput & {
  reason: string
  rank: number | null
  priority: boolean
}

export function coverReason(input: Pick<RankInput, "teacher" | "fullName" | "freeCount" | "absenceCount" | "teachesClass" | "warning">) {
  const parts = [`當日空堂 ${input.freeCount} 節`]
  if (isPriorityCover(input.teacher, input.fullName || "")) parts.unshift("優先")
  if (input.absenceCount > 0) parts.push(`曾請假 ${input.absenceCount} 次`)
  if (input.teachesClass) parts.push("曾教該班")
  if (input.warning) parts.push(input.warning)
  return parts.join(" · ")
}

function compareEligible(left: RankInput, right: RankInput) {
  const leftPriority = isPriorityCover(left.teacher, left.fullName || "") ? 1 : 0
  const rightPriority = isPriorityCover(right.teacher, right.fullName || "") ? 1 : 0
  const leftHeld = left.warning ? 1 : 0
  const rightHeld = right.warning ? 1 : 0
  if (leftHeld !== rightHeld) return leftHeld - rightHeld
  if (leftPriority !== rightPriority) return rightPriority - leftPriority
  if (left.freeCount !== right.freeCount) return right.freeCount - left.freeCount
  if (left.absenceCount !== right.absenceCount) return right.absenceCount - left.absenceCount
  if (left.teachesClass !== right.teachesClass) return Number(right.teachesClass) - Number(left.teachesClass)
  return left.teacher.localeCompare(right.teacher, "zh-Hant")
}

/** 只排列符合資格而且該節有空的老師。不符合的另外列出，不混進較低順位。 */
export function rankCoverTeachers(inputs: RankInput[]) {
  const eligible = inputs
    .filter((input) => input.eligible && !input.busy)
    .sort(compareEligible)
    .map((input, index) => ({
      ...input,
      priority: isPriorityCover(input.teacher, input.fullName || ""),
      reason: coverReason(input),
      rank: index + 1,
    }))

  const ineligible = inputs
    .filter((input) => !input.eligible || input.busy)
    .map((input) => ({
      ...input,
      priority: false,
      reason: input.ineligibleReason || (input.busy ? "這一節已有課堂或當值" : "不符合資格"),
      rank: null,
    }))
    .sort((left, right) => left.teacher.localeCompare(right.teacher, "zh-Hant"))

  return { eligible, ineligible }
}
