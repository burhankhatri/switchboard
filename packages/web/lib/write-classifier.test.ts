import { describe, it, expect } from "vitest"
import { classifyWrite, summarizeWrites, writeOutcome } from "./write-classifier"

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
