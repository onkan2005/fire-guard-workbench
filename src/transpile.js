// Turns a practical subset of Arduino C++ into async JavaScript, keeping line numbers aligned.
// Supported: #define/#include, globals and locals of the usual types, functions, arrays,
// library objects (DHT, LiquidCrystal_I2C, Adafruit_NeoPixel), String, casts, number suffixes.
// delay() and calls to your own functions become `await`, so the simulator can pause the sketch.

const TYPES = 'void|int|float|double|bool|boolean|long|short|byte|char|word|size_t|String|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|unsigned|signed';
const QUAL = '(?:(?:const|static|volatile|constexpr|unsigned|signed|long|short)\\s+)*';
const T = `${QUAL}(?:${TYPES})\\b(?:\\s*[*&]+\\s*|\\s+)`;
const INTY = /\b(int|long|short|byte|word|size_t|u?int\d+_t|unsigned|signed)\s*[*&]?\s*$/;
const LIBS = ['DHT', 'LiquidCrystal_I2C', 'Adafruit_NeoPixel', 'Adafruit_PWMServoDriver', 'Preferences'];
export const KNOWN_INCLUDES = ['Arduino.h', 'Wire.h', 'DHT.h', 'DHT_U.h', 'LiquidCrystal_I2C.h', 'Adafruit_NeoPixel.h', 'WiFi.h', 'Adafruit_Sensor.h', 'Adafruit_PWMServoDriver.h', 'Preferences.h', 'esp_system.h'];

function protect(src) {
  const lits = []; let out = '', i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2), end = e < 0 ? src.length : e + 2; out += src.slice(i, end).replace(/[^\n]/g, ' '); i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1; while (j < src.length && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      let lit = src.slice(i, j + 1);
      if (c === "'") { const inner = lit.slice(1, -1); lit = inner === '"' ? '"\\""' : '"' + inner + '"'; }
      lits.push(lit); out += '\u0001' + (lits.length - 1) + '\u0002'; i = j + 1; continue;
    }
    out += c; i++;
  }
  return { out, lits };
}

function matchParen(s, open) { let d = 0; for (let i = open; i < s.length; i++) { if (s[i] === '(') d++; else if (s[i] === ')' && --d === 0) return i; } return -1; }

function castInts(s) {
  const re = /\(\s*(?:unsigned\s+)?(?:int|long|byte|short|word|size_t|u?int\d+_t)\s*\)\s*/g; let m, out = '', last = 0;
  while ((m = re.exec(s))) {
    const st = m.index + m[0].length; let end;
    if (s[st] === '(') end = matchParen(s, st) + 1;
    else { const mm = /^[\w.$\u0001\u0002]+/.exec(s.slice(st)); end = st + (mm ? mm[0].length : 0); if (s[end] === '(') end = matchParen(s, end) + 1; else if (s[end] === '[') end = s.indexOf(']', end) + 1; }
    if (end <= st) continue;
    out += s.slice(last, m.index) + '__int(' + s.slice(st, end) + ')'; last = end; re.lastIndex = end;
  }
  return out + s.slice(last);
}

function guardLoops(s) {
  const re = /\b(while|for)\s*\(|\bdo\s*\{/g; let m, out = '', last = 0;
  while ((m = re.exec(s))) {
    if (m[0].startsWith('do')) { out += s.slice(last, m.index + m[0].length) + '__g();'; last = m.index + m[0].length; continue; }
    const open = s.indexOf('(', m.index), close = matchParen(s, open); if (close < 0) break;
    const rest = /^\s*\{/.exec(s.slice(close + 1));
    if (rest) { const at = close + 1 + rest[0].length; out += s.slice(last, at) + '__g();'; last = at; re.lastIndex = at; }
    else { re.lastIndex = close + 1; }
  }
  return out + s.slice(last);
}

// x = expr;  ->  x = __int(expr);   (expression ends at ; or , or ) at depth 0)
function wrapInts(s, names) {
  const re = new RegExp(`(?<![\\w.$])(${names.join('|')})\\s*(=|\\+=|-=|\\*=|\\/=|%=)(?!=)`, 'g');
  let m, out = '', last = 0;
  while ((m = re.exec(s))) {
    const st = m.index + m[0].length; let d = 0, i = st;
    for (; i < s.length; i++) {
      const c = s[i];
      if ('([{'.includes(c)) d++;
      else if (')]}'.includes(c)) { if (d === 0) break; d--; }
      else if ((c === ';' || c === ',') && d === 0) break;
    }
    const expr = s.slice(st, i), n = m[1], op = m[2];
    if (!expr.trim()) continue;
    const rep = op === '=' ? `${n} = __int(${expr})` : `${n} = __int(${n} ${op[0]} (${expr}))`;
    out += s.slice(last, m.index) + rep; last = i; re.lastIndex = i;
  }
  return out + s.slice(last);
}

export function transpile(src) {
  const warnings = [], includes = [];
  let { out: s, lits } = protect(src.replace(/\r\n?/g, '\n'));
  const lit = i => lits[+i];

  // preprocessor
  s = s.split('\n').map(line => {
    const t = line.trim();
    if (!t.startsWith('#')) return line;
    let m;
    if ((m = /^#\s*include\s*(?:<([^>]+)>|\u0001(\d+)\u0002)/.exec(t))) { includes.push(m[1] || lit(m[2]).slice(1, -1)); return ''; }
    if ((m = /^#\s*define\s+(\w+)\(([^)]*)\)\s+(.+)$/.exec(t))) return `const ${m[1]} = (${m[2]}) => (${m[3]});`;
    if ((m = /^#\s*define\s+(\w+)\s+(.+)$/.exec(t))) return `const ${m[1]} = ${m[2]};`;
    return '';
  }).join('\n');
  for (const inc of includes) if (!KNOWN_INCLUDES.includes(inc)) warnings.push(`#include <${inc}> is not simulated; calls into it will fail.`);
  if (includes.includes('WiFi.h')) warnings.push('Wi-Fi is stubbed: WiFi.begin() "connects" instantly, no network traffic.');

  // number suffixes, misc C++-isms
  s = s.replace(/\b(0x[0-9a-fA-F]+|\d+)(?:UL|ul|LL|ll|L|l|U|u)\b/g, '$1')
    .replace(/(\d+\.\d*|\.\d+)[fF]\b/g, '$1')
    .replace(/sizeof\s*\(\s*(\w+)\s*\)\s*\/\s*sizeof\s*\(\s*\1\s*\[\s*0\s*\]\s*\)/g, '$1.length')
    .replace(/static_cast\s*<\s*(?:unsigned\s+)?(?:int|long|byte|short|u?int\d+_t)\s*>\s*\(/g, '__int(')
    .replace(/static_cast\s*<[^>]*>\s*\(/g, '(')
    .replace(/\(\s*(?:float|double)\s*\)/g, '')
    .replace(/->/g, '.')
    .replace(/\bnullptr\b|\bNULL\b/g, 'null')
    .replace(/\.length\s*\(\s*\)/g, '.length')
    .replace(/\bString\s*\(/g, '__S(');
  s = castInts(s);

  // function prototypes (drop) and definitions
  const fns = new Set();
  s = s.replace(new RegExp(`(^|[;{}])(\\s*)${T}(\\w+)\\s*\\(([^()]*)\\)\\s*;`, 'gm'), (all, pre, ws, name) => /^(if|while|for|switch|return)$/.test(name) ? all : pre + ws);
  s = s.replace(new RegExp(`(^|[;{}])(\\s*)${T}(\\w+)\\s*\\(([^()]*)\\)\\s*(?:const\\s*)?\\{`, 'gm'), (all, pre, ws, name, params) => {
    fns.add(name);
    const ps = params.split(',').map(x => x.trim()).filter(x => x && x !== 'void').map(x => { const m = /(\w+)\s*(?:\[\s*\w*\s*\])?\s*(=.*)?$/.exec(x); return m ? m[1] + (m[2] || '') : x; });
    return `${pre}${ws}async function ${name}(${ps.join(', ')}) {`;
  });
  if (!fns.has('setup')) warnings.push('No setup() function found.');
  if (!fns.has('loop')) warnings.push('No loop() function found.');

  // library objects:  Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);
  s = s.replace(new RegExp(`\\b(${LIBS.join('|')})\\s+(\\w+)\\s*=\\s*\\1\\s*\\(([^;]*)\\)\\s*;`, 'g'), (a, cls, name, args) => `let ${name} = new ${cls}(${args});`);
  // library objects:  DHT dht(4, DHT22);
  s = s.replace(new RegExp(`\\b(${LIBS.join('|')})\\s+(\\w+)\\s*(?:\\(([^;]*)\\))?\\s*;`, 'g'), (a, cls, name, args) => `let ${name} = new ${cls}(${args || ''});`);

  // arrays
  s = s.replace(new RegExp(`(^|[;{}])(\\s*)${T}(\\w+)\\s*\\[([^\\]]*)\\](?:\\s*\\[[^\\]]*\\])?\\s*(?:=\\s*\\{([^;]*)\\})?\\s*;`, 'gm'), (a, pre, ws, name, size, init) => {
    if (init != null) return `${pre}${ws}let ${name} = [${init.replace(/\{/g, '[').replace(/\}/g, ']')}];`;
    return `${pre}${ws}let ${name} = new Array(${size || 0}).fill(0);`;
  });

  // integer variables: remember names so assignments truncate like C
  const ints = new Set();
  s.replace(new RegExp(`(^|[;{}(])\\s*(${T})(\\w+)\\s*[=;,)]`, 'gm'), (a, pre, type, name) => { if (INTY.test(type.trim())) ints.add(name); return a; });

  // scalar declarations -> let
  s = s.replace(new RegExp(`(^|[;{}(])(\\s*)${T}(?=[A-Za-z_]\\w*\\s*(?:=|;|,|\\)|:))`, 'gm'), '$1$2let ');

  // truncate integer assignments:  x = expr;  x += expr;
  if (ints.size) s = wrapInts(s, [...ints]);

  // async plumbing
  s = s.replace(/(?<![\w.$])(delay|delayMicroseconds)\s*\(/g, 'await $1(');
  if (fns.size) s = s.replace(new RegExp(`(?<![\\w.$])(?<!function\\s+)(${[...fns].join('|')})\\s*\\(`, 'g'), 'await $1(');
  s = guardLoops(s);

  s = s.replace(/\u0001(\d+)\u0002/g, (a, i) => lit(i));
  return { js: s, warnings, includes, fns: [...fns] };
}
