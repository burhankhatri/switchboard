import { SKILLS_DIR } from "./workspace-skills"

export interface TreeFile {
  /** Repo path — what reads and writes use. */
  path: string
  /** Path inside the workspace — what the tree is built from. */
  name: string
  size: number
}

export interface FileNode {
  name: string
  /** Path inside the workspace: "lib" for a folder, "lib/leads.ts" for a file. */
  rel: string
  file?: TreeFile
  /** The workspace's .claude/skills, shown at the top level. */
  isSkillsFolder?: boolean
  children: Map<string, FileNode>
}

/** git has no empty directories, so a new folder is a folder with a .gitkeep. */
export const GITKEEP = ".gitkeep"

export const SKILLS_FOLDER_LABEL = "Skills"

/**
 * Keyed by its real path, which cannot collide with a top-level name: a path
 * segment never contains a slash, so a folder someone calls "Skills" survives.
 */
const SKILLS_KEY = SKILLS_DIR

/**
 * The workspace's files as a tree, with `.claude/skills` lifted to a top-level
 * Skills folder. That path is the only place the agent reads skills from, but
 * as a dotfolder two levels down it was invisible to anyone browsing the way
 * Finder does. The folder keeps its real `rel`, so dropping into it lands in
 * `.claude/skills`; whatever else is in `.claude` stays there.
 */
export function buildFileTree(files: TreeFile[]): FileNode {
  const root: FileNode = { name: "", rel: "", children: new Map() }
  for (const f of files) {
    let node = root
    const parts = f.name.split("/")
    parts.forEach((part, i) => {
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, rel: parts.slice(0, i + 1).join("/"), children: new Map() })
      }
      node = node.children.get(part)!
      if (i === parts.length - 1) node.file = f
    })
  }

  const claude = root.children.get(".claude")
  const skills = claude?.children.get("skills")
  if (claude && skills && !skills.file) {
    claude.children.delete("skills")
    if (childrenOf(claude).length === 0) root.children.delete(".claude")
    root.children.set(SKILLS_KEY, { ...skills, name: SKILLS_FOLDER_LABEL, isSkillsFolder: true })
  }
  return root
}

/** The Skills folder, then folders, then files — names in the order Finder uses. */
export function childrenOf(node: FileNode): FileNode[] {
  return [...node.children.values()]
    .filter((c) => c.name !== GITKEEP)
    .sort((a, b) => {
      if (!!a.isSkillsFolder !== !!b.isSkillsFolder) return a.isSkillsFolder ? -1 : 1
      if (!a.file !== !b.file) return a.file ? 1 : -1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    })
}
