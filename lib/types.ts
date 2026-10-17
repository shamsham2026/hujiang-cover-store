export type Lesson = {
  className: string
  day: string
  period: string
  course: string
  teacher: string
}

export type Swap = {
  date: string
  day: string
  period: string
  className: string
  origTeacher: string
  newTeacher: string
  newTeachers?: string
  newLesson: string
  type: string
  key: string
  status?: string
}

export type RecordRow = {
  date: string
  period: string
  absent: string
  cover: string
  kind: string
  count: string
}

export type Teacher = {
  full: string
  short: string
}

export type LockedLesson = {
  programme: string
  className: string
  lessonNo: string
  term: string
  weekday: string
  slot: string
  dateLabel: string
}

export type CalendarExam = {
  /** 空陣列代表全年級。 */
  grades: number[]
  label: string
  /** 有寫明就只佔這些節。中作考試是第 7、8、9 節。 */
  periods?: string[]
}

export type CalendarDay = {
  date: string
  holiday: boolean
  halfDay: boolean
  items: string[]
  exams: CalendarExam[]
}

export type SchoolData = {
  school: string
  year: string
  source: string
  teachers: Teacher[]
  lessons: Lesson[]
  swaps: Swap[]
  records: RecordRow[]
  locked: LockedLesson[]
  calendar?: CalendarDay[]
}

export type PlanMode = "cover" | "swap"

export type PlanLeg = {
  date: string
  period: string
  toDate: string
  toPeriod: string
  className: string
  classes?: string[]
  course: string
  teacher: string
  teachers: string[]
}

export type Plan = {
  id: string
  mode: PlanMode
  date: string
  targetDate: string
  period: string
  className: string
  course: string
  teacher: string
  teachers?: string[]
  partnerTeacher: string
  partnerTeachers?: string[]
  partnerPeriod: string
  partnerCourse: string
  reason: string
  tier?: string
  duty?: boolean
  legs?: PlanLeg[]
}

export type ResolvedSlot = {
  period: string
  className: string
  course: string
  teacher: string
  teachers: string[]
  baseCourse: string
  baseTeacher: string
  baseTeachers: string[]
  change: string
  away?: boolean
  duty?: boolean
  coTeach?: boolean
  location?: string
  unitId?: string
  empty?: boolean
  externalProgramme?: string
  remark?: boolean
  fixed?: string
}
