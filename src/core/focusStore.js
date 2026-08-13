/**
 * 카메라 이동 요청 저장소.
 *  인스펙터·경고 상자(씬 밖)에서 "이거 보여 줘" 라고 말할 수 있어야 한다. 에디터
 *  상태에 넣으면 한 번 보고 지워야 하는 값 때문에 리듀서가 지저분해지고,
 *  같은 대상을 두 번 누르면 아무 일도 안 일어나는 문제가 생긴다.
 *  그래서 커서와 같은 방식의 작은 외부 스토어로 두고, 요청마다 일련번호를 붙여
 *  "같은 좌표를 다시 눌러도 다시 움직이도록" 한다.
 *
 *  ── 그냥 옮기기 · 들여다보기 ─────────────────────────────────────────────
 *  목록에서 고르는 것은 **그냥 옮기면** 된다. 반면 "여기가 문제다" 라고 짚어 준
 *  것을 누른 경우는 어느 것인지 눈에 확 들어와야 한다 — 탑뷰는 당겨서 보고,
 *  3D 는 그 둘레를 한 바퀴 돌아 준다. 그래서 요청에 뜻을 함께 싣는다.
 */

/** 들여다볼 때의 탑뷰 배율 — 설비 한 대가 화면에 크게 잡히는 정도 */
export const LOOK_ZOOM = 46;

/**
 * 3D 로 들여다볼 때의 **표준 자세.**
 * ---------------------------------------------------------------------------
 *  처음에는 보고 있던 각도 그대로 돌렸다. 그런데 거의 위에서 내려다보고 있거나
 *  바닥에 붙어 있으면, 그 각도로 도는 것이 몹시 어색하다 — 위에서는 그냥 화면이
 *  빙빙 돌고, 바닥에서는 설비에 얼굴을 박고 도는 그림이 된다.
 *
 *  그래서 **올려다보는 각과 거리를 정해 두고 거기로 맞춘 뒤에** 돈다. 방위각(어느
 *  쪽에서 보는가)만 지금 것을 그대로 쓴다 — 그건 사용자가 고른 방향이고, 굳이
 *  되돌리면 화면이 크게 튄다.
 */
export const LOOK_PITCH = (32 * Math.PI) / 180;   // 바닥에서 올려다본 각
export const LOOK_DIST = 16;                      // 대상과의 거리(m)
/** 초당 회전 각도 — 천천히. 한 바퀴에 20초쯤 */
export const ORBIT_RATE = (18 * Math.PI) / 180;

/**
 * 대상 `t` 를 중심으로 방위각 `az` 에 섰을 때의 카메라 자리.
 *  각(LOOK_PITCH)과 거리(LOOK_DIST)는 **고정**이고 방위각만 돈다 — 그래서 어디서
 *  시작하든 같은 눈높이로 돌고, 너무 멀거나 가까운 상태도 여기서 함께 교정된다.
 */
export function orbitPose(t, az) {
  const r = LOOK_DIST * Math.cos(LOOK_PITCH);
  return [
    t[0] + Math.sin(az) * r,
    t[1] + LOOK_DIST * Math.sin(LOOK_PITCH),
    t[2] + Math.cos(az) * r,
  ];
}

/** 지금 카메라가 대상의 어느 쪽에 서 있는가 (위에서 정확히 내려다보면 0) */
export function orbitAzimuth(camPos, t) {
  const ox = camPos[0] - t[0];
  const oz = camPos[2] - t[2];
  return Math.abs(ox) + Math.abs(oz) < 1e-4 ? 0 : Math.atan2(ox, oz);
}

let req = null;
const subs = new Set();
let seq = 0;

/**
 * @param at    [x, z] — 바라볼 바닥 좌표
 * @param look  true 면 **들여다본다** (탑뷰: 확대 · 3D: 둘레를 돈다)
 */
export function focusOn(at, { look = false } = {}) {
  req = { at, look, seq: ++seq };
  subs.forEach((f) => f(req));
}

export function subscribeFocus(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
