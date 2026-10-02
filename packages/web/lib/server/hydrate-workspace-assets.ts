import type { Sandbox } from "@daytonaio/sdk"
import { prisma } from "@/lib/db/prisma"
import { isSafeWorkspacePath, isSafeRepoPath } from "@/lib/git/ref-validation"
import { planFolderImport } from "@/lib/workspace-import"
import { assertUploadAccess } from "./file-uploads"
import { downloadStoredFile } from "./upload-storage"

// Metadata is passed as base64 JSON, never interpolated into executable Python.
// Check each parent for symlinks before the SDK writes to prevent workspace escapes.
export const HYDRATION_SCRIPT = String.raw`
import os, sys, json, base64, subprocess
payload = json.loads(base64.b64decode(sys.argv[1]))
root = os.path.realpath(payload['root'])
gitdir = os.path.join(root, '.git')
manifest = os.path.join(gitdir, 'switchboard-assets-' + payload['workspaceId'] + '.json')
def safe_target(rel):
    if rel.startswith('/') or '\\' in rel or any(p in ('', '.', '..') for p in rel.split('/')):
        raise RuntimeError('Invalid asset path')
    current = root
    parts = rel.split('/')
    for part in parts:
        current = os.path.join(current, part)
        if os.path.islink(current) or os.path.normcase(os.path.realpath(current)) != os.path.normcase(os.path.abspath(current)):
            raise RuntimeError('An asset path contains a symlink')
    return current
def tracked(rel):
    return subprocess.run(['git', '-C', root, 'ls-files', '--error-unmatch', '--', rel], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
if not os.path.isdir(gitdir) or os.path.islink(gitdir) or os.path.islink(manifest):
    raise RuntimeError('Invalid asset manifest location')
if payload['action'] == 'record':
    with open(manifest, 'w') as handle:
        json.dump({a['path']: a['uploadId'] for a in payload['assets']}, handle)
else:
    previous = {}
    if os.path.isfile(manifest):
        with open(manifest) as handle:
            previous = json.load(handle)
    assets = {a['path']: a for a in payload['assets']}
    for rel in previous:
        # Ignore corrupt entries outside this workspace rather than touching them.
        if not rel.startswith(payload['workspacePath'] + '/'):
            continue
        target = safe_target(rel)
        if rel not in assets and os.path.isfile(target) and not tracked(rel):
            os.unlink(target)
    info = os.path.join(gitdir, 'info')
    exclude = os.path.join(info, 'exclude')
    if os.path.islink(info) or os.path.islink(exclude):
        raise RuntimeError('Invalid git exclusion location')
    os.makedirs(info, exist_ok=True)
    existing = ''
    if os.path.isfile(exclude):
        with open(exclude) as handle:
            existing = handle.read()
    additions, needed = [], []
    for rel, asset in assets.items():
        target = safe_target(rel)
        if tracked(rel):
            raise RuntimeError('A retained asset conflicts with a tracked Git file: ' + rel)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        pattern = '/' + ''.join(('\\' + ch) if ch in '\\*?[]!# ' else ch for ch in rel)
        if pattern not in existing.splitlines():
            additions.append(pattern)
        if previous.get(rel) != asset['uploadId'] or not os.path.isfile(target):
            needed.append(asset['uploadId'])
    if additions:
        with open(exclude, 'a') as handle:
            handle.write('\n' + '\n'.join(additions) + '\n')
    print(json.dumps(needed))
`

export async function hydrateWorkspaceAssets(sandbox: Sandbox, options: {
  workspaceId: string; workspacePath: string; userId: string; repoPath: string;
}) {
  if (!isSafeWorkspacePath(options.workspacePath) || !isSafeRepoPath(options.repoPath) || !/^[a-zA-Z0-9_-]+$/.test(options.workspaceId)) throw new Error("Invalid workspace asset destination")
  await assertUploadAccess(options.userId, { kind: "workspace", id: options.workspaceId })
  const assets = await prisma.workspaceAsset.findMany({ where: { workspaceId: options.workspaceId }, include: { upload: true } })
  // Revalidate stored paths as well as incoming ones; corrupted metadata must
  // never place a file outside the sparse-cloned workspace.
  for (const asset of assets) {
    if (!asset.path.startsWith(`${options.workspacePath}/`)) throw new Error("Asset is outside this workspace")
    const relativePath = asset.path.slice(options.workspacePath.length + 1)
    if (!planFolderImport([{ relativePath, size: asset.upload.size }], options.workspacePath).files.length) throw new Error("Unsafe workspace asset path")
  }
  const metadata = assets.map(asset => ({ path: asset.path, uploadId: asset.uploadId }))
  const script = Buffer.from(HYDRATION_SCRIPT).toString("base64")
  const run = async (action: "prepare" | "record") => {
    const encoded = Buffer.from(JSON.stringify({ action, root: options.repoPath, workspaceId: options.workspaceId, workspacePath: options.workspacePath, assets: metadata })).toString("base64")
    const result = await sandbox.process.executeCommand(`python3 -c 'import base64; exec(base64.b64decode("${script}"))' '${encoded}'`)
    if (result.exitCode !== 0) throw new Error("Could not prepare workspace assets: " + (result.result || "sandbox command failed"))
    return result.result || "[]"
  }
  const needed = JSON.parse(await run("prepare")) as string[]
  for (const asset of assets.filter(asset => needed.includes(asset.uploadId))) {
    const bytes = await downloadStoredFile(asset.upload.objectPath, asset.upload.size)
    await sandbox.fs.uploadFile(bytes, `${options.repoPath}/${asset.path}`)
  }
  await run("record")
}
