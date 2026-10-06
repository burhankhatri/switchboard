# @switchboard/sandbox-jobs

Run, observe, and reconnect to **long-running shell processes** in a Daytona
sandbox — using the sandbox filesystem as the durable source of truth.

The problem it solves: a sandbox's `executeCommand` is request/response and
short-lived, but a real job (an agent run, a build, a test suite) can run for
minutes. This package detaches the process inside the sandbox and represents the
entire run as files, so a **cold caller** — a serverless function, a restarted
server, a different process — can reattach by id and read output incrementally
without ever holding a connection open.

## Model

One job = one process = one directory:

```
<root>/<jobId>/
  meta.json     { jobId, pgid, cgroup, processTag, processName, outputFile, exitFile, dir, createdAt, version }
  output.log    combined stdout+stderr, byte-exact, append-only
  exit          integer $?, present ONLY once the process finishes
```

- **Detached + cancellable.** Launched with `setsid` and a unique inherited
  `SWITCHBOARD_JOB_ID` environment marker. When a writable cgroup-v2 is
  available, the job joins it and `cancel()` uses `cgroup.kill` to reap every
  descendant. On read-only cgroup mounts, jobs still start: cancellation scans
  `/proc/*/environ` for the exact marker and kills matching processes, including
  children that detached with `setsid()` or were reparented. Both modes send
  SIGTERM first, then SIGKILL after 500ms, and kill the process group as a
  backstop. Tagged cancellation does not sweep other jobs by executable name.
  The fallback requires readable process environments and GNU `grep -z`;
  descendants that deliberately clear their environment need cgroup support.
- **Real exit codes.** The wrapper records the true `$?`; completion is never
  guessed. A process killed before it could write `$?` (SIGKILL/OOM) is detected
  as `crashed` via process-group liveness.
- **Incremental, UTF-8-safe reads.** `read(handle, cursor)` returns only bytes
  after the cursor, truncated to the last complete line — so the cursor never
  splits a multi-byte character and you never re-read the whole log.
- **Cold reconnect.** Everything needed to reattach is the serializable
  `JobHandle` + an integer cursor, or just the job id via `attach()`.

## Why not Daytona's session API (`executeSessionCommand`)?

Daytona ships a native way to run a detached command: `createSession` +
`executeSessionCommand({ runAsync: true })`, then `getSessionCommand` /
`getSessionCommandLogs`. It looks like it should replace this package — the
daemon supervises the process and even returns a real exit code. We evaluated
it directly; for the **cold-serverless-poller** use case (a function that starts
a job, dies, and reconnects later to stream output into a DB) the file approach
wins on the things that actually bite:

| | This package (files) | `executeSessionCommand` |
|---|---|---|
| **Incremental reads** | byte-offset `tail` → only new bytes, **O(n)** over a run | `getSessionCommandLogs` has **no offset param**: full-dump every poll (**O(n²)**), *or* a streaming callback that forces a held-open connection |
| **Connectionless polling** | any cold caller reads the filesystem; nothing to keep alive | the streaming variant needs a live socket; the dump variant re-sends everything |
| **Output fidelity** | `output.log` is **byte-exact**, so a byte cursor is reliable | the log stream is wrapped in control-byte framing (e.g. `\x01` markers) — not byte-exact, which breaks offset cursors |
| **Cancellation** | `cgroup.kill` when available; otherwise an inherited job marker catches `setsid()` escapees | no documented kill for an async session command — you shell out to `pkill` anyway |
| **Lifecycle to manage** | none — a dead process just leaves files; cleanup is `rm -rf <dir>` | a **session** outlives the command and must be torn down; deleting a live session reaps the process (a real footgun), and sessions accumulate |
| **Isolation** | each job is its own process, dir, and cursor | a session is a **stateful shell** — env/cwd bleed across commands |
| **Full-transcript retention** | the whole log until the disk fills | the daemon's log buffer may be capped (undocumented), which would break replay-from-zero |
| **Backend surface** | only needs `executeCommand` — the most basic primitive | tied to the full session/command API |

Note one thing it does **not** beat the session API on: exit codes.
`getSessionCommand` returns a real `exitCode` too. The exit-code win here is over
the older `nohup` + `.done`-sentinel approach this package replaces, not over the
session API.

**When the session API is the better choice:** when you *want* Daytona to own
process supervision (server-side observability), or when you have a long-lived
server holding a socket and want live push rather than polling — e.g. an
interactive terminal/PTY. That's a different shape than "reliably get every line
and the exit code into a database from an intermittent caller," which is what
this package is for.

## Usage

```ts
import { createSandboxJobs } from "@switchboard/sandbox-jobs"

const jobs = createSandboxJobs(sandbox) // a @daytonaio/sdk Sandbox

const handle = await jobs.start({
  command: `for i in $(seq 1 100); do echo "tick $i"; sleep 1; done`,
  cwd: "/home/daytona/project",
  env: { FOO: "bar" },
  timeoutSeconds: 600, // optional hard limit (coreutils `timeout`)
})

// Poll incrementally (cold-start safe — rebuild `jobs`/`handle` each time):
let cursor = 0
for (;;) {
  const r = await jobs.read(handle, cursor)
  cursor = r.cursor
  process.stdout.write(r.raw)
  if (r.status.state !== "running") {
    console.log("done", r.status) // { state: "exited", exitCode: 0, alive: false }
    break
  }
}

// Or reattach later from just the id:
const reattached = await jobs.attach(handle.jobId)
```

## Tests

```bash
npm run typecheck
npx vitest run tests/parse.test.ts        # pure unit tests, instant
npx vitest run tests/jobs.test.ts         # startup, cancellation, legacy metadata
npx vitest run tests/jobs.local.test.ts   # real Linux processes, forced read-only cgroups
DAYTONA_API_KEY=... npx vitest run        # + integration (creates a sandbox)
```

On Windows, set `SBJ_LOCAL_WSL=1` to run the local Linux tests through an
installed Ubuntu WSL distro with Python 3. A persistent executor keeps detached
jobs alive between calls; no Daytona credentials are needed for these tests.
