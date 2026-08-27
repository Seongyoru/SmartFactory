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
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, SRC, group, readSrc, t } from './_harness.mjs';

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
const mac1 = await analyze('public/models/Machine_1.glb');
const linkSrc = await readSrc('core/link.js');

/**
 * 모서리로 급전하는 설비 — 유입부가 **두 면에** 있다.
 *  모델링 규약이 허용하는 모양인데, 접미사를 떼면 둘 다 `PORT_IN` 이 된다.
 *  실제 GLB 에는 아직 이런 모델이 없으므로 여기서 세워 확인한다.
 */
const clash = (() => {
  const root = new THREE.Object3D();
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), new THREE.MeshBasicMaterial());
  root.add(box);
  for (const [nm, x, z] of [['PORT_IN@X-', -1, 0], ['PORT_IN@Z+', 0, 1]]) {
    const n = new THREE.Object3D();
    n.name = nm;
    n.position.set(x, 0.5, z);
    root.add(n);
  }
  root.updateMatrixWorld(true);
  return P.analyzeModel(root);
})();
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

/* ---------- 포트 이름 ------------------------------------------------------ *
 *  이름은 GLB 노드 이름 그대로였다 — `PORT_IN@Z+1`. 방향 접미사는 읽는 쪽에
 *  필요한 것이지 사람이 볼 이름은 아니다. 읽는 일은 그대로 두고 이름만 걷어낸다.
 * -------------------------------------------------------------------------- */

t('방향 접미사를 걷어낸다 — 번호는 남긴다', () => {
  assert.equal(P.simplifyPortId('PORT_IN@Z+'), 'PORT_IN');
  assert.equal(P.simplifyPortId('PORT_OUT@Z-'), 'PORT_OUT');
  assert.equal(P.simplifyPortId('PORT_IN@Z+1'), 'PORT_IN_1');
  assert.equal(P.simplifyPortId('PORT_IN@Z+2'), 'PORT_IN_2');
  assert.equal(P.simplifyPortId('PORT_OUT@X-3'), 'PORT_OUT_3');
});

t('접미사가 없으면 그대로 둔다 — 아무 이름에나 항등이다', () => {
  assert.equal(P.simplifyPortId('PORT_IN'), 'PORT_IN');
  assert.equal(P.simplifyPortId('PORT_OUT_2'), 'PORT_OUT_2');
  assert.equal(P.simplifyPortId('o'), 'o');
  assert.equal(P.simplifyPortId(''), '');
  assert.equal(P.simplifyPortId(null), '');
});

t('실제 모델이 단순한 이름을 낸다', () => {
  assert.deepEqual(mac1.ports.map((p) => p.id), ['PORT_IN', 'PORT_OUT']);
  assert.deepEqual(asm.ports.map((p) => p.id), ['PORT_IN_2', 'PORT_IN_1', 'PORT_OUT']);
});

t('**방향은 그대로 읽는다** — 이름만 걷어냈지 읽기를 끈 게 아니다', () => {
  /* 접미사를 진짜로 지워 버리면 방향은 형상에서 짐작하게 되고, 이름과 형상이
     어긋났을 때 울어 주던 경고가 죽는다. 그 경고가 뒤집힌 포트를 한 번 잡았다. */
  const m1 = mac1.ports;
  assert.deepEqual(m1.find((p) => p.id === 'PORT_IN').dir, [0, 1]);
  assert.deepEqual(m1.find((p) => p.id === 'PORT_OUT').dir, [0, -1]);
});

t('옛 이름을 잃지 않는다 — 이미 그린 도면이 그 이름으로 가리킨다', () => {
  assert.deepEqual(asm.ports.map((p) => p.raw),
    ['PORT_IN@Z+2', 'PORT_IN@Z+1', 'PORT_OUT@Z-']);
});

t('**겹치면 원래 이름을 쓴다** — 뭉개서 가리키는 것보다 낫다', () => {
  /* 모서리로 급전하는 설비: PORT_IN@X- 와 PORT_IN@Z+ 는 둘 다 PORT_IN 이 된다.
     뭉개면 벨트가 늘 첫 번째에만 붙고 둘째는 있는데 못 쓰는 포트가 된다. */
  assert.equal(P.simplifyPortId('PORT_IN@X-'), P.simplifyPortId('PORT_IN@Z+'),
    '이 둘이 안 겹치면 아래 검사의 전제가 무너진 것이다');
  assert.deepEqual(clash.ports.map((p) => p.id).sort(), ['PORT_IN@X-', 'PORT_IN@Z+']);
});

t('옛 이름으로도 포트를 찾는다 — 도면이 안 깨지게', () => {
  assert.match(linkSrc, /ports\.find\(\(p\) => p\.raw === ep\.portId\)/,
    '옛 이름으로 찾는 길이 없다 — 벨트가 조용히 유입부에 붙는다');
});
