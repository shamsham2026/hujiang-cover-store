"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Timeline } from "@/components/timeline"
import { TeacherPicker } from "@/components/teacher-picker"
import { useBoard } from "@/components/board-context"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { markSlots } from "@/lib/movement"
import { readHiddenKeys } from "@/lib/plans"
import { useSharedPlans } from "@/components/use-shared-plans"
import { CLASSES } from "@/lib/periods"
import { classSlots, dutySlots, formatLongDate, nextSchoolDay, plansToSwaps, teacherActivityHint, teacherSlots, withHidden } from "@/lib/schedule"
import type { ResolvedSlot } from "@/lib/types"

export function TimetableView() {
  const params = useSearchParams()
  const router = useRouter()
  const board = useBoard()
  const [date, setDate] = useState(params.get("date") || nextSchoolDay())
  const [className, setClassName] = useState(params.get("class") || "1A")
  const [teacher, setTeacher] = useState(params.get("teacher") || "曉")
  const { plans } = useSharedPlans()
  const [hidden, setHidden] = useState<string[]>([])
  useEffect(() => {
    setHidden(readHiddenKeys())
  }, [])

  const data = board.data ? withHidden(board.data, hidden) : null
  const view = useMemo(() => {
    if (!data) return null
    const extra = plansToSwaps(plans)
    const teacherDay = teacherSlots(data, date, teacher, extra)
    return {
      classSlots: markSlots(data, date, classSlots(data, date, className, extra)),
      teacher: {
        current: markSlots(data, date, teacherDay.current),
        away: markSlots(data, date, teacherDay.away),
      },
      duty: markSlots(data, date, dutySlots(data, date, extra)),
    }
  }, [data, date, className, teacher, plans])

  function openArrange(slot: ResolvedSlot) {
    const who = slot.baseTeachers?.[0] || slot.teachers?.[0] || ""
    const query = new URLSearchParams({ date, period: slot.period, teacher: who, class: slot.className })
    router.push(`/arrange?${query}`)
  }

  if (!data || !view) return <p className="text-sm text-muted-foreground">正在讀取課表…</p>

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl">課表</h1>
          <p className="text-sm text-muted-foreground">
            {formatLongDate(date)} ·{" "}
            <Link href={`/lookup?teacher=${teacher}&date=${date}`} className="text-primary">查老師一整週</Link>
            {" · "}
            <Link href={`/lookup?tab=free&date=${date}`} className="text-primary">查誰有空</Link>
          </p>
        </div>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">日期</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-10 rounded-lg border bg-card px-3" />
        </label>
      </div>
      <Tabs defaultValue={params.get("teacher") ? "teacher" : "class"}>
        <TabsList>
          <TabsTrigger value="class">班級</TabsTrigger>
          <TabsTrigger value="teacher">教師</TabsTrigger>
          <TabsTrigger value="duty">當值</TabsTrigger>
        </TabsList>
        <TabsContent value="class" className="space-y-3">
          <Select value={className} onValueChange={(value) => setClassName(value || "1A")}>
            <SelectTrigger className="h-10 w-full bg-card sm:w-48">
              <SelectValue placeholder="班別" />
            </SelectTrigger>
            <SelectContent>
              {CLASSES.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Timeline slots={view.classSlots} showEmpty onPick={(slot) => openArrange(slot)} />
        </TabsContent>
        <TabsContent value="teacher" className="space-y-3">
          <TeacherPicker teachers={data.teachers} value={teacher} onChange={setTeacher} />
          {teacherActivityHint(data, date, teacher, plansToSwaps(plans)) ? <p data-testid="activity-hint" className="text-sm text-muted-foreground">{teacherActivityHint(data, date, teacher, plansToSwaps(plans))}</p> : null}
          <Timeline slots={view.teacher.current} onPick={(slot) => openArrange(slot)} />
          {view.teacher.away.length > 0 ? (
            <div>
              <h2 className="mb-2 text-sm text-muted-foreground">這天已調走的原課堂</h2>
              <Timeline slots={view.teacher.away} />
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="duty">
          <Timeline slots={view.duty} onPick={(slot) => openArrange(slot)} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
