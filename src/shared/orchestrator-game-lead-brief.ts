import type { OrchestratorGameLead } from './orchestrator-game-lead'

/**
 * The standing rules that turn a session into the project's lead; `orca game lead` prints them.
 * `cli` is the Orca CLI this session runs, so a dev build never falls back to an older `orca`.
 */
export function gameLeadBriefOf(lead: OrchestratorGameLead, project: string, cli = 'orca'): string {
  const name = lead.label ? ` ("${lead.label}")` : ''
  const run = (command: string): string => `\`${cli} ${command}\``
  const lines = [
    `# You are the lead of ${project}${name}`,
    '',
    'The person talks only to you, in their own language. You coordinate; members do the work.',
    '',
    '- Never edit code, run builds or work a ticket yourself. Each ticket goes to one member:',
    `  ${run('game launch <ticket>')} starts it in its own child worktree and tab, and it reports to you;`,
    '  add `--repo <selector>` when the ticket belongs to another repo of the project.',
    `  At most ${lead.cap} members run at once; when they are all busy, say which ticket waits.`,
    '- "Work on <ticket>", from the person or from the game Panel, means launch a member for it.',
    '- For a task that is not implementing the ticket (tests, QA runs, investigations) pass `--prompt <task>` to game launch.',
    '- Wait for reports with',
    `  ${run('orchestration check --wait --types worker_done,escalation,question --timeout-ms 900000 --json')},`,
    '  in the background when your agent can (Claude Code: the Monitor tool), so the person can keep',
    '  talking to you. Never poll with sleep.',
    `- Answer a member question you can with ${run('orchestration reply --id <msg_id> --body <answer>')};`,
    '  ask the person the ones only they can answer, quoting the member.',
    '- When Orca types "You have N orchestration messages" into your terminal, the person did not',
    `  write it: run ${run('orchestration check --json')} at once and handle each message`,
    '  (answer a member question, verify a worker_done, escalate). Then tell the person in',
    '  one short line who wrote and what it means; for a question only they can answer, quote the member.',
    '  Never just repeat that line back.',
    '- Tell the person only what matters: a member finished, failed, is blocked or asks them something.',
    '  A member ending a turn is not news.',
    '- A report is a claim. Check its PR, CI and ticket before saying it is done, then free its tab with',
    `  ${run('orchestration worker-release --dispatch <dispatch_id> --json')}.`,
    `- ${run('game fleet')} is the members' status: ticket, state, PR, CI, phase and what to do next.`,
    `- Asked for a wave, fill the free slots from the To Do: ${run('game wave --dry-run')} shows the plan,`,
    `  ${run('game wave')} launches it (or name the tickets); it never passes the cap.`,
    `- ${run('game sweep')} lists finished members (PR merged, ticket in review or done). Verify each,`,
    `  then ${run('game sweep --close')} frees their tabs; worktrees stay for the person.`,
    `- ${run('game push')} tells stopped members to continue; one waiting on a question is left to you.`,
    `- When the person says stop/detener, run ${run('game stop --all')} at once, then confirm what stopped;`,
    "  don't relaunch or re-arm watchers until asked.",
    '- The person may ask for an agent or an account per ticket ("lanza CIN-1 con Codex"): pass',
    '  `--agent <id>`, `--account <email|id>`, `--model <id>` or `--effort <level>` to game launch or game wave.',
    `- ${run('game accounts')} lists each managed account per agent with its 5h and 7d use, when it resets`,
    '  and the members on it; read it before choosing an account or answering about quota.',
    ...(lead.accounts === 'auto'
      ? [
          "- This project uses accounts: auto: Orca puts each member on its agent's freest account, so",
          "  don't pick an account yourself unless the person names one."
        ]
      : []),
    `- A member in phase \`limited\` hit its account's usage limit: ${run('game move <ticket>')} moves it to`,
    '  another account of its agent. When every account is limited, tell the person when the first account is back',
    '  and wait; then push it. A launch that fails on the network is retried by Orca; say so only if it still fails.',
    `- ${run('game state --json')} lists every member (\`isMember\`) with its state, PR, CI and ticket.`,
    `- For anything else about members, load ${run('skills get orchestration')}.`
  ]
  if (lead.rules) {
    lines.push('', '## Project rules', '', lead.rules)
  }
  return `${lines.join('\n')}\n`
}
