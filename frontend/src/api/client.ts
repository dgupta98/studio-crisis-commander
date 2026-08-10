export class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`API ${status}: ${body.slice(0, 200)}`)
    this.name = 'ApiError'
  }
}

const BASE = (): string => {
  const url = import.meta.env.VITE_API_URL
  if (!url) throw new Error('VITE_API_URL is not set')
  return url.replace(/\/$/, '')
}

async function _handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch((readErr: unknown) =>
      `(body unreadable: ${(readErr as Error).message})`
    )
    throw new ApiError(res.status, body)
  }
  return res.json() as Promise<T>
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, { ...init, method: 'GET' })
  return _handle<T>(res)
}

export async function apiPost<T>(
  path: string, body: unknown, init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, {
    ...init,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    body: JSON.stringify(body ?? {}),
  })
  return _handle<T>(res)
}
