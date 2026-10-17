"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CalendarDays, ChartColumn, ClipboardList, LayoutGrid, Printer, RefreshCw, ArrowLeftRight, Search } from "lucide-react"
import { BoardProvider, useBoard } from "@/components/board-context"
import { Button } from "@/components/ui/button"
import { cn } from "cn"

const LINKS = [
  { href: "/", label: "今日", icon: LayoutGrid },
  { href: "/timetable", label: "課表", icon: CalendarDays },
  { href: "/lookup", label: "查找", icon: Search },
  { href: "/arrange", label: "安排", icon: ArrowLeftRight },
  { href: "/records", label: "紀錄", icon: ClipboardList },
  { href: "/stats", label: "統計", icon: ChartColumn },
  { href: "/slip", label: "調課紙", icon: Printer },
]

function Frame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const board = useBoard()
  return (
    <div className="min-h-screen overflow-x-hidden">
      <header className="no-print border-b border-border/80 bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-2 py-2 min-[380px]:gap-3 min-[380px]:px-4">
          <Link href="/" data-testid="site-title" className="text-[14px] leading-snug text-foreground min-[380px]:text-[16px]">
            <span className="block whitespace-nowrap">滬江小學 調課 / 代課</span>
          </Link>
          <nav className="order-3 hidden w-full items-center gap-1 overflow-x-auto md:order-none md:ml-2 md:flex md:w-auto md:flex-1">
            {LINKS.map((link) => {
              const active = pathname === link.href
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm",
                    active ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-muted"
                  )}
                >
                  {link.label}
                </Link>
              )
            })}
          </nav>
          <Button variant="outline" className="ml-auto min-h-11 shrink-0" onClick={board.refresh} disabled={board.loading}>
            <RefreshCw className={cn(board.loading && "animate-spin")} />
            更新
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-[1600px] px-2 py-4 pb-24 min-[380px]:px-4 md:pb-8">{children}</main>
      <nav className="no-print fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur md:hidden">
        <div className="grid grid-cols-7 pb-[env(safe-area-inset-bottom)]">
          {LINKS.map((link) => {
            const active = pathname === link.href
            const Icon = link.icon
            return (
              <Link key={link.href} href={link.href} className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 py-1 text-[11px]", active ? "text-primary" : "text-muted-foreground")}>
                <Icon className="size-5" />
                {link.label}
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <BoardProvider>
      <Frame>{children}</Frame>
    </BoardProvider>
  )
}
