import * as XLSX from "xlsx"
import { parseCalendar } from "@/lib/calendar"
import type { Lesson, LockedLesson, RecordRow, SchoolData, Swap, Teacher } from "@/lib/types"

const SHEET_ID = "1pfui330JBwmCFG-e9am7cBjPdfD-A1pMt4_cNgtrsek"

export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`

function text(value: unknown) {
  if (value == null) return ""
  return String(value).trim()
}

function period(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value))
  const raw = text(value)
  return raw.endsWith(".0") && /^\d+\.0$/.test(raw) ? raw.slice(0, -2) : raw
}

function isoDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const shifted = new Date(value.getTime() + 8 * 60 * 60 * 1000)
    return shifted.toISOString().slice(0, 10)
  }
  if (typeof value === "number" && value > 20000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + value * 86400000)
    return utc.toISOString().slice(0, 10)
  }
  const raw = text(value)
  const match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`
  }
  return raw.slice(0, 10)
}

function slotLabel(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const shifted = new Date(value.getTime() + 8 * 60 * 60 * 1000)
    return `${shifted.getUTCMonth() + 1}-${shifted.getUTCDate()}`
  }
  if (typeof value === "number" && value > 20000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + value * 86400000)
    return `${utc.getUTCMonth() + 1}-${utc.getUTCDate()}`
  }
  return text(value)
}

function rowsOf(book: XLSX.WorkBook, name: string) {
  const sheet = book.Sheets[name]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true })
}

export function parseWorkbook(buffer: Buffer): SchoolData {
  const book = XLSX.read(buffer, { type: "buffer", cellDates: true })
  const lessons: Lesson[] = []
  for (const row of rowsOf(book, "排課資料庫").slice(1)) {
    const day = text(row[1])
    const course = text(row[3])
    if (!day && !course) continue
    lessons.push({
      className: text(row[0]),
      day,
      period: period(row[2]),
      course,
      teacher: text(row[4]),
    })
  }

  const swaps: Swap[] = []
  for (const row of rowsOf(book, "調課暫存").slice(1)) {
    if (!row[0]) continue
    swaps.push({
      date: isoDate(row[0]),
      day: text(row[1]),
      period: period(row[2]),
      className: text(row[3]),
      origTeacher: text(row[4]),
      newTeacher: text(row[5]),
      newLesson: text(row[6]),
      type: text(row[7]),
      key: text(row[8]),
      status: text(row[9]),
    })
  }

  const records: RecordRow[] = []
  for (const row of rowsOf(book, "總紀錄表").slice(1)) {
    if (!row[0]) continue
    records.push({
      date: isoDate(row[0]),
      period: period(row[1]),
      absent: text(row[2]),
      cover: text(row[3]),
      kind: text(row[4]),
      count: text(row[5]),
    })
  }

  const teachers: Teacher[] = []
  for (const row of rowsOf(book, "代課請假時數紀錄表").slice(1, 80)) {
    const raw = text(row[0])
    if (!raw && !text(row[1])) continue
    const named = raw.match(/^(.+?)\((.+)\)$/)
    teachers.push({
      full: named?.[1] || raw,
      short: named?.[2] || text(row[1]) || raw,
    })
  }

  const locked: LockedLesson[] = []
  for (const row of rowsOf(book, "校外導師不可調動").slice(3)) {
    if (!text(row[0])) continue
    locked.push({
      programme: text(row[0]),
      className: text(row[1]),
      lessonNo: text(row[2]),
      term: text(row[3]),
      weekday: text(row[4]),
      slot: slotLabel(row[5]),
      dateLabel: text(row[6]),
    })
  }

  const calendar = parseCalendar([
    { term: "上", rows: rowsOf(book, "上學期教師行事曆") },
    { term: "下", rows: rowsOf(book, "下學期教師行事曆") },
  ])

  return {
    school: "滬江小學",
    year: "2026/27",
    source: SHEET_URL,
    teachers,
    lessons,
    swaps,
    records,
    locked,
    calendar,
  }
}
