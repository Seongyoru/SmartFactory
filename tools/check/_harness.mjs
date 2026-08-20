/**
 * =============================================================================
 *  검증 뼈대 — 값으로 확인하는 것들의 공통 바닥
 * =============================================================================
 *  이 프로젝트는 **브라우저 화면을 못 본다**(docs/HANDOFF.md 의 「이 환경의 제약」).
 *  그래서 확인은 두 가지로 한다.
 *
 *    1. 순수 모듈은 **직접 불러** 값으로 — `core/*.js` 는 그냥 import 된다
 *    2. JSX 안의 계산은 **소스에서 떼어** `new Function` 으로 (아래 `cut`)
 *
 *  2번이 핵심이다. 손으로 옮겨 적으면 **옮겨 적은 것을 검증**하게 된다. 파일에서
 *  잘라 실행하면 오타 난 식별자·빠뜨린 import 까지 잡히고, 그 코드가 바뀌면
 *  검증이 먼저 깨져서 알려 준다.
 *
 *  ── 왜 npm test 로 묶었나 ────────────────────────────────────────────────
 *  이 검증들은 원래 세션마다 임시 폴더에 다시 쓰였고, 세션이 끝나면 사라졌다.
 *  "169건 통과했다" 는 말만 남고 **다시 돌릴 방법이 없었다.** 저장소에 있어야
 *  다음 사람이 손대기 전에 "지금 멀쩡한가" 를 확인할 수 있다.
 *
 *  ── vite build 는 이걸 대신하지 못한다 ───────────────────────────────────
 *  `vite build` 는 **문법만** 본다. 정의되지 않은 식별자, 빠뜨린 export, TDZ 는
 *  전부 통과시킨다 — 실제로 그렇게 화면이 통째로 멈춘 적이 두 번 있다.
 *
 *  쓰는 법:  npm test            전부
 *            node tools/check/bom.mjs   하나만
 * ---------------------------------------------------------------------------
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 저장소 뿌리 — 어디서 실행하든(다른 컴퓨터에서도) 같은 곳을 가리킨다 */
export const ROOT = path.resolve(HERE, '..', '..');

/** `import(SRC + 'core/bom.js')` 처럼 쓴다. Windows 드라이브 문자도 제대로 처리된다 */
export const SRC = `${pathToFileURL(path.join(ROOT, 'src')).href}/`;

/**
 * 소스를 글자로 읽는다 (JSX 에서 블록을 떼어 낼 때).
 *
 *  **줄바꿈을 LF 로 맞춘다.** 이 저장소의 파일은 CRLF 인데, 체크아웃 설정에
 *  따라 LF 로 오기도 한다. 줄바꿈을 박아 둔 cut() 이 그 차이로 됐다 안 됐다
 *  했다 — **검사가 git 설정에 달리면 안 된다.**
 */
export const readSrc = async (rel) =>
  (await readFile(path.join(ROOT, 'src', rel), 'utf8')).split('\r\n').join('\n');

/**
 * 소스에서 한 토막을 떼어 낸다.
 *  못 찾으면 **그 자리에서 멈춘다.** 조용히 빈 문자열을 돌려주면 아무것도 검증하지
 *  않으면서 "통과" 라고 말하게 된다 — 검증에서 가장 나쁜 실패다.
 *
 *  표시 문구가 안 맞으면 대개 그 코드가 바뀐 것이다. 검증도 같이 고칠 것.
 */
export function cut(text, from, to, what = '블록') {
  const a = text.indexOf(from);
  if (a < 0) throw new Error(`${what}의 시작을 못 찾았다 — 소스가 바뀌었으면 검증도 고칠 것: ${from}`);
  const b = text.indexOf(to, a);
  if (b < 0) throw new Error(`${what}의 끝을 못 찾았다: ${to}`);
  return text.slice(a, b + to.length);
}

/* --------------------------------------------------------------------------
 * 모으기 · 알리기
 * ------------------------------------------------------------------------ */

const groups = [];
let current = null;

/** 이 파일이 무엇을 보는지 — 결과에 이 이름으로 묶여 나온다 */
export function group(name) {
  current = { name, pass: 0, fails: [] };
  groups.push(current);
}

/** 한 가지를 확인한다. 던지면 실패로 적고 **계속 간다** — 한 번에 다 보기 위해서다 */
export function t(name, fn) {
  if (!current) group('(이름 없음)');
  try {
    const r = fn();
    /* async 본문은 여기서 막는다. 기다려 주지 않으므로 그 안의 assert 가 나중에
       터지고, 검사는 **통과한 것으로 세어진다** — 있으나 마나 한 검사가 된다.
       필요한 값은 파일 맨 위에서 await 로 받아 두고 본문은 동기로 쓸 것. */
    if (r && typeof r.then === 'function') {
      throw new Error('async 검사는 안 된다 — 값을 파일 맨 위에서 await 로 받아 둘 것');
    }
    current.pass += 1;
  } catch (e) {
    current.fails.push(`${name}: ${e.message}`);
  }
}

/**
 * **끝까지 갔는가.**
 * ---------------------------------------------------------------------------
 *  검사 파일이 맨 위에서 던지면(예: `cut` 이 마커를 못 찾으면) 그 뒤 파일들은
 *  아예 안 돌아간다. 그런데 결과는 그때까지 모은 것만 보고 **「587건 모두 통과」**
 *  라고 찍혔다 — 73건이 실행조차 안 됐는데.
 *
 *  종료 코드는 1 이라 CI 는 걸렀지만, 사람이 화면을 훑으면 통과로 읽는다.
 *  그래서 **다 돌았다고 말해 준 적이 있는지**를 따로 본다.
 */
let finished = false;
export const done = () => { finished = true; };

/**
 * 결과는 **끝날 때 한 번만** 찍는다.
 *  파일 하나만 돌리든 run.mjs 로 전부 돌리든 같은 자리에서 같은 모양으로 나온다.
 */
process.on('exit', () => {
  if (!groups.length) return;
  const pass = groups.reduce((s, g) => s + g.pass, 0);
  const fails = groups.flatMap((g) => g.fails.map((f) => `${g.name} › ${f}`));

  for (const g of groups) {
    const mark = g.fails.length ? '✗' : '·';
    console.log(`  ${mark} ${g.name.padEnd(34)} ${String(g.pass).padStart(3)}건${g.fails.length ? `  실패 ${g.fails.length}` : ''}`);
  }
  if (fails.length) {
    console.error(`\n실패 ${fails.length} / 통과 ${pass}`);
    fails.forEach((f) => console.error(`  ✗ ${f}`));
    process.exitCode = 1;
  } else if (!finished && process.env.CHECK_ALL === '1') {
    /**
     * **다 돌기 전에 멈췄다.**
     * -----------------------------------------------------------------------
     *  검사 파일이 맨 위에서 던지면(예: `cut` 이 마커를 못 찾으면) 그 뒤 파일들은
     *  아예 안 돌아간다. 그런데 여기서는 그때까지 모은 것만 보고 「587건 모두
     *  통과」 라고 찍혔다 — **73건이 실행조차 안 됐는데.**
     *
     *  종료 코드는 1 이라 CI 는 걸렀지만, 사람이 화면을 훑으면 통과로 읽는다.
     *  검사 도구가 「통과」 라고 거짓말하는 것은 검사가 없는 것보다 나쁘다.
     */
    console.error(`\n중단됨 — ${pass}건까지만 돌았다. 위 오류를 먼저 고칠 것`);
    process.exitCode = 1;
  } else {
    console.log(`\n${pass}건 모두 통과`);
  }
});
