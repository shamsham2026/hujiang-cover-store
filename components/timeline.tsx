import { hideActivityRemarks } from "@/lib/duty-posts"
import { PERIODS, periodMeta } from "@/lib/periods"
import type { ResolvedSlot } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { cn } from "cn"

export function Timeline({
  slots,
  onPick,
  activeKey,
  showEmpty = false,
}: {
  slots: ResolvedSlot[]
  onPick?: (slot: ResolvedSlot) => void
  activeKey?: string
  showEmpty?: boolean
}) {
  const visible = hideActivityRemarks(slots)
  const byPeriod = new Map<string, ResolvedSlot[]>()
  for (const slot of visible) {
    const list = byPeriod.get(slot.period) || []
    list.push(slot)
    byPeriod.set(slot.period, list)
  }
  const periods = showEmpty
    ? PERIODS.map((period) => period.id).filter((id) => id !== "7:30" && id !== "7:45" || byPeriod.has(id))
    : [...byPeriod.keys()]

  if (!showEmpty && visible.length === 0) {
    return <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">這一天沒有對應的課堂或當值。</p>
  }

  return (
    <ol className="overflow-hidden rounded-2xl border bg-card">
      {periods.map((period) => {
        const meta = periodMeta(period)
        const rows = byPeriod.get(period) || []
        return (
          <li key={period} className="grid grid-cols-[5.5rem_1fr] border-b last:border-b-0 sm:grid-cols-[8.5rem_1fr]">
            <div className={cn("px-3 py-3 text-xs", meta.kind === "duty" ? "bg-secondary/70" : "bg-muted/40")}>
              <div className="font-medium text-foreground">{meta.label}</div>
              <div className="mt-1 text-muted-foreground">{meta.time}</div>
            </div>
            <div className="divide-y">
              {rows.length === 0 ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">空堂</div>
              ) : (
                rows.map((slot, index) => {
                  const key = `${slot.period}-${slot.className}-${slot.baseTeacher}-${slot.unitId}-${index}`
                  const active = activeKey === `${slot.period}|${slot.className}|${slot.baseTeacher}`
                  const names = slot.teachers?.length ? slot.teachers.join("、") : slot.teacher
                  const body = (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        {slot.className ? <span className="font-heading text-base">{slot.className}</span> : null}
                        <span className={cn("text-sm", slot.away && "line-through text-muted-foreground")}>{slot.empty ? "未編更" : slot.course}</span>
                        {slot.coTeach ? <Badge variant="secondary" data-testid="coteach">合教</Badge> : null}
                        {slot.externalProgramme ? <Badge data-testid="external-badge">校外導師</Badge> : null}
                        {slot.externalProgramme ? <span className="text-xs">{slot.externalProgramme}</span> : null}
                        {slot.fixed ? <Badge variant="destructive" data-testid="fixed-lesson">不可調</Badge> : null}
                        {slot.change ? <Badge variant={slot.change.includes("代") ? "secondary" : "outline"}>{slot.change}</Badge> : null}
                        {slot.away ? <Badge variant="destructive">已調走</Badge> : null}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {slot.empty ? "可另外安排這一時段" : names}
                        {slot.change && slot.baseTeacher && slot.baseTeacher !== slot.teacher ? ` · 原任 ${slot.baseTeachers?.join("、") || slot.baseTeacher}` : ""}
                        {slot.change && slot.baseCourse !== slot.course ? ` · 原課堂 ${slot.baseCourse}` : ""}
                      </div>
                    </>
                  )
                  return onPick ? (
                    <button
                      key={key}
                      type="button"
                      data-testid="timetable-slot"
                      data-period={slot.period}
                      data-class={slot.className}
                      data-teachers={names}
                      onClick={() => onPick(slot)}
                      className={cn("w-full px-3 py-3 text-left hover:bg-accent", active && "bg-accent")}
                    >
                      {body}
                    </button>
                  ) : (
                    <div key={key} className="px-3 py-3">
                      {body}
                    </div>
                  )
                })
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
