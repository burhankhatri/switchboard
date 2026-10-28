import { describe, it, expect } from "vitest"
import { classifyWrite, summarizeWrites, writeOutcome, WriteTracker } from "./write-classifier"

/**
 * Users asked four times whether an action had happened ("did you create the
 * draft campaign", "did u update the campaign"). The writes were curl -X POST
 * and --apply flags buried in Bash tool calls that look like every other chip.
 * These cases are the shapes found in the stored transcripts.
 */
describe("classifyWrite", () => {
  const bash = (command: string) => classifyWrite("Bash", { command })

  it("ignores reads", () => {
    expect(bash('curl -s -H "Authorization: Bearer $GTM_TOKEN" "$GTM_BASE_URL/api/leads?verdict=qualified"')).toBeNull()
    expect(bash("python3 scripts/push_to_instantly.py --json")).toBeNull()
    expect(bash("python3 scripts/instantly_report.py --since 2026-10-01")).toBeNull()
    expect(bash("git add -A && git commit -q -m 'x' && git log --oneline -1")).toBeNull()
  })

  it("ignores Instantly's POST-shaped list endpoints", () => {
    // Instantly v2 lists leads with POST /leads/list. It reads.
    expect(
      bash('curl -s -X POST -H "Authorization: Bearer $INSTANTLY_TOKEN" -d "{\\"campaign_id\\":\\"$CID\\",\\"limit\\":100}" "$INSTANTLY_BASE_URL/leads/list" -o ll.json')
    ).toBeNull()
  })

  it("tags a script run with --apply", () => {
    const w = bash("cd /home/daytona/project/workspaces/gtm-lead-engine && python3 scripts/push_to_instantly.py --campaign 7c08d5fb-642f-4483-ab53-469b0247b5d7 --apply 2>&1")
    expect(w).toEqual({ verb: "apply", target: "push_to_instantly.py --campaign 7c08d5fb-642f-4483-ab53-469b0247b5d7" })
    expect(bash("python3 scripts/create_campaign.py campaigns/x/campaign.json --apply --healthy-senders")?.target).toBe(
      "create_campaign.py campaigns/x/campaign.json"
    )
  })

  it("tags curl POST/PATCH/DELETE to a workspace API by its path", () => {
    expect(
      bash('curl -s -X POST -H "Authorization: Bearer $GTM_TOKEN" -H \'Content-Type: application/json\' -d \'{"place_ids":["x"],"patch":{"work_status":"skipped"}}\' "$GTM_BASE_URL/api/leads/bulk"')
    ).toEqual({ verb: "POST", target: "$GTM_BASE_URL/api/leads/bulk" })
    expect(
      bash('curl -s -X POST -H "Authorization: Bearer $INSTANTLY_TOKEN" -d \'{"contacts":["a@b.c"]}\' "$INSTANTLY_BASE_URL/leads/remove"')
    ).toEqual({ verb: "POST", target: "$INSTANTLY_BASE_URL/leads/remove" })
    expect(bash('curl -X PATCH "$INSTANTLY_BASE_URL/campaigns/$CID" -d \'{"status":1}\'')).toEqual({
      verb: "PATCH",
      target: "$INSTANTLY_BASE_URL/campaigns/$CID",
    })
  })

  it("tags a credit-spending engine call even when the URL is built in a heredoc", () => {
    const w = bash('python3 -c "..." && curl -s -X POST -H "Authorization: Bearer $GTM_TOKEN" -d @/tmp/logs/b1.json "$GTM_BASE_URL/api/enrich"')
    expect(w).toEqual({ verb: "POST", target: "$GTM_BASE_URL/api/enrich" })
  })

  it("tags a POST made from Python's _http helper", () => {
    const w = bash('python3 - <<\'EOF\'\nfrom _http import request\nrequest("POST", f"{base}/leads/add", tok, body)\nEOF')
    expect(w).toEqual({ verb: "POST", target: "/leads/add" })
  })

  it("tags a POST to an unknown host by host and path", () => {
    const w = bash('curl -sS -c /tmp/c.txt -X POST https://crm.sunzicloud.com/index.php --data-urlencode "module=Users"')
    expect(w).toEqual({ verb: "POST", target: "crm.sunzicloud.com/index.php" })
  })

  it("tags the pricing bot's real run but not its dry run", () => {
    expect(bash("python3 crm_pricing_bot.py --dry-run")).toBeNull()
    expect(bash("python3 crm_pricing_bot.py")).toEqual({ verb: "run", target: "crm_pricing_bot.py" })
  })

  it("only looks at shell tools", () => {
    expect(classifyWrite("Edit", { file_path: "x", old_string: "-X POST" })).toBeNull()
    expect(classifyWrite("Write", { file_path: "notes.md", content: "--apply" })).toBeNull()
  })
})

describe("writeOutcome", () => {
  it("reads a count and status from the tool output when there is one", () => {
    expect(writeOutcome('{"leads_uploaded": 16, "skipped_count": 2}')).toEqual({ count: 16, label: "leads_uploaded" })
    expect(writeOutcome('{"pushed": 3, "failed": 0, "enrolled": 3}')).toEqual({ count: 3, label: "pushed" })
    expect(writeOutcome('{"updated": 9}')).toEqual({ count: 9, label: "updated" })
    expect(writeOutcome("done HTTP:201")).toEqual({ status: 201 })
    expect(writeOutcome("Marked 16 Lead Engine leads work_status=in_progress.")).toBeNull()
    expect(writeOutcome(undefined)).toBeNull()
  })
})

describe("summarizeWrites", () => {
  it("is empty for a read-only turn", () => {
    expect(summarizeWrites([{ tool: "shell", summary: "Bash: ls" }])).toEqual([])
  })

  it("lists each write once with its outcome", () => {
    const lines = summarizeWrites([
      { tool: "shell", summary: "Bash: …", write: { verb: "apply", target: "push_to_instantly.py --campaign 7c08" }, output: '{"leads_uploaded": 16}' },
      { tool: "shell", summary: "Bash: …", write: { verb: "POST", target: "$GTM_BASE_URL/api/leads/bulk" }, output: '{"updated": 9}' },
      { tool: "shell", summary: "Bash: ls" },
    ])
    expect(lines).toEqual([
      "apply push_to_instantly.py --campaign 7c08 → leads_uploaded 16",
      "POST $GTM_BASE_URL/api/leads/bulk → updated 9",
    ])
  })
})

/**
 * Found by replaying the production transcripts (2026-10-28) after shipping:
 * the classifier missed a campaign activation, urllib POSTs and scripts the
 * agent wrote and then ran, and mislabelled commands that chain curl calls.
 * Each case below is the shape of a real command from Wayne's campaign chat.
 */
describe("classifyWrite — gaps found on production", () => {
  const bash = (command: string) => classifyWrite("Bash", { command })

  it("takes verb and URL from the same curl call when several are chained", () => {
    // A POST-shaped list read followed by a GET: neither is a write.
    expect(
      bash(
        'curl -s -X POST -H "Authorization: Bearer $INSTANTLY_TOKEN" -d \'{"campaign":"9e8897c8","limit":100}\' "$INSTANTLY_BASE_URL/leads/list" -o /tmp/l.json; ' +
          'curl -s -H "Authorization: Bearer $INSTANTLY_TOKEN" "$INSTANTLY_BASE_URL/campaigns?limit=100"'
      )
    ).toBeNull()
    // A paid run followed by a settings read: the write is the run.
    expect(
      bash(
        'curl -s -X POST -H "Authorization: Bearer $GTM_TOKEN" -d \'{"zips":"75207","cap":10}\' "$GTM_BASE_URL/api/run"; echo; ' +
          'curl -s -H "Authorization: Bearer $GTM_TOKEN" "$GTM_BASE_URL/api/settings"'
      )
    ).toEqual({ verb: "POST", target: "$GTM_BASE_URL/api/run" })
  })

  it("tags a helper call whose f-string path has more than one placeholder", () => {
    // The 2026-10-06 activation of campaign da6bed9e.
    const w = bash(
      'python3 - <<\'EOF\'\nfrom _http import request, env\nbase, token = env("INSTANTLY_BASE_URL"), env("INSTANTLY_TOKEN")\n' +
        'cid = "da6bed9e"\nr = request("POST", f"{base}/campaigns/{cid}/activate", token)\nEOF'
    )
    expect(w).toEqual({ verb: "POST", target: "/campaigns/{cid}/activate" })
  })

  it("tags any helper called with a write verb and a literal path", () => {
    const w = bash('python3 - <<\'EOF\'\nresult = call("POST", "/api/run", {"zips": z, "cap": 25, "confirm": True})\nEOF')
    expect(w).toEqual({ verb: "POST", target: "/api/run" })
  })

  it("tags a urllib POST to a literal path, and leaves urllib list reads alone", () => {
    expect(
      bash(
        'python3 - <<\'EOF\'\nreq = urllib.request.Request(f"{base}/api/enrich", data=body, method="POST", headers={"Authorization": f"Bearer {tok}"})\nEOF'
      )
    ).toEqual({ verb: "POST", target: "/api/enrich" })
    // data= without a method is a POST in urllib.
    expect(
      bash("python3 - <<'EOF'\nreq = urllib.request.Request(os.environ['GTM_BASE_URL'].rstrip('/') + '/api/enrich', data=json.dumps(b).encode())\nEOF")
    ).toEqual({ verb: "POST", target: "/api/enrich" })
    expect(
      bash(
        "python3 - <<'EOF'\nreq = urllib.request.Request(base + '/leads/list', data=json.dumps(body).encode(), method='POST', headers={'A': 'b'})\nEOF"
      )
    ).toBeNull()
  })

  it("does not tag a generic urllib helper with no verb and no path", () => {
    expect(
      bash("python3 - <<'EOF'\ndef call(url, data=None):\n    req = urllib.request.Request(url, data=body, headers=h)\nEOF")
    ).toBeNull()
  })
})

describe("WriteTracker — scripts the agent writes and then runs", () => {
  it("tags running a script whose source, written earlier in the turn, makes writes", () => {
    const t = new WriteTracker()
    const body =
      '#!/usr/bin/env python3\n"""Paid /api/enrich driver: place_ids in batches of 25."""\n' +
      'def call(method, path, body=None):\n    return urllib.request.Request(BASE + path, data=data, method=method)\n' +
      'call("POST", "/api/enrich", {"place_ids": b, "confirm": True})\n'
    // Writing the file is not itself a write outside the sandbox.
    expect(t.observe("Bash", { command: `cat > /tmp/logs/enrich_driver.py <<'PYEOF'\n${body}PYEOF` })).toBeNull()
    expect(t.observe("Bash", { command: "cd /tmp/logs && nohup python3 /tmp/logs/enrich_driver.py > run.log 2>&1 &" })).toEqual({
      verb: "run",
      target: "enrich_driver.py (POST /api/enrich)",
    })
  })

  it("remembers scripts written with the Write tool too", () => {
    const t = new WriteTracker()
    t.observe("Write", { file_path: "/tmp/logs/engine_driver.py", content: 'call("POST", "/api/run", {"zips": z})\n' })
    expect(t.observe("Bash", { command: "python3 /tmp/logs/engine_driver.py --target 1100" })?.target).toBe(
      "engine_driver.py (POST /api/run)"
    )
  })

  it("does not tag running a script that only reads", () => {
    const t = new WriteTracker()
    t.observe("Bash", { command: "cat > /tmp/logs/count.py <<'EOF'\nimport json\nprint(len(json.load(open('l.json'))))\nEOF" })
    expect(t.observe("Bash", { command: "python3 /tmp/logs/count.py" })).toBeNull()
  })

  it("still classifies ordinary single calls", () => {
    const t = new WriteTracker()
    expect(t.observe("Bash", { command: "python3 scripts/push_to_instantly.py --campaign c1 --apply" })).toEqual({
      verb: "apply",
      target: "push_to_instantly.py --campaign c1",
    })
  })
})

describe("classifyWrite — urllib one-segment paths", () => {
  it("keeps a one-segment path such as /campaigns", () => {
    expect(
      classifyWrite("Bash", {
        command: "python3 - <<'EOF'\nreq = urllib.request.Request(base.rstrip('/') + '/campaigns', data=json.dumps(spec).encode())\nEOF",
      })
    ).toEqual({ verb: "POST", target: "/campaigns" })
  })
})

describe("writeOutcome — timestamps are not counts", () => {
  it("does not read an updated timestamp as a count", () => {
    // Real output from the 2026-10-06 activation: "status: 1 | updated: 2026-10-06T16:…"
    expect(writeOutcome("activate response: status: 1 | updated: 2026-10-06T16:02:11Z")).toBeNull()
    expect(writeOutcome('{"id":"x","timestamp_updated":"2026-10-06T17:00:00Z"}')).toBeNull()
    expect(writeOutcome('{"updated": 9}')).toEqual({ count: 9, label: "updated" })
  })
})
