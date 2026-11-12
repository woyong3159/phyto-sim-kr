# SPEC — 누적 사양

헌법(CLAUDE.md)이 최상위 문서다. 이 문서는 "실제로 구현된 것"만 누적 기록한다.

## Phase 0 (v0.1.0)

### 폴더 구조
```
CLAUDE.md              헌법
data/*.json            파라미터 20개 파일(지금은 빈 뼈대, 태그 프로토콜 검사기 적용)
src/engine/            순수 엔진(UI·브라우저 의존성 없음)
  types.ts             상태·조치·모듈 타입
  rng.ts               결정론적 난수(sfc32, 영역별 흐름)
  time.ts              시계·달력(KST, 1시간 스텝)
  hash.ts              상태 지문(fingerprint)
  params.ts            데이터 태그 프로토콜 타입·검사기
  modules.ts           14개 모듈 등록과 스텝 내 계산 순서(time만 구현, 나머지 스텁)
  index.ts             createInitialState / stepHour / runTo / replay
src/sim/               엔진 실행기(Web Worker)와 세션(저장·생명주기 연결)
src/storage/           IndexedDB 계층, 세이브 스키마·마이그레이션, 내보내기/불러오기
src/pwa/               서비스 워커 등록, "새 버전 적용" 안내
src/ui/                React 화면(타이틀, 탭바, 자리표시 화면, 더보기)
tests/unit/            Vitest
tests/e2e/             Playwright(iPhone 14 에뮬레이션)
.github/workflows/     검증 + GitHub Pages 자동 배포
```

### 엔진 계약
- `state(t+1h) = stepHour(state(t), config, 그 시각의 조치)` — 순수 함수, 입력 상태를 바꾸지 않는다.
- 스텝 내 순서: events → weather → control → greenhouse → rootzone → crop → physiology → protection → labor → market → economy → ledger → time.
- `SimState`는 JSON 직렬화 가능한 순수 데이터. 난수 상태도 그 안에 들어 있어 스냅샷에서 그대로 이어진다.
- 엔진 안에서 `Math.random`, `Date.now`, DOM, IndexedDB 사용 금지(테스트로 강제).

### 세이브(이벤트 소싱)
- 세이브 = `config(seed, 시작일)` + `actions(사용자 조치 로그)` + `hour(마지막 시각)`. 스키마 버전 v1.
- 스냅샷: 게임 시간 7일마다 상태 전체 + 지문 저장.
- 다시 열기: 저장 시각 이하의 가장 최근 스냅샷에서 조치 로그를 재생해 저장 시각까지 복원.
- 저장 시점: 5초 주기(변화가 있을 때), 정지할 때, 화면이 가려질 때(visibilitychange/pagehide).
- 내보내기: gzip JSON(`.physim.gz`), 공유 시트 우선·다운로드 대체. 불러오기는 기존 세이브를 덮어쓰지 않는다.
- 마이그레이션: 읽을 때 `migrateSave`가 버전을 단계별로 끌어올린다. 더 새 버전의 세이브는 지우지 않고 열기를 거부한다.

### IndexedDB 저장소
`saves`, `snapshots`, `ledgerHourly`, `ledgerDaily`, `reports`, `checkpoints`, `kv` (DB v1). 버전을 올릴 때 저장소는 추가만 한다.

### 실행기
- 배속: 정지 / 1일·초 / 7일·초 / 30일·초. 화면 갱신 메시지는 초당 최대 10회.
- 백그라운드 복귀 직후 밀린 시간을 한꺼번에 계산하지 않는다(게임 시간은 화면이 열려 있을 때만 흐른다).

### 화면
- 기준 390×844pt 세로, 안전 영역(safe-area-inset) 반영, 다크 모드, 터치 영역 ≥ 44pt, 호버 의존 없음.
- 타이틀(대시보드 탭): 작물 3종 예고, 엔진 시계 시험, 시스템 점검(엔진·저장소·오프라인·홈 화면 앱).
- 환경 / 근권·양액 / 작물 / IPM: 자리표시 화면(숫자 없음).
- 더보기: 세이브 내보내기·불러오기, 엔진 모듈 현황, 앱 정보.

### PWA
- manifest(standalone, 세로, 아이콘 192/512/maskable + apple-touch-icon 180), 서비스 워커로 전체 파일 사전 저장(precache).
- 업데이트는 자동 교체하지 않고 "새 버전 적용" 배너로 안내.

### 산출물
- 주: `dist/` (PWA) — GitHub Actions가 테스트 후 GitHub Pages에 배포.
- 보조: `dist-single/index.html` (단일 파일, 서비스 워커 없음).
