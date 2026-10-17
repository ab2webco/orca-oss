// Per-locale renderings that are machine-translation errors for a brand or product name, and get
// reverted to the Latin original. Ordinary vocabulary that merely looks like a brand lives in
// locale-generic-ui-terms.mjs and stays translated.
export const BRAND_MISTRANSLATIONS = {
  es: {
    Codex: ['códice', 'Códice'],
    Gemini: ['Géminis'],
    Claude: ['claudia', 'Claudia'],
    Orca: ['orca', 'Orcas', 'orcas'],
    'Orca Lab': ['Laboratorio Orca', 'laboratorio Orca', 'Laboratorio de Orca', 'Orca Laboratorio'],
    OpenCode: ['código abierto', 'Código abierto'],
    OpenClaude: ['Openclaude'],
    Antigravity: ['antigravedad', 'Antigravedad'],
    'GitHub Copilot': ['Copiloto de GitHub'],
    Discord: ['discordia'],
    Linear: ['lineal', 'Lineal'],
    Jira: ['jira'],
    Agent: ['Agente', 'agente'],
    Agents: ['Agentes', 'agentes'],
    agent: ['agente'],
    agents: ['agentes'],
    Commit: ['Confirmación', 'confirmación', 'Confirmar', 'Comprometerse'],
    Commits: ['Confirmaciones', 'confirmaciones', 'Compromisos', 'compromisos', 'Se compromete'],
    commit: ['confirmación', 'confirmar', 'comprometerse', 'compromiso'],
    commits: ['confirmaciones', 'compromisos'],
    Markdown: ['Reducción', 'reducción', 'Rebaja', 'rebaja', 'rebajas'],
    markdown: ['reducción', 'rebaja', 'rebajas'],
    Repo: ['Repositorio', 'repositorio'],
    Repos: ['Repositorios', 'repositorios'],
    repo: ['repositorio'],
    repos: ['repositorios']
  }
}
