import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Skill } from '../shared/events'

/** Pull `name` / `description` out of a SKILL.md YAML frontmatter block. */
function parseSkillMd(dir: string): { name?: string; description?: string } {
  try {
    const md = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')
    const fm = md.match(/^---\s*([\s\S]*?)\s*---/)
    if (!fm) return {}
    const block = fm[1]
    const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
    const description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
    return { name, description }
  } catch {
    return {}
  }
}

function scanSkillsDir(skillsDir: string, source: 'project' | 'user'): Skill[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: Skill[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const dir = path.join(skillsDir, e.name)
    const meta = parseSkillMd(dir)
    const name = meta.name || e.name
    out.push({ name, description: meta.description || '', source, command: '/' + name })
  }
  return out
}

/** Discover skills available to a project: project-level first, then user-level. */
export function listSkills(projectPath: string | null): Skill[] {
  const skills: Skill[] = []
  if (projectPath) skills.push(...scanSkillsDir(path.join(projectPath, '.claude', 'skills'), 'project'))
  skills.push(...scanSkillsDir(path.join(os.homedir(), '.claude', 'skills'), 'user'))

  const seen = new Set<string>()
  return skills
    .filter((s) => {
      if (seen.has(s.command)) return false
      seen.add(s.command)
      return true
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
