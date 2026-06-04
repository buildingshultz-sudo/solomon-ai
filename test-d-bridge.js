'use strict';
// Unit tests for the D: bridge — pure-logic checks, no live PC calls.
// Tests: path scoping, Range header parse, dangerous /execute pattern matching, cowork-lock semantics.

const assert = (cond, msg) => { if (!cond) { console.log('FAIL  ' + msg); process.exitCode = 1; } else console.log('PASS  ' + msg); };

// ── 1. D: write-pattern denylist (must catch common write verbs) ────────────
const D_WRITE_PATTERNS = [
  /\bRemove[-_]Item\b[^|;\n]*\bd:[\\/]/i,
  /\bMove[-_]Item\b[^|;\n]*\bd:[\\/]/i,
  /\bSet[-_]Content\b[^|;\n]*\bd:[\\/]/i,
  /\bOut[-_]File\b[^|;\n]*\bd:[\\/]/i,
  /\bCopy[-_]Item\b[^|;\n]*-(?:Destination|Path)\b[^|;\n]*\bd:[\\/]/i,
  /\bdel\b\s+["']?d:[\\/]/i,
  /\brobocopy\b[^|;\n]+\bd:[\\/]/i,
  /\bffmpeg\b[^|;\n]+(?:-y\s+)?[^|;\n]+\bd:[\\/]/i,
  />>?\s*["']?d:[\\/]/i
];
const wouldRefuse = (cmd) => D_WRITE_PATTERNS.some(re => re.test(cmd));

// Must-refuse cases:
assert(wouldRefuse('Remove-Item D:\\Solomon\\junk.txt -Force'),                 'Remove-Item D:\\ refused');
assert(wouldRefuse('Move-Item C:\\foo.txt D:\\Solomon\\foo.txt'),               'Move-Item ... D:\\ refused');
assert(wouldRefuse("Set-Content -Path 'D:\\out.txt' 'hi'"),                     'Set-Content D:\\ refused');
assert(wouldRefuse('Out-File D:\\log.txt'),                                     'Out-File D:\\ refused');
assert(wouldRefuse('Copy-Item C:\\a.mp4 -Destination D:\\B ROLL FOOTAGE\\'),    'Copy-Item -Destination D:\\ refused');
assert(wouldRefuse("del D:\\tmp\\foo.txt"),                                    'del D:\\ refused');
assert(wouldRefuse('robocopy C:\\src D:\\dst /MIR'),                            'robocopy to D:\\ refused');
assert(wouldRefuse('ffmpeg -i input.mp4 -y D:\\out\\test.mp4'),                 'ffmpeg writing to D:\\ refused');
assert(wouldRefuse('Get-Date > D:\\stamp.txt'),                                 'redirection > D:\\ refused');

// Must-allow cases (reads / non-D: writes / unrelated commands):
assert(!wouldRefuse('Get-ChildItem D:\\Solomon\\'),                             'Get-ChildItem D:\\ allowed (read)');
assert(!wouldRefuse('Get-Content D:\\Solomon\\reports\\foo.txt'),               'Get-Content D:\\ allowed (read)');
assert(!wouldRefuse('Remove-Item C:\\Users\\Ashle\\junk.txt'),                  'Remove-Item C:\\ allowed (not D:)');
assert(!wouldRefuse('Set-Content -Path C:\\out.txt "hi"'),                      'Set-Content C:\\ allowed (not D:)');
assert(!wouldRefuse('Write-Output "hello"'),                                    'Write-Output allowed');
assert(!wouldRefuse('ffprobe D:\\B ROLL FOOTAGE\\clip.mp4'),                    'ffprobe D:\\ allowed (read-only tool)');

// ── 2. Range header parsing (matches the relay's logic) ────────────────────
function parseRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const m = String(rangeHeader).match(/^bytes=(\d*)-(\d*)$/i);
  if (!m) return { error: 'malformed' };
  const s = m[1] === '' ? null : parseInt(m[1], 10);
  const e = m[2] === '' ? null : parseInt(m[2], 10);
  if (s == null && e == null) return { error: 'no-bounds' };
  let start = 0, end = size - 1;
  if (s != null && e != null) { start = s; end = e; }
  else if (s != null)         { start = s; }
  else if (e != null)         { start = Math.max(0, size - e); }
  if (start < 0 || end >= size || start > end) return { error: 'unsatisfiable', size };
  return { start, end, chunk: end - start + 1 };
}
assert(JSON.stringify(parseRange('bytes=0-99', 1000)) === '{"start":0,"end":99,"chunk":100}',         'Range 0-99 parsed');
assert(JSON.stringify(parseRange('bytes=500-', 1000)) === '{"start":500,"end":999,"chunk":500}',     'Range 500- parsed (open end)');
assert(JSON.stringify(parseRange('bytes=-100', 1000)) === '{"start":900,"end":999,"chunk":100}',    'Range -100 parsed (suffix)');
assert(parseRange('bytes=2000-3000', 1000).error === 'unsatisfiable',                                'Range past EOF rejected');
assert(parseRange('bogus', 1000).error === 'malformed',                                              'Malformed Range rejected');
assert(parseRange('', 1000) === null,                                                                'Empty Range passthrough (no header)');

// ── 3. D:-only path scoping (tool-side check) ─────────────────────────────
const isUnderD = (p) => /^d:[\\/]/i.test(String(p || '').replace(/\//g, '\\'));
assert(isUnderD('D:\\Solomon\\foo.csv'),                                        'D:\\Solomon scoped');
assert(isUnderD('d:\\b roll footage\\clip.mp4'),                                'd:\\ (lowercase) scoped');
assert(isUnderD('D:/Solomon/foo.csv'),                                          'forward-slash D:/ scoped (normalized)');
assert(!isUnderD('C:\\Users\\Ashle\\file.txt'),                                 'C:\\ NOT scoped');
assert(!isUnderD('E:\\external\\foo'),                                          'E:\\ NOT scoped');
assert(!isUnderD(''),                                                           'empty NOT scoped');
assert(!isUnderD(null),                                                         'null NOT scoped');

// ── 4. Cowork-lock semantics (relay-side _coworkActive). ───────────────────
// We only verify the contract: a non-existent path → false; an existing one → true.
const fs = require('fs');
const tmpLock = require('os').tmpdir() + '/test-cowork-lock-' + Date.now() + '.tmp';
const _coworkActive = (lockPath) => { try { return fs.existsSync(lockPath); } catch (_) { return false; } };
assert(_coworkActive(tmpLock) === false, 'cowork lock absent → inactive');
fs.writeFileSync(tmpLock, '');
assert(_coworkActive(tmpLock) === true,  'cowork lock present → active');
fs.unlinkSync(tmpLock);
assert(_coworkActive(tmpLock) === false, 'cowork lock removed → inactive again');

console.log('\nDone.');
