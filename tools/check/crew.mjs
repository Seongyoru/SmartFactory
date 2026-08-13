/* crew.js — 교대·배정, 그리고 CSV 만들기 */
import assert from 'node:assert/strict';
import { SRC, group, t } from './_harness.mjs';

group('인력 · 교대 · CSV');

const crew = await import(SRC + 'core/crew.js');
const sc = await import(SRC + 'core/scenarios.js');

/* ---------- normalizeShifts (길이는 분) ---------- */
t('비어 있으면 「상시」 한 조 · 인원 제한 없음', () => {
  const r = crew.normalizeShifts(null);
  assert.equal(r.length, 1);
  assert.equal(r[0].headcount, 0);      // 0 = 안 따진다
  assert.equal(r[0].minutes, 1440);     // 24시간
  assert.deepEqual(crew.normalizeShifts([]), r);
});
t('이름이 비면 번호를 붙인다', () => {
  const r = crew.normalizeShifts([{ minutes: 480, headcount: 3 }, { name: '  ', minutes: 480, headcount: 2 }]);
  assert.deepEqual(r.map((s) => s.name), ['1조', '2조']);
});
t('길이는 10분~24시간으로 자르고, 인원은 음수가 안 된다', () => {
  const r = crew.normalizeShifts([{ minutes: 0, headcount: -5 }, { minutes: 99999, headcount: 3.6 }]);
  assert.equal(r[0].minutes, 480);      // 0 은 뜻이 없으므로 기본 8시간
  assert.equal(r[0].headcount, 0);
  assert.equal(r[1].minutes, 1440);
  assert.equal(r[1].headcount, 4);
  assert.equal(crew.normalizeShifts([{ minutes: 3 }])[0].minutes, 10);   // 하한
});
t('10분 단위를 **강제하지는 않는다** — 손으로 적은 45분은 45분이다', () => {
  assert.equal(crew.normalizeShifts([{ minutes: 45 }])[0].minutes, 45);
});
t('옛 도면의 hours 를 분으로 받아 준다', () => {
  assert.equal(crew.normalizeShifts([{ name: '주간', hours: 8, headcount: 6 }])[0].minutes, 480);
  assert.equal(crew.normalizeShifts([{ hours: 24 }])[0].minutes, 1440);
  /* minutes 가 있으면 그쪽이 이긴다 */
  assert.equal(crew.normalizeShifts([{ hours: 8, minutes: 30 }])[0].minutes, 30);
});
t('분 → 읽히는 문자열', () => {
  assert.equal(crew.shiftLabel(10), '10분');
  assert.equal(crew.shiftLabel(60), '1시간');
  assert.equal(crew.shiftLabel(90), '1시간 30분');
  assert.equal(crew.shiftLabel(480), '8시간');
  assert.equal(crew.shiftLabel(1440), '24시간');
});

/* ---------- shiftAt ---------- */
const S3 = [
  { name: '주간', minutes: 480, headcount: 6 },
  { name: '야간', minutes: 480, headcount: 3 },
  { name: '심야', minutes: 480, headcount: 1 },
];
t('시간에 따라 조가 바뀐다', () => {
  assert.equal(crew.shiftAt(S3, 0).shift.name, '주간');
  assert.equal(crew.shiftAt(S3, 7 * 3600).shift.name, '주간');
  assert.equal(crew.shiftAt(S3, 8 * 3600).shift.name, '야간');
  assert.equal(crew.shiftAt(S3, 16 * 3600).shift.name, '심야');
});
t('하루가 끝나면 처음으로 돌아온다', () => {
  assert.equal(crew.shiftAt(S3, 24 * 3600).shift.name, '주간');
  assert.equal(crew.shiftAt(S3, 33 * 3600).shift.name, '야간');
});
t('이 조가 끝나기까지 남은 시간', () => {
  assert.equal(crew.shiftAt(S3, 0).endsIn, 8 * 3600);
  assert.equal(crew.shiftAt(S3, 3 * 3600).endsIn, 5 * 3600);
});
t('10분 조 둘이면 10분마다 바뀌고 한 바퀴가 20분', () => {
  const S = [{ name: 'A', minutes: 10, headcount: 6 }, { name: 'B', minutes: 10, headcount: 2 }];
  assert.equal(crew.cycleSeconds(S), 1200);
  assert.equal(crew.shiftAt(S, 0).shift.name, 'A');
  assert.equal(crew.shiftAt(S, 599).shift.name, 'A');
  assert.equal(crew.shiftAt(S, 600).shift.name, 'B');
  assert.equal(crew.shiftAt(S, 1200).shift.name, 'A');       // 되풀이
  assert.equal(crew.shiftAt(S, 1800).shift.name, 'B');
});
t('한 바퀴 시간', () => {
  assert.equal(crew.cycleSeconds(S3), 24 * 3600);
  assert.equal(crew.cycleSeconds(null), 24 * 3600);
});

/* ---------- assignCrew ---------- */
const rows = [
  { uid: 'A', need: 2 },
  { uid: 'B', need: 1 },
  { uid: 'C', need: 3 },
  { uid: 'D', need: 0 },    // 무인 설비
];
t('인원 0 = 제한 없음 — 전부 돈다', () => {
  const r = crew.assignCrew(rows, 0);
  assert.equal(r.unlimited, true);
  assert.equal(r.unmanned.size, 0);
  assert.equal(r.manned.size, 4);
  assert.equal(r.need, 6);
});
t('넉넉하면 전부 붙고 남는 사람이 논다', () => {
  const r = crew.assignCrew(rows, 10);
  assert.equal(r.unmanned.size, 0);
  assert.equal(r.used, 6);
  assert.equal(r.idle, 4);
});
t('배치 순서대로 채운다', () => {
  const r = crew.assignCrew(rows, 3);          // A(2) + B(1) = 3, C(3) 는 못 받음
  assert.deepEqual([...r.manned].sort(), ['A', 'B', 'D']);
  assert.deepEqual([...r.unmanned], ['C']);
  assert.equal(r.idle, 0);
});
t('부분 배정은 없다 — 못 채우면 건너뛰고 **다음이 그 사람을 쓴다**', () => {
  const r = crew.assignCrew([{ uid: 'X', need: 3 }, { uid: 'Y', need: 2 }], 2);
  assert.deepEqual([...r.unmanned], ['X']);    // 3 명 필요한데 2 명뿐 → 못 준다
  assert.deepEqual([...r.manned], ['Y']);      // 그 2 명이 Y 로 간다
  assert.equal(r.idle, 0);
});
t('무인 설비(0명)는 사람을 안 쓰고도 돈다', () => {
  const r = crew.assignCrew([{ uid: 'Z', need: 0 }], 0);
  assert.ok(r.manned.has('Z'));
  const r2 = crew.assignCrew([{ uid: 'W', need: 5 }, { uid: 'Z', need: 0 }], 1);
  assert.ok(r2.manned.has('Z'));               // 사람이 모자라도 무인은 돈다
  assert.ok(r2.unmanned.has('W'));
});
t('사람이 아예 없으면(1명) 큰 설비만 못 돈다', () => {
  const r = crew.assignCrew(rows, 1);
  assert.deepEqual([...r.unmanned].sort(), ['A', 'C']);
  assert.ok(r.manned.has('B'));                // 1명짜리는 돈다
});

/* ---------- crewRows / isWorkable ---------- */
t('선반·적치대는 사람이 지키지 않는다', () => {
  assert.equal(crew.isWorkable({ kind: 'shelf' }), false);
  assert.equal(crew.isWorkable({ kind: 'stillage' }), false);
  assert.equal(crew.isWorkable({ id: 'MACHINE_1' }), true);
  assert.equal(crew.isWorkable(null), false);
});
t('배치 순서를 그대로 유지한다', () => {
  const placed = [{ uid: 'p1', crew: 2 }, { uid: 'p2' }, { uid: 'p3', crew: 1 }];
  assert.deepEqual(crew.crewRows(placed, () => true), [
    { uid: 'p1', need: 2 }, { uid: 'p2', need: 0 }, { uid: 'p3', need: 1 },
  ]);
  assert.equal(crew.totalCrewNeed(placed, () => true), 3);
});

/* ---------- CSV ---------- */
t('시나리오 CSV — 머리글과 값', () => {
  const rowsCsv = sc.scenarioCSV([
    { name: '배치 A', at: 0, run: { ran: 300, shipped: 120, throughput: 1440, wip: 12, scrapped: 3,
      oee: 0.8712, availability: 1, performance: 0.9, quality: 0.968,
      neck: { name: '조립기 #1', ratio: 0.31 }, equips: 4 } },
    { name: '아직', at: 0, run: null },
  ]);
  assert.equal(rowsCsv[0][0], '이름');
  assert.equal(rowsCsv[1][0], '배치 A');
  assert.equal(rowsCsv[1][3], '예');                    // 300초 ≥ SHORT_RUN
  /* 숫자는 **가공하지 않고** 넣는다 — 화면은 87% 지만 파일에는 원래 값 */
  assert.equal(rowsCsv[1][8], 0.8712);
  assert.equal(rowsCsv[2][3], '안 돌림');               // 안 돌린 줄도 남는다
});
t('짧게 돌린 기록은 CSV 에도 그렇게 적힌다', () => {
  const r = sc.scenarioCSV([{ name: 'x', at: 0, run: { ran: 10, shipped: 1, throughput: 360, wip: 0,
    scrapped: 0, oee: 1, availability: 1, performance: 1, quality: 1, neck: null, equips: 1 } }]);
  assert.ok(String(r[1][3]).startsWith('아니오'));
  /* 열은 **머리글에서 찾는다.** 자리를 숫자로 박아 두면 열 하나 늘 때마다
     상관없는 검사가 깨진다(원가 열 넷을 넣다가 실제로 겪었다). */
  assert.equal(r[1][r[0].indexOf('병목')], '없음');
});
t('추이 CSV', () => {
  const r = sc.seriesCSV([{ t: 10, shipped: 3 }, { t: 20, shipped: 9 }]);
  assert.deepEqual(r[0], ['시뮬 시간(초)', '누적 출하(개)']);
  assert.deepEqual(r[1], ['10.0', 3]);
  assert.deepEqual(sc.seriesCSV(null), [['시뮬 시간(초)', '누적 출하(개)']]);
});

/* CSV 문자열 만들기는 persistence 안에 있어 브라우저 API 를 탄다 —
   따옴표 규칙만 같은 식으로 다시 세워 확인한다(RFC 4180) */
t('쉼표·따옴표·줄바꿈이 든 이름을 감싼다', () => {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  assert.equal(cell('제작기 #1'), '제작기 #1');
  assert.equal(cell('A,B'), '"A,B"');
  assert.equal(cell('그는 "빠르다"'), '"그는 ""빠르다"""');
  assert.equal(cell('두\n줄'), '"두\n줄"');
  assert.equal(cell(null), '');
});

/* ---------- 시간·분 나눠 받기 ---------- */
t('분 ↔ 시간·분', () => {
  assert.deepEqual(crew.splitHM(420), { h: 7, m: 0 });
  assert.deepEqual(crew.splitHM(90), { h: 1, m: 30 });
  assert.deepEqual(crew.splitHM(10), { h: 0, m: 10 });
  assert.deepEqual(crew.splitHM(1440), { h: 24, m: 0 });
});
t('7 을 시간 칸에 넣으면 420 이 저장된다', () => {
  assert.equal(crew.joinHM(7, 0), 420);
  assert.equal(crew.joinHM(1, 30), 90);
  assert.equal(crew.joinHM(0, 30), 30);
  assert.equal(crew.joinHM(8, 0), 480);
});
t('나눠 넣어도 범위를 벗어나지 않는다', () => {
  assert.equal(crew.joinHM(0, 0), 10);        // 둘 다 0 → 하한
  assert.equal(crew.joinHM(0, 3), 10);        // 3분 → 하한
  assert.equal(crew.joinHM(99, 0), 1440);     // 상한
  assert.equal(crew.joinHM(24, 59), 1440);
  assert.equal(crew.joinHM(-5, -5), 10);      // 음수도 막는다
});
t('빈 칸(문자열)을 넣어도 안 깨진다 — 입력 중에 벌어지는 일이다', () => {
  assert.equal(crew.joinHM('', 30), 30);
  assert.equal(crew.joinHM('7', ''), 420);
  assert.equal(crew.joinHM('abc', 'x'), 10);
});
t('나눴다 합치면 제자리 (10분 단위가 아니어도)', () => {
  for (const m of [10, 45, 90, 420, 480, 719, 1440]) {
    const { h, m: mm } = crew.splitHM(m);
    assert.equal(crew.joinHM(h, mm), m, `${m} 이 안 돌아왔다`);
  }
});

