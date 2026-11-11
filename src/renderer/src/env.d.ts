/// <reference types="vite/client" />
import type { PdfApi } from '../../shared/types'

declare global {
  interface Window {
    pdf: PdfApi
  }
}
