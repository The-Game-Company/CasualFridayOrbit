/// <reference types="vite/client" />
import type { OrbitApi } from '../../preload/index'

declare global {
  interface Window {
    orbit: OrbitApi
  }
}

export {}
