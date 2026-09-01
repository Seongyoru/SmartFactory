/**
 * =============================================================================
 *  벨트 위를 흐르는 반송물
 * =============================================================================
 *  설비가 유출부로 내보낸 자재가 컨베이어를 타고 다음 설비로 들어간다.
 *
 *  자리 계산과 재료 셈은 `core/belt.js` 가 한다 — 라인의 처리량을 정하는 값이라
 *  그림에서 떼어 놓아야 값으로 확인할 수 있다. 여기서는 그 결과를 **그리기만**
 *  한다: 슬롯은 미리 만들어 두고 위치만 옮기며, 빈칸이거나 벨트 밖으로 나간 것은
 *  숨긴다 — 생성·소멸 비용이 아예 없다.
 *
 *  ── 서는 것과 마르는 것은 다르다 ──────────────────────────────────────────
 *   running  벨트 자체가 도는가.  **보낼 곳이 없을 때만** false 다(종점이 가득 참).
 *            이때는 위에 있던 물건도 그 자리에 멈춘다.
 *   feeding  앞 설비가 지금 내보낼 수 있는가. 고장·무인·굶음이면 false —
 *            **벨트는 계속 돌고** 앞머리만 비어 간다. 이미 올라탄 물건은 끝까지
 *            가서 다음 설비나 적치대로 들어간다.
 *
 *  움직임은 useFrame 안에서 행렬만 만진다. 프레임마다 리렌더를 걸면 같은 씬의
 *  컨베이어 지오메트리까지 덩달아 다시 계산된다.
 * ---------------------------------------------------------------------------
 */

import * as THREE from 'three';
import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { cloneScene, useModelSpec } from '../core/modelStore.js';
import { usePayloadSpecs } from '../core/payload.js';
import { simStep } from '../core/clock.js';
import { beltCount, beltFull, beltHas, beltHeld, beltKind, beltLoad, beltOffset, makeBelt } from '../core/belt.js';
import { runBelt } from '../core/sim.js';
import { forgetBelt, setBeltFull } from '../core/simStore.js';
import { PAYLOAD_ITEM } from '../data/library.js';

/**
 * @param payload 이 벨트에 흐르는 반송물. 설비마다 만들어 내는 물건이 다르므로
 *                무엇이 흐를지는 **내보내는 설비**가 정한다(library 의 payload).
 */
export default function BeltItems({
  /** 이 벨트의 연결 uid — 「다 찼나」를 정지 판정에 돌려줄 때 쓴다 */
  uid = null,
  path,
  speed = 0.6,
  gap = 3,
  layers = 1,
  running = true,
  feeding = true,
  onArrive = null,
  /**
   * 한 덩어리가 벨트에 **올라탈** 때. 몇 덩어리가 올라탈지 넘기고, 실제로
   * 만들어진 덩어리 수를 돌려받는다(조립 설비가 재료를 내는 자리).
   * 돌려받지 못한 몫은 **빈칸**으로 지나간다 — 벨트를 세우지 않는다.
   */
  onSpawn = null,
  payload = PAYLOAD_ITEM,
}) {
  const spec = useModelSpec(payload);
  const specOf = usePayloadSpecs();
  /* 콜백은 매 렌더 새로 오므로 ref 로 잡아 둔다 — useFrame 을 다시 걸지 않기 위해 */
  const arriveRef = useRef(onArrive);
  arriveRef.current = onArrive;
  const spawnRef = useRef(onSpawn);
  spawnRef.current = onSpawn;
  const feedRef = useRef(feeding);
  feedRef.current = feeding;
  const slotsRef = useRef([]);

  const step = Math.max(0.4, gap);
  const count = useMemo(() => beltCount(path?.length ?? 0, step), [path, step]);

  /** 규격 하나로 한 덩어리(= 여러 층)를 세운다 */
  const stackOf = (sp) => {
    const h = sp.bbox.size[1] || 0.3;
    const n = Math.max(1, layers);
    const group = cloneScene(sp);
    group.position.set(0, 0, 0);
    /* 0층은 group 자신이라 목록에 없다. **children 을 층 번호로 쓰면 안 된다** —
       cloneScene 은 사본 하나를 통째로 주므로 자식을 이미 달고 온다. */
    const tiers = [];
    for (let i = 1; i < n; i++) {
      const layer = cloneScene(sp);
      layer.position.y = i * h;
      group.add(layer);
      tiers.push(layer);
    }
    group.userData.tiers = tiers;
    return group;
  };

  /**
   * 칸마다 그릇 하나. 그 안에 **종류별 사본**이 들어간다.
   * ---------------------------------------------------------------------------
   *  칸은 최대 60개, 한 벨트에 흐를 수 있는 종류는 최대 8가지(양품 4 + 불량 4)다.
   *  전부 미리 만들면 480 덩어리가 되는데, 실제로 흐르는 종류는 보통 한둘이다.
   *  그래서 **그 칸에 그 종류가 처음 실릴 때** 만들어 붙인다.
   *
   *  안 보이는 것은 드로우콜이 안 나가고, 지오메트리·재질은 `cloneScene` 이
   *  공유하므로 사본이 늘어도 메모리는 거의 안 는다.
   */
  const slots = useMemo(() => {
    if (!spec || count === 0) return [];
    return Array.from({ length: count }, () => ({ shell: new THREE.Group(), made: new Map() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, count, layers]);

  /* 매 프레임 고리 안에서 쓴다 — 훅을 다시 걸지 않으려고 ref 로 잡아 둔다 */
  const specOfRef = useRef(specOf);
  specOfRef.current = specOf;
  const stackOfRef = useRef(stackOf);
  stackOfRef.current = stackOf;

  /* 칸 수·간격·층수가 바뀌면 줄을 처음부터 다시 세운다 (반쯤 걸친 물건이 남지 않도록) */
  const belt = useMemo(() => makeBelt(count, layers), [count, step, layers]);
  useEffect(() => { slotsRef.current = slots; }, [slots]);
  /* 벨트가 사라지면 지운다 — 안 지우면 없는 벨트가 영영 「다 찼다」로 남아
     그 자리의 설비가 계속 막힌 것으로 잡힌다 */
  useEffect(() => () => forgetBelt(uid), [uid]);

  useFrame((_, dt) => {
    const list = slotsRef.current;
    if (!path || !list.length) return;
    const L = path.length;

    /* 굴리는 일은 core/sim.js 가 한다 — 화면 없이도 같은 함수가 돈다 */
    if (running) {
      const got = runBelt(belt, {
        speed, step, length: L, layers,
        feeding: feedRef.current,
        spawn: spawnRef.current,
        /* 옛 도면(품종 하나)에서는 줄의 이름표를 쓴다 */
        kind: payload?.id ?? null,
      }, simStep(dt));
      /**
       * **종류별로** 넘긴다 — 같은 벨트 위에 두 품종이 앞뒤로 흐른다.
       *  벨트 상태도 같이 준다 — 축적형 벨트는 못 내린 것을 **끝에 쌓아** 두고
       *  다음 프레임에 먼저 내린다(belt.js 의 held). 쌓아 둔 것이 있으면
       *  이번에 도착한 것이 없어도 불러야 한다.
       */
      if (got.n > 0 || beltHeld(belt)) arriveRef.current?.(got.byKind ?? {}, belt);

      /**
       * **쌓인 것이 한도에 닿았나** — 정지 판정에 돌려준다.
       *  축적형 벨트는 이 값이 참일 때만 선다. 화면은 벨트 상태를 여기서만
       *  들고 있어서, 안 돌려주면 `haltState` 가 영영 「안 찼다」로 보고
       *  그 벨트가 **영영 안 선다**(simStore 의 setBeltFull 참고).
       *  뒤집힐 때만 알리므로 매 프레임 불러도 리렌더가 안 돈다.
       */
      setBeltFull(uid, beltFull(belt));
    }

    const head = beltOffset(belt, step);
    for (let k = 0; k < list.length; k++) {
      const slot = list[k];
      const g = slot.shell;
      const s = head + k * step;
      /**
       * **둘을 따로 묻는다** — 「있나」와 「무엇인가」.
       *  `beltHas` 는 `st.fill` 을, `beltKind` 는 `st.kinds` 를 본다. 색인은 같지만
       *  보는 배열이 달라서, 물건은 있는데 이름표가 빈 칸이 생길 수 있다.
       *  이름표 하나로 둘을 겸하면 그런 칸의 물건이 **통째로 사라진다.**
       */
      if (s > L || !beltHas(belt, k)) { g.visible = false; continue; }
      /* 이름표가 없는 칸(옛 도면·한 품종)은 줄에 준 payload 로 그린다 —
         「무엇인지 모르겠다」가 「없다」가 되면 물건이 통째로 사라진다 */
      const kind = beltKind(belt, k) ?? payload?.id ?? null;

      /* 이 칸에 이 종류가 **처음** 실렸으면 그때 만든다 */
      let obj = slot.made.get(kind);
      if (obj === undefined) {
        const sp = specOfRef.current?.(kind);
        obj = sp ? stackOfRef.current(sp) : null;
        if (obj) g.add(obj);
        slot.made.set(kind, obj);           // 규격이 없으면 null 을 담아 다시 안 만든다
      }
      /* 이번 종류만 보이게 — 나머지는 그대로 두고 끈다(다시 만들지 않는다) */
      for (const [k2, o] of slot.made) if (o) o.visible = (k2 === kind);
      if (!obj) { g.visible = false; continue; }

      /**
       * **실린 개수만큼만** 세운다.
       *  덩어리가 늘 꽉 차지는 않는다 — 로트 4개를 3개씩 내보내면 `3 + 1` 로
       *  나뉘고, 품종이 바뀌는 자리와 불량품이 끼는 자리마다 자투리가 생긴다.
       *  늘 층 수만큼 그리면 1개 실린 칸이 3단으로 보이고, 그것이 적치대에
       *  1개로 들어가니 「두 개가 사라졌다」로 읽힌다. 사라진 것은 없다 —
       *  **그림이 거짓말을 한 것이다.**
       */
      const load = beltLoad(belt, k);
      const tiers = obj.userData.tiers;
      if (tiers) for (let i = 0; i < tiers.length; i++) tiers[i].visible = load >= i + 2;

      const f = path.at(s);
      g.visible = true;
      g.position.set(f.pos[0], f.pos[1], f.pos[2]);
      g.rotation.y = Math.atan2(f.tan[0], f.tan[1]);   // 모델 +Z 를 진행 방향으로
    }
  });

  if (!slots.length) return null;
  return (
    <group>
      {slots.map((slot, i) => (
        <primitive key={i} object={slot.shell} />
      ))}
    </group>
  );
}
