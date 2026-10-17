import type { GameCatalog } from '../game-strings'

// No `art`: a Raster cannot draw characters two columns wide, so the pixel art stays English.
export const ZH: GameCatalog = {
  text: {
    panel: '面板',
    refresh: '刷新',
    pet: '摸摸',
    petNamed: (name) => `摸摸 ${name}`,
    advisor: '顾问',
    advisorMain: '主对话',
    advisorEmpty: '暂无决定',
    close: '关闭',
    view: '查看',
    fleet: '舰队',
    team: '团队',
    loading: '加载中…',
    refreshing: '(刷新中)',
    unavailable: 'orca game state 不可用',
    lead: '负责人',
    reviewHeading: '评审',
    workItemHeading: '工作项',
    needsYou: '需要您处理：',
    waitingNeed: '在等您',
    ciFailingNeed: 'CI 失败',
    teammates: (count) => `团队 ${count} 名队友`,
    working: (count) => `${count} 工作中`,
    idle: (count) => `${count} 空闲`,
    done: (count) => `${count} 已完成`,
    waiting: (count) => `${count} 在等您`,
    agentStates: { working: '工作中', idle: '空闲', done: '已完成', waiting: '! 在等您' },
    reviewStates: { open: '开放', draft: '草稿', merged: '已合并', closed: '已关闭' },
    ciWords: { success: '通过', failure: '失败', pending: '运行中', neutral: '中性', none: '无' },
    couldNotOpen: (name) => `无法打开 ${name} 的窗格`,
    openHeading: '打开',
    couldNotOpenLink: (label) => `无法打开 ${label}`,
    merged: (review) => `${review} 已合并`,
    ciGreen: (review) => `${review} CI 已通过`,
    questDescription: 'Quest 模式：动画 Claude、按流程阶段显示的角色卡片、安静的工具行',
    questModesHelp:
      '/quest off 显示全部内容，/quest on 隐藏工具行，/quest zen 还会隐藏工作笔记，/quest demo 播放预设的虚拟队伍。',
    questShown: (mode) => `Quest：${mode}。`,
    questDemo:
      'Quest：demo。预设的虚拟队伍会播放所有反应，不读取也不写入任何内容。/quest on 返回真实数据。',
    unknownMode: (asked) =>
      `未知模式“${asked}”。请使用 /quest off、/quest on、/quest zen 或 /quest demo。`,
    moreAllies: (count) => `另有 ${count} 项`,
    myReviews: (kind, count) => `我的${kind} ${count}`,
    todo: (count) => `待办 ${count}`,
    actionsHeading: '操作',
    sentToLead: (label) => `已发送给负责人：${label}`,
    couldNotSend: (label) => `无法发送 ${label}`,
    actionRunning: '运行中…',
    demoAction: (label) => `演示：不会运行 ${label}`,
    todoHeadings: {
      in_progress: '进行中',
      review: 'QA / 评审',
      todo: '待办',
      backlog: '待规划',
      other: '其他'
    },
    qa: (count) => `QA ${count}`,
    workOn: (id) => `处理 ${id}`,
    leadActions: {
      wave: '一波',
      status: '状态',
      push: '继续',
      sweep: '清理',
      stop: '停止'
    },
    actionCommandDescription: (label) => `Orca 操作: ${label}`,
    actionCommandRefused: (command) => `/${command} 已被其他命令占用;请使用横栏或面板中的按钮`,
    actionCommandGone: (command) => `/${command} 已不再是此项目的操作`,
    limited: (backIn) => (backIn === null ? '已达用量上限' : `已达用量上限 · ${backIn} 后恢复`)
  }
}
