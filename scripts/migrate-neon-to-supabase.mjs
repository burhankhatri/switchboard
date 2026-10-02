/**
 * From the repo root:
 *   node scripts/migrate-neon-to-supabase.mjs --check
 *   node scripts/migrate-neon-to-supabase.mjs --restore
 * Stop application writes and scheduled runs before --restore.
 * Reads root .env; never updates app configuration or deletes source data.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'packages/web/package.json'))
const { parse } = require('dotenv')
const { Client } = require('pg')
const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log('Usage: node scripts/migrate-neon-to-supabase.mjs --check | --restore')
  console.log('Reads SOURCE_DATABASE_URL and DESTINATION_DIRECT_URL (or DESTINATION_DATABASE_URL) from root .env.')
  console.log('Uses PostgreSQL 18 tools; override their directory with PG_BIN in .env.')
  process.exit(0)
}
if (args.length !== 1 || !['--check', '--restore'].includes(args[0])) {
  console.error('Specify --check for read-only checks or --restore to export and import. Use --help for details.')
  process.exit(1)
}

let secrets = []
function safeError(error) {
  let message = error.message || String(error)
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    message = message.split(secret).join('[redacted]')
  }
  return message
}

function runTool(bin, name, arguments_, env = process.env) {
  try {
    return execFileSync(path.join(bin, `${name}.exe`), arguments_, {
      env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    })
  } catch (error) {
    throw new Error(`${name} failed: ${error.stderr?.toString().trim() || error.message}`)
  }
}

function toolEnv(urlString) {
  const url = new URL(urlString)
  const inherited = { ...process.env }
  // libpq treats PGSERVICE='' as a request for a service named '', not as unset.
  // Remove inherited service settings so the explicit URL controls the connection.
  for (const key of Object.keys(inherited)) {
    if (/^(PGSERVICE|PGSERVICEFILE|PGOPTIONS)$/i.test(key)) delete inherited[key]
  }
  return {
    ...inherited,
    PGHOST: url.hostname, PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: url.searchParams.get('sslmode') || 'require',
    PGCONNECT_TIMEOUT: '20', PGAPPNAME: 'switchboard-migration',
  }
}

const tableSql = `SELECT c.relname AS name
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  ORDER BY c.relname`

async function counts(client, tables) {
  const result = {}
  // Use the same ordering even when the two databases have different collations.
  for (const { name } of [...tables].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const identifier = '"' + name.replaceAll('"', '""') + '"'
    const { rows } = await client.query(`SELECT count(*)::text AS count FROM public.${identifier}`)
    result[name] = rows[0].count
  }
  return result
}

async function main() {
  const config = parse(readFileSync(path.join(root, '.env')))
  const source = config.SOURCE_DATABASE_URL
  const destination = config.DESTINATION_DIRECT_URL || config.DESTINATION_DATABASE_URL
  secrets = [source, destination]
  if (!source || !destination) throw new Error('Root .env needs SOURCE_DATABASE_URL and DESTINATION_DIRECT_URL (or DESTINATION_DATABASE_URL).')
  for (const connection of [source, destination]) {
    const url = new URL(connection)
    secrets.push(url.password, decodeURIComponent(url.password))
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Both URLs must be PostgreSQL connection strings.')
  }
  const destUrl = new URL(destination)
  if (!/(^|\.)supabase\.(com|co)$/.test(destUrl.hostname)) throw new Error('Destination must be a Supabase database hostname.')
  if (destUrl.port === '6543') throw new Error('Set DESTINATION_DIRECT_URL to the session pooler URL on port 5432; restoration cannot use port 6543.')
  const sourceUrl = new URL(source)
  if (sourceUrl.hostname === destUrl.hostname && sourceUrl.pathname === destUrl.pathname) throw new Error('Source and destination must be different databases.')

  const bin = config.PG_BIN || 'C:\\Program Files\\PostgreSQL\\18\\bin'
  for (const tool of ['pg_dump', 'pg_restore', 'psql']) {
    if (!existsSync(path.join(bin, `${tool}.exe`))) throw new Error(`Missing ${tool}.exe in ${bin}. Install PostgreSQL 18 tools or set PG_BIN in .env.`)
  }
  const toolVersion = runTool(bin, 'pg_dump', ['--version']).trim()
  console.log(`Using ${toolVersion}`)
  const clients = [source, destination].map(connectionString => new Client({ connectionString, connectionTimeoutMillis: 20000 }))
  const [oldDb, newDb] = clients
  try {
    await oldDb.connect()
    await newDb.connect()
    const versions = []
    for (const client of clients) {
      versions.push(Number((await client.query('SHOW server_version_num')).rows[0].server_version_num))
    }
    console.log(`Source PostgreSQL ${Math.floor(versions[0] / 10000)}; destination PostgreSQL ${Math.floor(versions[1] / 10000)}.`)
    const toolMajor = Number(toolVersion.match(/PostgreSQL\)\s+(\d+)/)?.[1])
    if (!toolMajor || toolMajor < Math.floor(versions[0] / 10000)) throw new Error('pg_dump is older than the source server. Set PG_BIN to a sufficiently recent tools directory.')
    if (versions[1] < 140000) throw new Error('This script requires a PostgreSQL 14 or newer destination.')
    if (Math.floor(versions[1] / 10000) < Math.floor(versions[0] / 10000)) {
      console.log('Destination is older. The restore will run atomically and stop on incompatible SQL; transaction_timeout is omitted for servers older than 17.')
    }
    const sourceTables = (await oldDb.query(tableSql)).rows
    if (!sourceTables.some(({ name }) => name === '_prisma_migrations')) throw new Error('Source has no public._prisma_migrations table. Check that SOURCE_DATABASE_URL selects the correct application database.')
    const destinationTables = (await newDb.query(tableSql)).rows
    if (destinationTables.length) throw new Error('Destination public schema already contains tables. Use a fresh Supabase project; this script will not overwrite them.')
    const before = await counts(oldDb, sourceTables)
    console.log(`Connected successfully; ${sourceTables.length} source tables; destination has no application tables.`)
    if (args[0] === '--check') {
      console.log('Checks passed. Stop application writes and scheduled runs, then run this script with --restore.')
      return
    }

    const dir = path.join(os.tmpdir(), `switchboard-migration-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const backup = path.join(dir, 'neon.dump')
    const listPath = path.join(dir, 'restore.list')
    const sqlPath = path.join(dir, 'restore.sql')
    console.log(`Exporting to ${backup}`)
    runTool(bin, 'pg_dump', ['--format=custom', '--schema=public', '--no-owner', '--no-privileges', `--file=${backup}`], toolEnv(source))
    const list = runTool(bin, 'pg_restore', ['--list', backup])
      .split(/\r?\n/).filter(line => !/\sSCHEMA\s+-\s+public\s/.test(line) && !/\sCOMMENT\s+-\s+SCHEMA\s+public\s/.test(line)).join('\n')
    writeFileSync(listPath, list)
    runTool(bin, 'pg_restore', [`--use-list=${listPath}`, '--no-owner', '--no-privileges', `--file=${sqlPath}`, backup])
    if (versions[1] < 170000) {
      const sql = readFileSync(sqlPath, 'utf8').replace(/^SET transaction_timeout = 0;\r?\n/gm, '')
      writeFileSync(sqlPath, sql)
    }
    // PostgreSQL 18 psql understands the restrict/unrestrict commands in its dumps.
    // The database connection is supplied through PG* env vars, not command arguments.
    console.log('Restoring Supabase in one transaction...')
    runTool(bin, 'psql', ['--no-psqlrc', '--set=ON_ERROR_STOP=1', '--single-transaction', `--file=${sqlPath}`], toolEnv(destination))
    const afterTables = (await newDb.query(tableSql)).rows
    const after = await counts(newDb, afterTables)
    const currentSource = await counts(oldDb, sourceTables)
    if (JSON.stringify(before) !== JSON.stringify(currentSource)) throw new Error('Source row counts changed during migration. Destination was restored, but do not switch the app yet; stop source writes and investigate.')
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Restore completed but table row counts do not match. Do not switch the app yet; investigate.')
    console.log(`Migration complete. All ${sourceTables.length} table row counts match, including Prisma migration history.`)
    console.log(`Keep the backup private: ${backup}`)
    console.log('Next: set DATABASE_URL to the Supabase transaction pooler and DIRECT_URL to its session pooler in packages/web/.env.local and your deployment. Keep ENCRYPTION_KEY unchanged, then verify the app.')
  } finally {
    await Promise.allSettled(clients.map(client => client.end()))
  }
}

main().catch(error => {
  console.error(safeError(error))
  process.exitCode = 1
})
