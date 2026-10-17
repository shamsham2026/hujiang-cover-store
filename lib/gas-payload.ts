import { dayChar } from "@/lib/dates"
import { arrangementPlans } from "@/lib/card"
import { legsOf, plansToSwaps } from "@/lib/schedule"
import type { Plan, Swap } from "@/lib/types"

export type TempEntry = {
  date: string
  dow: string
  period: string
  className: string
  origTeacher: string
  newTeacher: string
  newLesson: string
  swapType: string
  key: string
}

export type GasCall =
  | {
      kind: "swap"
      payload: {
        swaps: Array<{
          origDate: string
          targetDate: string
          period: string
          className: string
          origLesson: string
          applicantTeacher: string
          partnerTeacher: string
          partnerPeriod: string
          targetLesson: string
        }>
      }
    }
  | {
      kind: "cover"
      payload: {
        action: "writeSubstitute"
        date: string
        teacher: string
        reason: string
        substitutes: Array<{ period: string; subTeacher: string }>
      }
    }
  | {
      kind: "entries"
      payload: {
        action: "writeTempEntries"
        entries: TempEntry[]
      }
    }

function toEntry(swap: Swap): TempEntry {
  return {
    date: swap.date,
    dow: swap.day || dayChar(swap.date),
    period: swap.period,
    className: swap.className,
    origTeacher: swap.origTeacher,
    newTeacher: swap.newTeachers || swap.newTeacher,
    newLesson: swap.newLesson,
    swapType: swap.type,
    key: swap.key,
  }
}

export function gasCallsForPlan(plan: Plan, related: Plan[] = []): GasCall[] {
  if (plan.mode === "cover") {
    const group = arrangementPlans(plan, related)
    const rows = plansToSwaps(group)
    return [
      {
        kind: "cover",
        payload: {
          action: "writeSubstitute",
          date: plan.date,
          teacher: plan.teacher,
          reason: plan.reason,
          substitutes: rows.map((row) => ({ period: row.period, subTeacher: row.newTeacher })),
        },
      },
      {
        kind: "entries",
        payload: {
          action: "writeTempEntries",
          entries: rows.map(toEntry),
        },
      },
    ]
  }

  const legs = legsOf(plan)
  const sameClass = legs.length > 0 && legs.every((leg) => leg.className === legs[0].className)
  if (legs.length === 2 && sameClass) {
    const [first, second] = legs
    return [
      {
        kind: "swap",
        payload: {
          swaps: [
            {
              origDate: first.date,
              targetDate: second.date,
              period: first.period,
              className: first.className,
              origLesson: first.course,
              applicantTeacher: first.teachers?.[0] || first.teacher,
              partnerTeacher: second.teachers?.[0] || second.teacher,
              partnerPeriod: second.period,
              targetLesson: second.course,
            },
          ],
        },
      },
    ]
  }

  return [
    {
      kind: "entries",
      payload: {
        action: "writeTempEntries",
        entries: plansToSwaps([plan]).map(toEntry),
      },
    },
  ]
}
