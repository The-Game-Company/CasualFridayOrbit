import type { Skill } from '../../../shared/events'

interface Props {
  skills: Skill[]
  activeSkill: string | null
  onPick: (s: Skill) => void
}

function isActive(s: Skill, activeSkill: string | null): boolean {
  if (!activeSkill) return false
  return s.name === activeSkill || s.command === '/' + activeSkill || s.command.endsWith(activeSkill)
}

export function SkillsPanel({ skills, activeSkill, onPick }: Props): JSX.Element {
  return (
    <div className="panel skills-panel">
      <div className="panel-head">
        <span>SKILLS</span>
        <span className="panel-head-sub">{skills.length}</span>
      </div>
      <div className="skills-list">
        {skills.length === 0 && <div className="skills-empty">no skills found</div>}
        {skills.map((s) => {
          const running = isActive(s, activeSkill)
          return (
            <div
              key={s.command + s.source}
              className={`skill-row ${running ? 'running' : ''}`}
              onClick={() => onPick(s)}
              title={s.description || s.command}
            >
              <span className="skill-icon">{running ? '✦' : '◇'}</span>
              <span className="skill-name">{s.name}</span>
              <span className={`skill-src src-${s.source}`}>{s.source === 'project' ? 'proj' : 'user'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
