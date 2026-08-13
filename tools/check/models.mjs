/**
 * 배포되는 모델(`public/models/*.glb`)이 코드가 기대하는 모양인가.
 * ---------------------------------------------------------------------------
 *  포트는 **모델 노드 이름에서** 읽는다. 그래서 모델을 갈아 끼우면 코드를 한 줄도
 *  안 고쳐도 연결이 통째로 달라진다 — 조용히, 빌드도 통과한 채로. 조립기의 유입구를
 *  둘로 늘린 것이 딱 그런 변경이었다.
 *
 *  그리고 `GLB_model/` 에만 올려 두고 `public/models/` 로 옮기는 것을 잊으면
 *  **앱은 옛 모델을 계속 쓴다.** 실제로 그랬다 — 그것도 여기서 잡는다.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, SRC, group, t } from './_harness.mjs';

group('배포 모델');

/* three 의 GLTFLoader 는 브라우저 전역을 본다 — 노드에서 돌리려면 하나만 빌려 준다 */
globalThis.self = globalThis;

/**
 * 텍스처 경고만 걸러 낸다.
 *  노드에는 blob URL 이 없어 그림만 못 읽는다 — 포트·치수는 멀쩡하다. 다만 이
 *  경고가 **로더 안에서 나중에** 나와서 검사 출력 한가운데에 끼는데, 그러면 진짜
 *  실패가 묻힌다. 통째로 막지 않고 이 문구만 지운다.
 */
for (const k of ['warn', 'error']) {
  const orig = console[k];
  console[k] = (...a) => {
    if (typeof a[0] === 'string' && a[0].includes('GLTFLoader') && a[0].includes('texture')) return;
    orig(...a);
  };
}
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const P = await import(SRC + 'core/ports.js');
const lib = await import(SRC + 'data/library.js');

const glbJson = async (rel) => {
  const buf = await readFile(path.join(ROOT, rel));
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
};

const analyze = async (rel) => {
  const buf = await readFile(path.join(ROOT, rel));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const scene = await new Promise((res, rej) => {
    new GLTFLoader().parse(ab, '', (g) => res(g.scene), rej);
  });
  return P.analyzeModel(scene);
};

/* 파일 읽기는 **전부 여기서 끝낸다** — `t` 는 동기 전용이고, async 본문을 주면
   기다려 주지 않아 그 안의 assert 가 나중에 터진다(검사는 통과로 세어진다). */
const asm = await analyze('public/models/Machine_2.glb');
const fab = await glbJson('public/models/Machine_1.glb');
const [srcGlb, pubGlb] = await Promise.all([
  readFile(path.join(ROOT, 'GLB_model/Machine_2.glb')),
  readFile(path.join(ROOT, 'public/models/Machine_2.glb')),
]);

t('조립기는 유입구가 **둘**이다', () => {
  const ins = asm.ports.filter((p) => p.kind === 'in');
  assert.equal(ins.length, 2, `유입구가 ${ins.length}개다 — 모델을 확인할 것`);
});
t('유출구는 하나다', () => {
  assert.equal(asm.ports.filter((p) => p.kind === 'out').length, 1);
});
t('두 유입구가 같은 면(Z+)을 보고, 유출은 반대(Z−)를 본다', () => {
  const ins = asm.ports.filter((p) => p.kind === 'in');
  for (const p of ins) assert.deepEqual(p.dir.map(Math.round), [0, 1], `${p.id} 방향이 다르다`);
  const out = asm.ports.find((p) => p.kind === 'out');
  assert.deepEqual(out.dir.map(Math.round), [0, -1]);
});
t('두 유입구는 서로 다른 자리다 — 벨트 두 줄을 물릴 수 있어야 한다', () => {
  const ins = asm.ports.filter((p) => p.kind === 'in');
  assert.notEqual(ins[0].id, ins[1].id, '포트 이름이 같으면 하나로 취급된다');
  assert.ok(Math.hypot(ins[0].pos[0] - ins[1].pos[0], ins[0].pos[2] - ins[1].pos[2]) > 0.5,
    '두 유입구가 겹쳐 있다');
});
t('이름에서 읽은 명시 포트다 (자동 추정이 아니다)', () => {
  assert.equal(asm.hasExplicitPorts, true);
});
t('라이브러리 설명의 치수가 모델과 맞는다', () => {
  const [w, h, d] = asm.bbox.size.map((v) => v.toFixed(2));
  const desc = lib.BUILTIN_LIBRARY.find((i) => i.id === 'MACHINE_2').desc;
  assert.ok(desc.includes(`${w} × ${h} × ${d} m`), `설명이 낡았다: ${desc}`);
});

/* ---------- 올려 둔 것과 배포한 것이 같은가 ---------- */
t('GLB_model 과 public/models 의 조립기가 같은 파일이다', () => {
  assert.ok(srcGlb.equals(pubGlb),
    '새로 올린 모델을 public/models 로 안 옮겼다 — 앱은 옛 모델을 쓴다');
});

/* ---------- 제작기는 그대로인지 (회귀) ---------- */
t('제작기는 유입 하나 · 유출 하나 그대로', () => {
  const names = fab.nodes.map((n) => n.name).filter((n) => /^port/i.test(n ?? ''));
  assert.equal(names.filter((n) => /in/i.test(n)).length, 1);
  assert.equal(names.filter((n) => /out/i.test(n)).length, 1);
});
