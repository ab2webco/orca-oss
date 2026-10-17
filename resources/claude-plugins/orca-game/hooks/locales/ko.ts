import type { GameCatalog } from '../game-strings'

// No `art`: a Raster cannot draw characters two columns wide, so the pixel art stays English.
export const KO: GameCatalog = {
  text: {
    panel: '패널',
    refresh: '새로고침',
    pet: '쓰다듬기',
    petNamed: (name) => `${name} 쓰다듬기`,
    advisor: '어드바이저',
    advisorMain: '메인 대화',
    advisorEmpty: '아직 결정이 없습니다',
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
    moreAllies: (count) => `외 ${count}개`,
    myReviews: (kind, count) => `내 ${kind} ${count}`,
    todo: (count) => `할 일 ${count}`,
    actionsHeading: '액션',
    sentToLead: (label) => `리드에게 보냈습니다: ${label}`,
    couldNotSend: (label) => `${label}을(를) 보낼 수 없습니다`,
    actionRunning: '실행 중…',
    demoAction: (label) => `데모: ${label}은(는) 실행되지 않습니다`,
    todoHeadings: {
      in_progress: '진행 중',
      review: 'QA / 리뷰',
      todo: '할 일',
      backlog: '백로그',
      other: '기타'
    },
    qa: (count) => `QA ${count}`,
    workOn: (id) => `${id} 작업하기`,
    leadActions: {
      wave: '웨이브',
      status: '상태',
      push: '재개',
      sweep: '정리',
      stop: '중지'
    },
    actionCommandDescription: (label) => `Orca 작업: ${label}`,
    actionCommandRefused: (command) =>
      `/${command}은(는) 다른 명령이 사용 중입니다. 밴드나 패널의 버튼을 사용하세요`,
    actionCommandGone: (command) => `/${command}은(는) 더 이상 이 프로젝트의 작업이 아닙니다`,
    limited: (backIn) => (backIn === null ? '사용 한도' : `사용 한도 · ${backIn} 후 복귀`)
  }
}
