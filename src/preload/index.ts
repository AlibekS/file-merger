import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { PdfApi } from '../shared/types'

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const handler = (_e: unknown, v: T): void => cb(v)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: PdfApi = {
  tools: () => ipcRenderer.invoke('app:tools'),
  pickFiles: () => ipcRenderer.invoke('dialog:files'),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  resolvePaths: (paths) => ipcRenderer.invoke('files:resolve', paths),
  inspect: (files) => ipcRenderer.invoke('files:inspect', files),
  onInfo: (cb) => subscribe('files:info', cb),
  sample: (files) => ipcRenderer.invoke('files:sample', files),
  onRatios: (cb) => subscribe('files:ratios', cb),
  startJob: (job) => ipcRenderer.invoke('job:start', job),
  cancelJob: (id) => ipcRenderer.invoke('job:cancel', id),
  onFileProgress: (cb) => subscribe('job:file', cb),
  onJobProgress: (cb) => subscribe('job:progress', cb),
  onJobCancelled: (cb) => subscribe('job:cancelled', cb),
  showInFolder: (p) => ipcRenderer.invoke('shell:show', p),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  setAppearance: (opts) => ipcRenderer.invoke('app:appearance', opts),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  fileUrl: (path) => `pdfstudio://file/${encodeURIComponent(path)}`
}

contextBridge.exposeInMainWorld('pdf', api)
