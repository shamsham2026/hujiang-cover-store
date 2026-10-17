"use client"

import { createContext, useContext, useEffect, useState } from "react"
import type { SchoolData } from "@/lib/types"

type BoardState = {
  data: SchoolData | null
  source: "live" | "seed" | null
  warning: string | null
  fetchedAt: string | null
  loading: boolean
  refresh: () => void
}

const BoardContext = createContext<BoardState>({
  data: null,
  source: null,
  warning: null,
  fetchedAt: null,
  loading: true,
  refresh: () => {},
})

export function BoardProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<BoardState, "refresh">>({
    data: null,
    source: null,
    warning: null,
    fetchedAt: null,
    loading: true,
  })

  async function load(refresh = false) {
    setState((current) => ({ ...current, loading: current.data == null }))
    const response = await fetch(refresh ? "/api/board?refresh=1" : "/api/board")
    const body = (await response.json()) as {
      data: SchoolData
      source: "live" | "seed"
      warning: string | null
      fetchedAt: string
    }
    setState({
      data: body.data,
      source: body.source,
      warning: body.warning,
      fetchedAt: body.fetchedAt,
      loading: false,
    })
  }

  useEffect(() => {
    let cancelled = false
    fetch("/api/board")
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return
        setState({
          data: body.data,
          source: body.source,
          warning: body.warning,
          fetchedAt: body.fetchedAt,
          loading: false,
        })
      })
      .catch(() => {
        if (!cancelled) setState((current) => ({ ...current, loading: false, warning: "課表暫時讀不到。" }))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return <BoardContext.Provider value={{ ...state, refresh: () => void load(true) }}>{children}</BoardContext.Provider>
}

export function useBoard() {
  return useContext(BoardContext)
}
