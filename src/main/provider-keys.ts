import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { DelegateAvailability, DelegateProvider } from '../shared/events'

/**
 * Encrypted-at-rest storage for non-Claude provider API keys.
 *
 * Keys are encrypted with Electron `safeStorage` (OS keychain on macOS, DPAPI on Windows) and
 * written as base64 to `provider-keys.json` in userData — deliberately a SEPARATE file from
 * config.json so a key can never leak into the plaintext settings the rest of the app reads/writes.
 * Raw keys never cross IPC to the renderer; only `availability()` (booleans) and the encrypted
 * blob ever leave this module's plaintext, and the blob is only ever decrypted here in main for an
 * outbound provider call.
 */

const PROVIDERS: DelegateProvider[] = ['openai', 'gemini', 'composer']

type Store = Partial<Record<DelegateProvider, string>> // provider -> base64(ciphertext)

function keysPath(): string {
  return path.join(app.getPath('userData'), 'provider-keys.json')
}

function readStore(): Store {
  try {
    const raw = fs.readFileSync(keysPath(), 'utf8')
    const o = JSON.parse(raw)
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}

function writeStore(store: Store): boolean {
  try {
    fs.writeFileSync(keysPath(), JSON.stringify(store, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

function isProvider(p: string): p is DelegateProvider {
  return (PROVIDERS as string[]).includes(p)
}

export interface KeyOpResult {
  ok: boolean
  error?: string
}

/** Encrypt + persist a provider key. Refuses (never writes plaintext) if OS encryption is unavailable. */
export function setKey(provider: string, key: string): KeyOpResult {
  if (!isProvider(provider)) return { ok: false, error: 'unknown provider' }
  const trimmed = (key ?? '').trim()
  if (!trimmed) return clearKey(provider) // empty key = clear
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'OS secure storage is unavailable on this machine; key not saved.' }
  }
  const store = readStore()
  try {
    store[provider] = safeStorage.encryptString(trimmed).toString('base64')
  } catch {
    return { ok: false, error: 'failed to encrypt key' }
  }
  return writeStore(store) ? { ok: true } : { ok: false, error: 'failed to write key store' }
}

/** Remove a stored provider key. */
export function clearKey(provider: string): KeyOpResult {
  if (!isProvider(provider)) return { ok: false, error: 'unknown provider' }
  const store = readStore()
  if (store[provider] === undefined) return { ok: true }
  delete store[provider]
  return writeStore(store) ? { ok: true } : { ok: false, error: 'failed to write key store' }
}

/** Decrypt + return a provider key for an outbound call (main process only), or null if unset/undecryptable. */
export function getKey(provider: DelegateProvider): string | null {
  const enc = readStore()[provider]
  if (!enc) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64')) || null
  } catch {
    return null
  }
}

/** Which providers currently have a (decryptable) key stored — booleans only, safe to send to the renderer. */
export function availability(): DelegateAvailability {
  const store = readStore()
  const encOk = safeStorage.isEncryptionAvailable()
  const has = (p: DelegateProvider): boolean => encOk && !!store[p]
  return { openai: has('openai'), gemini: has('gemini'), composer: has('composer') }
}
