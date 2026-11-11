import { useCallback, useEffect, useRef, useState } from 'react'
import type { JobProgress, JobRequest } from '../../shared/types'
import type { FilesApi } from './useFiles'

export function useJob(files: FilesApi) {
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<JobProgress | null>(null)
  const idRef = useRef<string | null>(null)
  // Синхронная защита от двойного клика: running обновится только после ответа main-процесса.
  const starting = useRef(false)
  const { cancelQueued } = files

  useEffect(() => {
    const off1 = window.pdf.onJobProgress((p) => {
      if (p.jobId !== idRef.current) return
      setProgress(p)
      if (p.finished) {
        idRef.current = null
        setJobId(null)
        if (p.cancelled) cancelQueued()
      }
    })
    const off2 = window.pdf.onJobCancelled((id) => {
      if (id === idRef.current) cancelQueued()
    })
    return () => {
      off1()
      off2()
    }
  }, [cancelQueued])

  const start = useCallback(
    async (req: JobRequest) => {
      if (starting.current || idRef.current) return
      starting.current = true
      try {
        files.resetForRun(req.files.map((f) => f.id))
        setProgress({ jobId: '', done: 0, total: req.kind === 'merge' ? 1 : req.files.length, fraction: 0, finished: false })
        const id = await window.pdf.startJob(req)
        idRef.current = id
        setJobId(id)
      } catch (e) {
        setProgress(null)
        throw e
      } finally {
        starting.current = false
      }
    },
    [files]
  )

  const cancel = useCallback(() => {
    if (idRef.current) void window.pdf.cancelJob(idRef.current)
  }, [])

  const dismiss = useCallback(() => setProgress(null), [])

  return { running: jobId !== null, progress, start, cancel, dismiss }
}
