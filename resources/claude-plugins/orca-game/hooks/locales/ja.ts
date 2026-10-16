import type { GameCatalog } from '../game-strings'

// No `art`: a Raster cannot draw characters two columns wide, so the pixel art stays English.
export const JA: GameCatalog = {
  text: {
    panel: 'パネル',
    refresh: '更新',
    petClawd: 'Clawd をなでる',
    close: '閉じる',
    view: '表示',
    fleet: 'フリート',
    team: 'チーム',
    loading: '読み込み中…',
    refreshing: '(更新中)',
    unavailable: 'orca game state を取得できません',
    lead: 'リード',
    reviewHeading: 'レビュー',
    workItemHeading: '作業項目',
    needsYou: '対応が必要:',
    waitingNeed: 'あなたの応答待ち',
    ciFailingNeed: 'CI 失敗',
    teammates: (count) => `チーム ${count} 人`,
    working: (count) => `作業中 ${count}`,
    idle: (count) => `待機中 ${count}`,
    done: (count) => `完了 ${count}`,
    waiting: (count) => `応答待ち ${count}`,
    agentStates: { working: '作業中', idle: '待機中', done: '完了', waiting: '! 応答待ち' },
    reviewStates: { open: 'オープン', draft: '下書き', merged: 'マージ済み', closed: 'クローズ' },
    ciWords: { success: '成功', failure: '失敗', pending: '実行中', neutral: '中立', none: 'なし' },
    couldNotOpen: (name) => `${name} のペインを開けませんでした`,
    openHeading: '開く',
    couldNotOpenLink: (label) => `${label} を開けませんでした`,
    merged: (review) => `${review} をマージしました`,
    ciGreen: (review) => `${review} の CI が成功しました`,
    questDescription:
      'Quest モード: アニメーションする Claude、フローの段階ごとのキャラクターカード、目立たないツール行',
    questModesHelp:
      '/quest off ですべて表示、/quest on でツール行を非表示、/quest zen で作業メモも非表示、/quest demo で台本どおりの架空のパーティーを再生します。',
    questShown: (mode) => `Quest: ${mode}。`,
    questDemo:
      'Quest: demo。台本どおりの架空のパーティーがすべてのリアクションを再生します。何も読み書きしません。/quest on で実際のデータに戻ります。',
    unknownMode: (asked) =>
      `不明なモード「${asked}」です。/quest off、/quest on、/quest zen、/quest demo のいずれかを使用してください。`,
    moreAllies: (count) => `ほか ${count} 件`,
    myReviews: (kind, count) => `自分の${kind} ${count}`,
    todo: (count) => `ToDo ${count}`,
    actionsHeading: 'アクション',
    sentToLead: (label) => `リードに送信しました: ${label}`,
    couldNotSend: (label) => `${label} を送信できませんでした`,
    actionRunning: '実行中…',
    demoAction: (label) => `デモ: ${label} は実行されません`,
    todoHeadings: {
      in_progress: '進行中',
      review: 'QA / レビュー',
      todo: 'ToDo',
      backlog: 'バックログ',
      other: 'その他'
    },
    qa: (count) => `QA ${count}`,
    workOn: (id) => `${id} に取り組む`
  }
}
