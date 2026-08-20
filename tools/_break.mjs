/* 되돌리기 테스트 도우미 — **편집이 실제로 먹었는지 먼저 확인한다.**
   안 먹은 편집으로 「검사가 통과했다」를 보면 가드가 있는 줄 알게 된다.
   이번 세션에 그걸로 두 번 속았다. */
import { readFileSync, writeFileSync } from 'node:fs';
const [file, from, to] = process.argv.slice(2);
const s = readFileSync(file, 'utf8');
/* 줄바꿈은 파일 것을 따른다 — CRLF 파일에 \n 을 들이대면 조용히 안 바뀐다 */
const eol = s.includes('\r\n') ? '\r\n' : '\n';
const a = from.split('|').join(eol);
const b = to.split('|').join(eol);
if (!s.includes(a)) { console.error('!! 편집이 안 먹었다 — 찾는 글이 없다:', a.slice(0, 60)); process.exit(2); }
writeFileSync(file, s.replace(a, b));
