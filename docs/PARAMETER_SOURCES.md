# PARAMETER_SOURCES — 파라미터 출처 누적

규칙(헌법 4항 N8, 8항): 존재하지 않는 논문·URL·통계는 적지 않는다. 확인하지 못한 값은 EST와 추정 논리를 적는다.
개별 파라미터의 값·범위·note는 `/data/*.json`에 있고, 여기에는 출처와 확인 방법을 모은다.

## Phase 1 집계
| 파일 | SRC | EST | 비고 |
|---|---|---|---|
| climate.json | 207 | 54 | 월별 12개 묶음을 1건으로 셈. SRC = 29지점 × 7요소 + 생성기 4 |
| regions.json | 0 | 116 | 위도·경도·표고·태풍 가중치(29지점 × 4) |
| events.json | 11 | 12 | 특보 기준·장마·태풍 = SRC, 우박·태풍 강도 = EST |
| 합계 | 218 | 182 | CAL 0, USER 0 |

## SRC

### 기후 평년값 (climate.json → normals)
- 원출처: 기상청 기후평년값(1991–2020).
- 입수 경로: 영어 위키백과 각 도시 문서의 기후표(출처 표기 Korea Meteorological Administration), 2026-11-12 열람.
  Seoul, Incheon, Suwon, Icheon, Chuncheon, Wonju, Cheorwon_County, Daegwallyeong, Taebaek, Gangneung, Sokcho, Cheongju, Chungju, Daejeon,
  Cheonan, Seosan, Buyeo_County, Jeonju, Gwangju, Mokpo, Yeosu, Daegu, Andong, Pohang, Busan, Jinju, Miryang, Jeju_City, Seogwipo
  (주소: https://en.wikipedia.org/wiki/<문서명>)
- 요소: 월평균 일최고·평균·일최저기온, 강수량, 강수일수(≥0.1 mm), 상대습도, 일조시간.
- 교차 확인
  1. 내부 검산: 29지점 × 7요소 전부에서 12개월 값의 합(또는 일수 가중 평균)이 표의 연값과 일치(`tools/build-climate.mjs`).
  2. 기상청 보도자료 "신 기후평년값(1991~2020)" 관련 기사: 청주 연평균기온 13.1°C — 일치.
  3. 대구 6월: 기상청 인용 기사 평균 23.2 / 최고 28.6°C vs 본 자료 23.4 / 28.7°C — 0.1–0.2°C 차이(원인 미확인).
- 한계: 원자료 직접 대조 아님. 독립된 2개 출처 교차 확인 요건은 일부 요소·지점에서만 충족.

### 극한 기상 (events.json)
- 영향 태풍 수 평년(1991–2020) 6월 0.3, 7월 1.0, 8월 1.2, 9월 0.8, 10월 0.1, 연 3.4: 기상청 날씨누리 태풍발생현황 통계(검색으로 확인).
- 장마 시작일 평년(1991–2020) 제주 6/19, 남부 6/23, 중부 6/25, 제주 종료 7/20: 검색으로 확인(다수 보도, 위키백과 "장마").
- 폭염일수(일최고 ≥33°C)·한파일수(아침 최저 ≤−12°C) 정의, 폭염경보 35°C, 한파경보 −15°C, 대설주의보 5 cm·경보 20 cm: 기상청 특보 기준(학습 지식, 정의는 보도자료로 확인).
- 전국 평년 폭염일수 약 10.6일: 기상청 2025년 여름철 기후특성 보도 "28.1일, 평년보다 17.5일 많음"에서 역산(검증 참고값으로만 사용).

### 모델 계수
- Parton, W.J. & Logan, J.A. (1981). A model for diurnal variation in soil and air temperature. Agricultural Meteorology 23:205–216. — a=1.86, b=2.20, c=−0.17(150 cm 기온). 검색으로 계수 확인.
- Allen, R.G. et al. (1998). FAO Irrigation and Drainage Paper 56. — Ra(식 21), 청천 일사 Rso=(0.75+2e-5 z)Ra(식 37), 포화수증기압(식 11).
- Spencer, J.W. (1971). Fourier series representation of the position of the sun. Search 2(5):172. — 적위·균시차·거리 보정 계수(학습 지식).

## EST (근거는 각 파라미터의 note)
- 일사: Ångström–Prescott a=0.25, b=0.50 (FAO-56 기본값). **원자료 확보 시 최우선 교체.**
- 풍속: 지점별 연평균(학습 지식) × 계절 배율. **원자료 확보 시 교체.**
- 기온 편차 σ(월별)·기후형 배율, AR 계수(0.65 / 0.90), 저빈도 분산 몫 0.12.
- 강수 연속성 r=0.25 — Geng, S., Penning de Vries, F.W.T. & Supit, I. (1986). Agricultural and Forest Meteorology 36:363–376 의 경험식 P(wet|dry)=0.75·π 와 같은 값. 장마 중 0.45는 추정.
- Weibull 형상(강수 0.75, 풍속 2.0), 비 오는 날 효과(일사 0.4, 습도 +10, 일교차 0.65, 기온 보정), 적설비, 눈/비 판정 기온.
- 장마 종료일 남부 7/24·중부 7/26(학습 지식), 장마 시기 변동폭, 태풍 강수·강풍 배율, 지점별 태풍 가중치, 우박 빈도, 호우 일강수 기준.
- 관측소 위도·경도·표고(학습 지식).

## CAL
- 데이터 파일에는 없음. 코드 수준 보정 2건(SPEC 참조): Parton–Logan 형상 지수 γ(일평균을 평년 평균기온에 맞춤), 야간 감쇠 정규화.
