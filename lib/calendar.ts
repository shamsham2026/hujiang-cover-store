import type { CalendarDay, CalendarExam } from "@/lib/types"

const MONTHS: Record<string, number> = {
  一月: 1,
  二月: 2,
  三月: 3,
  四月: 4,
  五月: 5,
  六月: 6,
  七月: 7,
  八月: 8,
  九月: 9,
  十月: 10,
  十一月: 11,
  十二月: 12,
}

const WEEKDAY_NOTE: Record<number, { column: number; label: string }> = {
  2: { column: 12, label: "德育成長課" },
  3: { column: 13, label: "週三活動" },
  5: { column: 14, label: "星期五活動" },
}

function cell(row: unknown[], index: number) {
  return String(row[index] ?? "")
    .replace(/\r/g, "")
    .trim()
}

function iso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function yearForMention(rowYear: number, rowMonth: number, mentionMonth: number) {
  if (rowMonth >= 11 && mentionMonth <= 2) return rowYear + 1
  if (rowMonth <= 2 && mentionMonth >= 11) return rowYear - 1
  return rowYear
}

function stamp(year: number, month: number, day: number) {
  return month * 40 + day + year * 500
}

function datesInFragment(fragment: string, rowYear: number, rowMonth: number) {
  const found: string[] = []
  const pattern = /(\d{1,2})\/(\d{1,2})(?:\s*[-–~至]\s*(\d{1,2})\/(\d{1,2}))?/g
  for (const match of fragment.matchAll(pattern)) {
    const startDay = Number(match[1])
    const startMonth = Number(match[2])
    const startYear = yearForMention(rowYear, rowMonth, startMonth)
    if (!match[3]) {
      found.push(iso(startYear, startMonth, startDay))
      continue
    }
    const endDay = Number(match[3])
    const endMonth = Number(match[4])
    const endYear = yearForMention(startYear, startMonth, endMonth)
    const start = stamp(startYear, startMonth, startDay)
    const end = stamp(endYear, endMonth, endDay)
    const cursor = new Date(startYear, startMonth - 1, startDay)
    const last = new Date(endYear, endMonth - 1, endDay)
    if (start > end) continue
    while (cursor <= last && found.length < 40) {
      found.push(iso(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()))
      cursor.setDate(cursor.getDate() + 1)
    }
  }
  return found
}

function fragments(text: string) {
  return text
    .split(/\n+|\s+\/\s+|；|;/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
}

function meaningful(text: string) {
  if (!text || /^\d+$/.test(text)) return false
  return /[\u4e00-\u9fff]/.test(text) || /半日|放假|假期|考試/.test(text)
}

function isHoliday(text: string) {
  return /假期|放假/.test(text) && !/考試|期考|呈分試/.test(text)
}

function parseGrades(text: string) {
  const grades = new Set<number>()
  const range = /P\.?\s*([1-6])\s*[-–~至]\s*P?\.?\s*([1-6])/g
  for (const match of text.matchAll(range)) {
    const start = Number(match[1])
    const end = Number(match[2])
    for (let grade = Math.min(start, end); grade <= Math.max(start, end); grade += 1) grades.add(grade)
  }
  const rest = text.replace(range, " ")
  for (const match of rest.matchAll(/P\.?\s*([1-6])/g)) grades.add(Number(match[1]))
  return [...grades].sort()
}

/** 中作考試、小考、期考、呈分試、提前試。這些日子不是週三活動。 */
export function parseExams(text: string): CalendarExam[] {
  const cleaned = text
    .replace(/\d{1,2}\/\d{1,2}(?:\s*[-–~至]\s*\d{1,2}\/\d{1,2})?(?:\s*\([^)]*\))?/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  const clauses = cleaned.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
  const exams: CalendarExam[] = []
  for (const clause of clauses.length ? clauses : [cleaned]) {
    if (/準備|班主任/.test(clause)) continue
    const match = clause.match(/(中作考試|提前試|呈分試|期考|小考|考試)$/)
    if (!match) continue
    const grades = parseGrades(clause)
    const periods = match[1] === "中作考試" ? ["7", "8", "9"] : undefined
    exams.push({ grades, label: match[1], periods })
  }
  return exams
}

function examKey(exam: CalendarExam) {
  return `${exam.label}:${exam.grades.join(",") || "*"}`
}

function pushItem(bucket: Map<string, CalendarDay>, date: string, item: string, exams: CalendarExam[] = []) {
  if (!item && exams.length === 0) return
  const current = bucket.get(date) || { date, holiday: false, halfDay: false, items: [], exams: [] }
  if (item && !current.items.includes(item)) current.items.push(item)
  if (isHoliday(item)) current.holiday = true
  if (/半日/.test(item)) current.halfDay = true
  for (const exam of exams) {
    if (!current.exams.some((item) => examKey(item) === examKey(exam))) current.exams.push(exam)
  }
  bucket.set(date, current)
}

function coveredPeriods(exam: CalendarExam) {
  if (exam.periods?.length) return exam.periods
  if (exam.label === "中作考試") return ["7", "8", "9"]
  return null
}

export function examForClass(day: CalendarDay | null | undefined, className: string, period = "") {
  if (!day?.exams.length) return ""
  const grade = Number(className[0])
  if (!grade) return ""
  const matches = day.exams.filter((exam) => {
    if (exam.grades.length > 0 && !exam.grades.includes(grade)) return false
    const periods = coveredPeriods(exam)
    if (period && periods && !periods.includes(period)) return false
    return true
  })
  return matches.find((exam) => exam.label !== "考試")?.label || matches[0]?.label || ""
}

export function compositionDay(day: CalendarDay | null | undefined) {
  return Boolean(day?.exams.some((exam) => exam.label === "中作考試"))
}

/** 讀上、下學期教師行事曆。日期格式是日/月。只有提到該日的事項才放上那一天。 */
export function parseCalendar(sheets: { term: "上" | "下"; rows: unknown[][] }[]): CalendarDay[] {
  const bucket = new Map<string, CalendarDay>()

  for (const sheet of sheets) {
    let year = sheet.term === "上" ? 2026 : 2027
    let month = 0
    for (const row of sheet.rows) {
      const monthName = cell(row, 0)
      if (MONTHS[monthName]) {
        const next = MONTHS[monthName]
        if (month && next < month) year += 1
        month = next
      }
      if (!month) continue
      const dayNumbers = [3, 4, 5, 6, 7, 8, 9].map((index) => Number(cell(row, index)))
      if (!dayNumbers.some((day) => day > 0 && day <= 31)) continue

      let cursorMonth = month
      let cursorYear = year
      let previous = 0
      const weekDates: string[] = []
      for (const day of dayNumbers) {
        if (!(day > 0 && day <= 31)) {
          weekDates.push("")
          continue
        }
        if (previous && day < previous) {
          cursorMonth += 1
          if (cursorMonth === 13) {
            cursorMonth = 1
            cursorYear += 1
          }
        }
        previous = day
        weekDates.push(iso(cursorYear, cursorMonth, day))
      }

      const rowMonth = month
      const rowYear = year
      for (const source of [cell(row, 10), cell(row, 11)]) {
        for (const fragment of fragments(source)) {
          const exams = parseExams(fragment)
          for (const date of datesInFragment(fragment, rowYear, rowMonth)) {
            pushItem(bucket, date, fragment, exams)
          }
        }
      }

      weekDates.forEach((date, index) => {
        if (!date) return
        const note = WEEKDAY_NOTE[index]
        if (!note) return
        for (const fragment of fragments(cell(row, note.column))) {
          const exams = parseExams(fragment)
          if (exams.length) {
            pushItem(bucket, date, exams.length === 1 && exams[0].grades.length === 0 ? exams[0].label : fragment, exams)
            continue
          }
          if (!meaningful(fragment)) continue
          const item = fragment === "半天上學" || fragment === "放假" ? fragment : `${note.label}：${fragment}`
          pushItem(bucket, date, item)
        }
      })
    }
  }

  return [...bucket.values()].sort((left, right) => left.date.localeCompare(right.date))
}

export function calendarOn(days: CalendarDay[] | undefined, date: string) {
  return days?.find((day) => day.date === date) || null
}
