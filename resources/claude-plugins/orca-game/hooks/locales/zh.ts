import type { GameCatalog } from '../game-strings'

// No `art`: a Raster cannot draw characters two columns wide, so the pixel art stays English.
export const ZH: GameCatalog = {
  text: {
    panel: '面板',
    refresh: '刷新',
    petClawd: '摸摸 Clawd',
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
    moreAllies: (count) => `另有 ${count} 项`
  }
}
