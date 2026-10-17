import type { Plan, PlanLeg } from "@/lib/types"

/** 2026-10-13 已確認的 6D 調課紙。三方同日合成一張，不能拆成五次調課。 */
export const SIX_D_PLAN_ID = "6d-2026-10-13-doubles"

function leg(period: string, toPeriod: string, course: string, teacher: string): PlanLeg {
  return {
    date: "2026-10-13",
    period,
    toDate: "2026-10-13",
    toPeriod,
    className: "6D",
    classes: ["6D"],
    course,
    teacher,
    teachers: [teacher],
  }
}

export function sixDConfirmedPlan(): Plan {
  return {
    id: SIX_D_PLAN_ID,
    mode: "swap",
    date: "2026-10-13",
    targetDate: "2026-10-13",
    period: "1",
    className: "6D",
    course: "6D常識",
    teacher: "高",
    teachers: ["高"],
    partnerTeacher: "莉",
    partnerTeachers: ["莉"],
    partnerPeriod: "3",
    partnerCourse: "6D中文",
    reason: "調課",
    tier: "同日三方",
    legs: [
      leg("7", "1", "6D常識", "高"),
      leg("1", "3", "6D中文", "莉"),
      leg("3", "7", "6D英文", "羅"),
      leg("8", "2", "6D常識", "高"),
      leg("2", "4", "6D中文", "莉"),
      leg("4", "8", "6D英文", "羅"),
    ],
  }
}

/** 2026-10-16 萍病假：3A（悠／朗／玉／燁／朗放學）＋5A（曉晴）。放學唔計時數。 */
export const PING_PLAN_IDS = [
  "ping-2026-10-16-3a-homeroom",
  "ping-2026-10-16-3a-p1",
  "ping-2026-10-16-3a-p2",
  "ping-2026-10-16-3a-lunch",
  "ping-2026-10-16-3a-p9",
  "ping-2026-10-16-3a-p10",
  "ping-2026-10-16-3a-dismissal",
  "ping-2026-10-16-5a-p3",
  "ping-2026-10-16-5a-p4",
] as const

function cover(id: string, period: string, className: string, course: string, partner: string, duty = false): Plan {
  return {
    id,
    mode: "cover",
    date: "2026-10-16",
    targetDate: "2026-10-16",
    period,
    className,
    course,
    teacher: "萍",
    teachers: ["萍"],
    partnerTeacher: partner,
    partnerTeachers: [partner],
    partnerPeriod: period,
    partnerCourse: course,
    reason: "病假",
    tier: "代課",
    duty,
    legs: [],
  }
}

export function ping20261016Plans(): Plan[] {
  return [
    cover("ping-2026-10-16-3a-homeroom", "班主任節", "3A", "班主任節(3A)", "悠", true),
    cover("ping-2026-10-16-3a-p1", "1", "3A", "3A英文", "朗", false),
    cover("ping-2026-10-16-3a-p2", "2", "3A", "3A英文", "朗", false),
    cover("ping-2026-10-16-3a-lunch", "午膳", "3A", "午膳當值(3A)", "玉", true),
    cover("ping-2026-10-16-3a-p9", "9", "3A", "3A導修", "燁", false),
    cover("ping-2026-10-16-3a-p10", "10", "3A", "3A導修", "燁", false),
    cover("ping-2026-10-16-3a-dismissal", "放學", "3A", "放學當值(康3)", "朗", true),
    cover("ping-2026-10-16-5a-p3", "3", "5A", "5A英文", "曉晴", false),
    cover("ping-2026-10-16-5a-p4", "4", "5A", "5A英文", "曉晴", false),
  ]
}
