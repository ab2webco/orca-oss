import type { GameCatalog } from '../game-strings'

// No `art`: a Raster cannot draw characters two columns wide, so the pixel art stays English.
export const KO: GameCatalog = {
  text: {
    panel: '패널',
    refresh: '새로고침',
    petClawd: 'Clawd 쓰다듬기',
    close: '닫기',
    view: '보기',
    fleet: '플릿',
    team: '팀',
    loading: '로드 중…',
    refreshing: '(새로고침 중)',
    unavailable: 'orca game state를 사용할 수 없음',
    lead: '리드',
    reviewHeading: '리뷰',
    workItemHeading: '작업 항목',
    needsYou: '확인 필요:',
    waitingNeed: '응답 대기 중',
    ciFailingNeed: 'CI 실패',
    teammates: (count) => `팀원 ${count}명`,
    working: (count) => `작업 중 ${count}`,
    idle: (count) => `대기 ${count}`,
    done: (count) => `완료 ${count}`,
    waiting: (count) => `응답 대기 ${count}`,
    agentStates: { working: '작업 중', idle: '대기', done: '완료', waiting: '! 응답 대기' },
    reviewStates: { open: '열림', draft: '초안', merged: '병합됨', closed: '닫힘' },
    ciWords: {
      success: '통과',
      failure: '실패',
      pending: '실행 중',
      neutral: '중립',
      none: '없음'
    },
    couldNotOpen: (name) => `${name}의 패널을 열 수 없습니다`,
    openHeading: '열기',
    couldNotOpenLink: (label) => `${label}을(를) 열 수 없습니다`,
    merged: (review) => `${review} 병합됨`,
    ciGreen: (review) => `${review} CI 통과`,
    questDescription: 'Quest 모드: 움직이는 Claude, 흐름 단계별 캐릭터 카드, 조용한 도구 행',
    questModesHelp:
      '/quest off는 모두 표시하고, /quest on은 도구 행을 숨기고, /quest zen은 작업 메모도 숨기며, /quest demo는 스크립트로 짜인 가상 파티를 재생합니다.',
    questShown: (mode) => `Quest: ${mode}.`,
    questDemo:
      'Quest: demo. 스크립트로 짜인 가상 파티가 모든 반응을 재생합니다. 아무것도 읽거나 쓰지 않습니다. /quest on으로 실제 데이터로 돌아갑니다.',
    unknownMode: (asked) =>
      `알 수 없는 모드 "${asked}"입니다. /quest off, /quest on, /quest zen 또는 /quest demo를 사용하세요.`,
    moreAllies: (count) => `외 ${count}개`
  }
}
