export type VenueOccupant = {
  className: string
  classes?: string[]
  course: string
}

type VenueRule = {
  id: string
  label: string
  room: string
  cap: number
  match: (course: string, className: string) => boolean
}

function gradeOf(className: string) {
  const match = className.match(/([1-6])/)
  return match ? Number(match[1]) : null
}

function classNamesOf(row: VenueOccupant) {
  if (row.classes && row.classes.length > 0) return row.classes
  return row.className ? [row.className] : []
}

export const VENUE_RULES: VenueRule[] = [
  {
    id: "pe",
    label: "體育",
    room: "體育場",
    cap: 2,
    match: (course) => course.includes("體育"),
  },
  {
    id: "ict",
    label: "電腦",
    room: "電腦室",
    cap: 1,
    match: (course) => course.includes("電腦"),
  },
  {
    id: "va",
    label: "視藝",
    room: "視藝室",
    cap: 1,
    match: (course, className) => course.includes("視藝") && (gradeOf(className) ?? 0) >= 4,
  },
  {
    id: "music-upper",
    label: "音樂",
    room: "408室",
    cap: 1,
    match: (course, className) => course.includes("音樂") && (gradeOf(className) ?? 0) >= 4,
  },
  {
    id: "music-lower",
    label: "音樂",
    room: "音樂室",
    cap: 1,
    match: (course, className) => course.includes("音樂") && (gradeOf(className) ?? 99) <= 3,
  },
  {
    id: "reading",
    label: "英閱",
    room: "英語室",
    cap: 1,
    match: (course) => course.includes("英閱"),
  },
]

function matchingClasses(rows: VenueOccupant[], rule: VenueRule) {
  const names = new Set<string>()
  for (const row of rows) {
    for (const className of classNamesOf(row)) {
      if (rule.match(row.course, className)) names.add(className)
    }
  }
  return names
}

/**
 * 調動之後才數人數。同一班對調如果沒有令該場地的班數增加，就不算超額。
 */
export function venueMoveWarning(args: {
  occupants: VenueOccupant[]
  incoming: VenueOccupant | null
  outgoing: VenueOccupant | null
}) {
  const warnings: string[] = []
  for (const rule of VENUE_RULES) {
    const before = matchingClasses(args.occupants, rule)
    const after = new Set(before)
    if (args.outgoing) {
      for (const className of classNamesOf(args.outgoing)) {
        if (rule.match(args.outgoing.course, className)) after.delete(className)
      }
    }
    if (args.incoming) {
      for (const className of classNamesOf(args.incoming)) {
        if (rule.match(args.incoming.course, className)) after.add(className)
      }
    }
    if (after.size > rule.cap && after.size > before.size) {
      warnings.push(`${rule.label}（${rule.room}）這節最多 ${rule.cap} 班，調入後會有 ${after.size} 班。`)
    }
  }
  return warnings
}
