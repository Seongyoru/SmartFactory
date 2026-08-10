/**
 * 카메라 이동 요청 저장소.
 *  인스펙터(씬 밖)에서 "이 설비를 보여 줘" 라고 말할 수 있어야 한다. 에디터
 *  상태에 넣으면 한 번 보고 지워야 하는 값 때문에 리듀서가 지저분해지고,
 *  같은 대상을 두 번 누르면 아무 일도 안 일어나는 문제가 생긴다.
 *  그래서 커서와 같은 방식의 작은 외부 스토어로 두고, 요청마다 일련번호를 붙여
 *  "같은 좌표를 다시 눌러도 다시 움직이도록" 한다.
 */

let req = null;
const subs = new Set();
let seq = 0;

/** @param at [x, z] — 바라볼 바닥 좌표 */
export function focusOn(at) {
  req = { at, seq: ++seq };
  subs.forEach((f) => f(req));
}

export function subscribeFocus(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
