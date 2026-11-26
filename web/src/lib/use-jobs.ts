// The household's queued uploads for the Processing list (plan §13 item 5). Ids and status only.
import { useCallback, useEffect, useRef, useState } from "react"

import { api, type Job } from "@/lib/api"

/**
 * The household's jobs, refreshed while any is open (every 5–10 s). Calls `onFinished` when one finishes, so the
 * page can reload its members.
 */
export function useJobs(onFinished: () => void) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [tick, setTick] = useState(0)
  const finished = useRef(onFinished)
  useEffect(() => {
    finished.current = onFinished
  })
  const openIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    api.jobs().then(
      (list) => {
        if (stop) return
        setJobs(list)
        const open = new Set(list.filter((j) => j.status === "queued" || j.status === "parsing").map((j) => j.id))
        if ([...openIds.current].some((id) => !open.has(id))) finished.current()
        openIds.current = open
        if (open.size) {
          const eta = Math.min(...list.filter((j) => open.has(j.id)).map((j) => j.eta_s ?? 10))
          timer = setTimeout(() => setTick((t) => t + 1), Math.min(10, Math.max(5, eta / 3)) * 1000)
        }
      },
      () => undefined, // the list is a convenience; Members still loads
    )
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [tick])

  const refresh = useCallback(() => setTick((t) => t + 1), [])
  return { jobs, refresh }
}
