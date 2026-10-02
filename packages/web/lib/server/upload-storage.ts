import { MAX_UPLOAD_FILE_BYTES } from "@/lib/upload-limits"

function config() {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "")
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) throw new Error("File uploads are not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.")
  const url = new URL(base)
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co") || url.pathname !== "/") throw new Error("SUPABASE_URL must be the project's https://PROJECT.supabase.co URL")
  return { base: `${base}/storage/v1`, key, bucket: process.env.SUPABASE_UPLOAD_BUCKET || "switchboard-files" }
}

function objectEndpoint(path: string) {
  const { bucket } = config()
  return [bucket, ...path.split("/")].map(encodeURIComponent).join("/")
}

async function request(endpoint: string, init: RequestInit = {}) {
  const { base, key } = config()
  const response = await fetch(`${base}/${endpoint}`, {
    ...init, cache: "no-store", signal: AbortSignal.timeout(120_000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers },
  })
  // Storage responses can include object paths or credentials; expose only status.
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`File storage request failed (HTTP ${response.status})`)
  }
  return response
}

export async function signedUploadUrl(path: string): Promise<string> {
  const { base, bucket } = config()
  const details = await (await request(`bucket/${encodeURIComponent(bucket)}`)).json() as { public?: boolean; file_size_limit?: number }
  if (details.public !== false || Number(details.file_size_limit) !== MAX_UPLOAD_FILE_BYTES) throw new Error("The upload bucket must be private with a 25 MB file limit. Run scripts/setup-upload-storage.mjs.")
  const response = await request(`object/upload/sign/${objectEndpoint(path)}`, { method: "POST", body: "{}" })
  const data = await response.json() as { url: string }
  const url = new URL(base + data.url)
  if (url.origin !== new URL(base).origin || !url.searchParams.get("token")) throw new Error("Storage returned an invalid upload URL")
  return url.toString()
}

export async function signedDownloadUrl(path: string, name: string): Promise<string> {
  const { base } = config()
  const response = await request(`object/sign/${objectEndpoint(path)}`, { method: "POST", body: JSON.stringify({ expiresIn: 60 }) })
  const data = await response.json() as { signedURL: string }
  const url = new URL(base + data.signedURL)
  if (url.origin !== new URL(base).origin) throw new Error("Storage returned an invalid download URL")
  url.searchParams.set("download", name)
  return url.toString()
}

export async function verifyStoredSize(path: string, declaredSize: number): Promise<void> {
  const response = await request(`object/${objectEndpoint(path)}`, { method: "HEAD" })
  const raw = response.headers.get("content-length")
  const actual = raw === null ? NaN : Number(raw)
  if (!Number.isSafeInteger(actual) || actual < 0 || actual > MAX_UPLOAD_FILE_BYTES || actual !== declaredSize) {
    throw new Error("Uploaded file size does not match its declared size or exceeds 25 MB")
  }
}

export async function downloadStoredFile(path: string, declaredSize: number): Promise<Buffer> {
  await verifyStoredSize(path, declaredSize)
  const response = await request(`object/${objectEndpoint(path)}`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Uploaded file has no body")
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > declaredSize || bytes > MAX_UPLOAD_FILE_BYTES) throw new Error("Uploaded file exceeds its declared size or 25 MB")
      chunks.push(value)
    }
    if (bytes !== declaredSize) throw new Error("Uploaded file is incomplete")
    return Buffer.concat(chunks, bytes)
  } finally {
    await reader.cancel().catch(() => {})
  }
}

export async function deleteStoredFiles(paths: string[]): Promise<void> {
  if (!paths.length) return
  const { bucket } = config()
  await request(`object/${encodeURIComponent(bucket)}`, { method: "DELETE", body: JSON.stringify({ prefixes: paths }) })
}
