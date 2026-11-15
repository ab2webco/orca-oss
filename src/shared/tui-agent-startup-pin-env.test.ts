import { describe, expect, it } from 'vitest'
import { AGENT_EFFORT_PINNED_ENV, AGENT_MODEL_PINNED_ENV } from './agent-launch-pin-env'
import { buildAgentDraftLaunchPlan, buildAgentStartupPlan } from './tui-agent-startup'

const base = { cmdOverrides: {}, platform: 'linux' as const, allowEmptyPromptLaunch: true }

describe('an agent told its model or effort was pinned at launch', () => {
  it('sets both pins when the launch applies a model and an effort, keeping the agent env', () => {
    const plan = buildAgentStartupPlan({
      ...base,
      agent: 'claude',
      prompt: '',
      agentEnv: { FOO: 'bar' },
      sessionOptions: { model: 'opus', effort: 'high' }
    })
    expect(plan?.env).toEqual({
      FOO: 'bar',
      [AGENT_MODEL_PINNED_ENV]: '1',
      [AGENT_EFFORT_PINNED_ENV]: '1'
    })
  })

  // Why (ORCA-851): the lead's ticket-kind default is Orca's guess, which Jev may still move.
  it('applies an unpinned default without telling the agent it was pinned', () => {
    const plan = buildAgentStartupPlan({
      ...base,
      agent: 'claude',
      prompt: '',
      agentEnv: { FOO: 'bar' },
      sessionOptions: { model: 'claude-opus-5-5', effort: 'high' },
      sessionOptionsUnpinned: true
    })
    expect(plan?.launchCommand).toContain('claude-opus-5-5')
    expect(plan?.env).toEqual({ FOO: 'bar' })
  })

  it("never overrides a model the person's own agent arguments name", () => {
    const plan = buildAgentStartupPlan({
      ...base,
      agent: 'claude',
      prompt: '',
      agentArgs: '--model claude-haiku-5-5',
      sessionOptions: { model: 'claude-opus-5-5', effort: 'high' },
      sessionOptionsOverrideAgentArgs: true,
      sessionOptionsUnpinned: true
    })
    // Why the order: the agent takes the last --model, so the person's comes after Orca's default.
    const command = plan?.launchCommand ?? ''
    expect(command.lastIndexOf('claude-haiku-5-5')).toBeGreaterThan(
      command.lastIndexOf('claude-opus-5-5')
    )
  })

  it('pins only the model for another agent launched with a model alone, also with a prompt', () => {
    const plan = buildAgentStartupPlan({
      ...base,
      agent: 'codex',
      prompt: 'Implement CIN-1',
      sessionOptions: { model: 'gpt-5.5' }
    })
    expect(plan?.env).toEqual({ [AGENT_MODEL_PINNED_ENV]: '1' })
  })

  it('pins nothing when the launch names no model or effort', () => {
    expect(
      buildAgentStartupPlan({ ...base, agent: 'claude', prompt: '', agentEnv: { FOO: 'bar' } })?.env
    ).toEqual({ FOO: 'bar' })
    expect(buildAgentStartupPlan({ ...base, agent: 'gemini', prompt: '' })?.env).toBeUndefined()
  })

  it("pins nothing the user's own agent arguments overrode", () => {
    const plan = buildAgentStartupPlan({
      ...base,
      agent: 'claude',
      prompt: '',
      sessionOptions: { model: 'opus', effort: 'xhigh' },
      agentArgs: '--model haiku --effort low'
    })
    expect(plan?.env).toBeUndefined()
  })

  it('pins a draft launch too', () => {
    const plan = buildAgentDraftLaunchPlan({
      ...base,
      agent: 'claude',
      draft: 'Plan CIN-1',
      sessionOptions: { model: 'opus' }
    })
    expect(plan?.env).toEqual(expect.objectContaining({ [AGENT_MODEL_PINNED_ENV]: '1' }))
  })
})
