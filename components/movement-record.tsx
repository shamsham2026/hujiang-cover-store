import { calendarObservationNote, fixedCause, fixedOn, swappedOn } from "@/lib/movement"
import { periodLabel } from "@/lib/periods"
import type { SchoolData, Swap } from "@/lib/types"

export function MovementRecord({ data, date, extra = [] }: { data: SchoolData; date: string; extra?: Swap[] }) {
  const swapped = swappedOn(data, date, extra)
  const fixed = fixedOn(data, date, extra)
  const note = calendarObservationNote(data, date)
  return (
    <section data-testid="movement-record" className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border bg-card px-3 py-3">
        <h2 className="font-heading text-lg">已調換</h2>
        {swapped.length === 0 ? null : (
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
            {swapped.map((row) => (
              <li key={row.key || `${row.className}-${row.period}-${row.to}`}>
                {row.className} {periodLabel(row.period)} {row.from} → {row.to} {row.course}
                {row.type ? `（${row.type}）` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-xl border bg-card px-3 py-3">
        <h2 className="font-heading text-lg">不可調</h2>
        {fixed.length === 0 && !note ? null : (
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
            {note ? <li data-testid="observation-note">{note}</li> : null}
            {fixed.map((row) => (
              <li key={`${row.className}-${row.period}`} data-testid="fixed-lesson">
                {row.className} {periodLabel(row.period)} {row.course}（{fixedCause(row.reason)}）
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
