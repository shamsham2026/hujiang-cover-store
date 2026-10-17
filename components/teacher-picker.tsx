"use client"

import { useMemo, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Teacher } from "@/lib/types"

export function TeacherPicker({
  teachers,
  value,
  onChange,
  placeholder = "選擇老師",
}: {
  teachers: Teacher[]
  value: string
  onChange: (short: string) => void
  placeholder?: string
}) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const selected = teachers.find((teacher) => teacher.short === value)
  const filtered = useMemo(() => {
    const needle = query.trim()
    if (!needle) return teachers
    return teachers.filter((teacher) => teacher.short.includes(needle) || teacher.full.includes(needle))
  }, [query, teachers])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" className="h-11 w-full justify-between bg-card px-3 text-base" />}>
        <span className={selected ? "text-foreground" : "text-muted-foreground"}>
          {selected ? `${selected.short} ${selected.full}` : placeholder}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-3" align="start">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="簡稱或姓名" className="h-11 text-base" />
        <div className="mt-2 grid max-h-72 grid-cols-3 gap-1 overflow-auto">
          {filtered.map((teacher) => (
            <button
              key={teacher.short}
              type="button"
              className={`min-h-11 rounded-md px-2 py-2 text-left text-sm hover:bg-muted ${teacher.short === value ? "bg-primary text-primary-foreground" : ""}`}
              onClick={() => {
                onChange(teacher.short)
                setOpen(false)
              }}
            >
              <span className="block font-medium">{teacher.short}</span>
              <span className="block truncate text-[11px] opacity-75">{teacher.full}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
