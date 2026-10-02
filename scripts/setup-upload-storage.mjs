/** Run from the repo root: node scripts/setup-upload-storage.mjs */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'packages/web/package.json'))
const { parse } = require('dotenv')
const config = { ...process.env }
for (const relative of ['.env', 'packages/web/.env', 'packages/web/.env.local']) {
  const file = path.join(root, relative)
  if (existsSync(file)) Object.assign(config, parse(readFileSync(file)))
}
const limit = 25 * 1024 * 1024
async function main() {
  const base = config.SUPABASE_URL?.replace(/\/$/, '')
  const key = config.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in packages/web/.env.local (or root .env).')
  const url = new URL(base)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || url.pathname !== '/') throw new Error('SUPABASE_URL must be https://PROJECT.supabase.co')
  const bucket = config.SUPABASE_UPLOAD_BUCKET || 'switchboard-files'
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  const endpoint = `${base}/storage/v1/bucket`
  let response = await fetch(`${endpoint}/${encodeURIComponent(bucket)}`, { headers, signal: AbortSignal.timeout(30000) })
  if (response.ok) {
    const existing = await response.json()
    if (existing.public !== false) throw new Error('Existing bucket is public. Choose a new private SUPABASE_UPLOAD_BUCKET; this script will not change a public bucket.')
    response = await fetch(`${endpoint}/${encodeURIComponent(bucket)}`, {
      method: 'PUT', headers, body: JSON.stringify({ public: false, file_size_limit: limit }), signal: AbortSignal.timeout(30000),
    })
  } else {
    const details = await response.json().catch(() => ({}))
    if (response.status !== 404 && Number(details.statusCode) !== 404) throw new Error(`Could not inspect Storage bucket (HTTP ${response.status}). Check the server key.`)
    response = await fetch(endpoint, {
      method: 'POST', headers, body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: limit }), signal: AbortSignal.timeout(30000),
    })
  }
  if (!response.ok) throw new Error(`Bucket setup failed (HTTP ${response.status}).`)
  console.log(`Private bucket '${bucket}' is ready with a 25 MiB per-file limit.`)
  console.log('Copy SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and any custom SUPABASE_UPLOAD_BUCKET to Vercel, then redeploy. Keep the service-role key server-only.')
}
main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
