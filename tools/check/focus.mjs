/**
 * 카메라 궤도 — 「손볼 곳」 을 눌렀을 때 어디에 서서 어떻게 도는가.
 *  화면에서만 보이는 종류라 값으로라도 확인해 둔다. 처음에는 **보던 각도 그대로**
 *  돌렸는데, 거의 위에서 내려다보고 있으면 화면이 그냥 빙빙 돌고 바닥에 붙어
 *  있으면 설비에 얼굴을 박고 도는 그림이 됐다.
 */
import assert from 'node:assert/strict';
import { SRC, group, t } from './_harness.mjs';

group('카메라 궤도');

const F = await import(SRC + 'core/focusStore.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const distOf = (p, c) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
/** 바닥에서 올려다본 각 */
const pitchOf = (p, c) => Math.atan2(p[1] - c[1], Math.hypot(p[0] - c[0], p[2] - c[2]));

const T = [3, 0, -5];

t('어느 방위각에서든 대상과의 거리가 같다', () => {
  for (let i = 0; i < 12; i++) near(distOf(F.orbitPose(T, (i * Math.PI) / 6), T), F.LOOK_DIST, 1e-9);
});
t('어느 방위각에서든 올려다보는 각이 같다', () => {
  for (let i = 0; i < 12; i++) near(pitchOf(F.orbitPose(T, (i * Math.PI) / 6), T), F.LOOK_PITCH, 1e-9);
});
t('대상보다 항상 위에 선다 — 바닥을 뚫지 않는다', () => {
  for (let i = 0; i < 12; i++) assert.ok(F.orbitPose(T, (i * Math.PI) / 6)[1] > T[1]);
});
t('대상을 옮기면 궤도도 통째로 따라간다', () => {
  const a = F.orbitPose([0, 0, 0], 1.2);
  const b = F.orbitPose([10, 0, -4], 1.2);
  near(b[0] - a[0], 10);
  near(b[2] - a[2], -4);
});

/* ---------- 방위각은 지금 보고 있는 쪽을 그대로 쓴다 ---------- */
t('서 있던 쪽을 유지한다 — 되돌리면 화면이 크게 튄다', () => {
  for (const az of [0, 0.7, -2.1, Math.PI - 0.01]) {
    const p = F.orbitPose(T, az);
    near(F.orbitAzimuth(p, T), az, 1e-9);
  }
});
t('높이는 방위각에 안 섞인다 — 위에서 보든 아래서 보든 같은 쪽', () => {
  const low = [T[0] + 5, T[1] + 0.2, T[2]];
  const high = [T[0] + 5, T[1] + 90, T[2]];
  near(F.orbitAzimuth(low, T), F.orbitAzimuth(high, T));
});
t('정확히 위에서 내려다보고 있으면 0 으로 둔다 (0으로 나누지 않는다)', () => {
  assert.equal(F.orbitAzimuth([T[0], T[1] + 20, T[2]], T), 0);
});

/* ---------- 천천히, 계속 ---------- */
t('한 바퀴에 20초쯤 — 눈에 띄되 성가시지 않게', () => {
  const sec = (Math.PI * 2) / F.ORBIT_RATE;
  assert.ok(sec > 15 && sec < 25, `한 바퀴 ${sec.toFixed(1)}초`);
});
t('돌아도 각과 거리는 안 변한다 (한 바퀴를 굴려 본다)', () => {
  let az = F.orbitAzimuth([T[0] + 3, T[1] + 40, T[2] + 3], T);   // 거의 위에서 시작
  for (let i = 0; i < 1200; i++) {
    az += F.ORBIT_RATE * (1 / 60);
    const p = F.orbitPose(T, az);
    near(distOf(p, T), F.LOOK_DIST, 1e-9);
    near(pitchOf(p, T), F.LOOK_PITCH, 1e-9);
  }
});
t('20초면 한 바퀴를 넘긴다', () => {
  const az0 = 0;
  const az = az0 + F.ORBIT_RATE * 20;
  assert.ok(az > Math.PI * 1.9, `20초에 ${(az / Math.PI).toFixed(2)}π 밖에 못 돌았다`);
});

/* ---------- 요청 ---------- */
t('같은 자리를 다시 눌러도 다시 움직인다 (일련번호가 는다)', () => {
  const got = [];
  const off = F.subscribeFocus((r) => got.push(r));
  F.focusOn([1, 2]);
  F.focusOn([1, 2], { look: true });
  off();
  assert.equal(got.length, 2);
  assert.ok(got[1].seq > got[0].seq);
  assert.equal(got[0].look, false);
  assert.equal(got[1].look, true);
});
