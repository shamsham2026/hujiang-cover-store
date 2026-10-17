const DUTY_PERIODS = new Set(["7:30", "7:45", "早會前", "班主任節", "小息1", "小息2", "午膳", "午息", "放學"])

export function dutyLocation(course: string) {
  const match = course.match(/當值\((.+)\)/)
  return match?.[1] || ""
}

/** 當值：課名含「當值」，以及放學、早會、小息、午膳、午息、班主任節。 */
export function isDuty(period: string, course: string) {
  if (DUTY_PERIODS.has(period)) return true
  if (!course) return false
  if (course.includes("當值")) return true
  if (course.includes("班主任節")) return true
  if (course.includes("早會") || course.startsWith("放學")) return true
  if (course.includes("小息") || course.includes("午膳") || course.includes("午息")) return true
  return false
}

export function sameDayDutyMessage() {
  return "當值不可同日對調，只可代課或改日對調。"
}

/** 放學可以兼任另一個放學崗位。這是提示，不是拒絕。 */
export function dismissalConcurrentWarning(posts: string[]) {
  const names = [...new Set(posts.map((post) => post.trim()).filter(Boolean))]
  return names.length ? `已有放學當值（${names.join("、")}），可兼任` : "已有放學當值，可兼任"
}

export function dismissalConcurrent(period: string, hits: Array<{ period: string; duty?: boolean }>) {
  return period === "放學" && hits.length > 0 && hits.every((hit) => hit.period === "放學" && hit.duty)
}
