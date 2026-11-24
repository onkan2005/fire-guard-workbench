// Lightweight C++ editor: textarea over a highlighted <pre>, with line numbers and error marking.
const KW = /\b(if|else|for|while|do|switch|case|default|break|continue|return|const|static|volatile|unsigned|signed|true|false|HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP|nullptr|NULL)\b/;
const TY = /\b(void|int|float|double|bool|boolean|long|short|byte|char|word|size_t|String|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|DHT|LiquidCrystal_I2C|Adafruit_NeoPixel|Adafruit_PWMServoDriver)\b/;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function highlight(src) {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(^[ \t]*#[^\n]*)|(\b\d+(?:\.\d+)?(?:UL|L|U|f)?\b|\b0x[0-9a-fA-F]+\b)|([A-Za-z_]\w*)(?=\s*\()|([A-Za-z_]\w*)/gm;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index)); last = re.lastIndex;
    const t = esc(m[0]);
    if (m[1]) out += `<i class="c">${t}</i>`;
    else if (m[2]) out += `<i class="s">${t}</i>`;
    else if (m[3]) out += `<i class="p">${t}</i>`;
    else if (m[4]) out += `<i class="n">${t}</i>`;
    else if (m[5]) out += TY.test(m[5]) || KW.test(m[5]) ? `<i class="${TY.test(m[5]) ? 't' : 'k'}">${t}</i>` : `<i class="f">${t}</i>`;
    else if (m[6]) out += TY.test(m[6]) ? `<i class="t">${t}</i>` : KW.test(m[6]) ? `<i class="k">${t}</i>` : t;
  }
  return out + esc(src.slice(last)) + '\n';
}

export function createEditor(root, initial, onChange) {
  root.innerHTML = '<div class="gut" aria-hidden="true"></div><div class="edw"><pre class="hl" aria-hidden="true"></pre><textarea spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Sketch source code"></textarea></div>';
  const gut = root.querySelector('.gut'), pre = root.querySelector('.hl'), ta = root.querySelector('textarea');
  let errLine = null;
  const render = () => {
    pre.innerHTML = highlight(ta.value);
    const n = ta.value.split('\n').length;
    let g = ''; for (let i = 1; i <= n; i++) g += `<div${i === errLine ? ' class="err"' : ''}>${i}</div>`;
    gut.innerHTML = g; sync();
  };
  const sync = () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; gut.scrollTop = ta.scrollTop; };
  ta.value = initial;
  ta.addEventListener('input', () => { errLine = null; render(); onChange && onChange(ta.value); });
  ta.addEventListener('scroll', sync);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault(); const s = ta.selectionStart, en = ta.selectionEnd;
      ta.setRangeText('  ', s, en, 'end'); ta.dispatchEvent(new Event('input'));
    } else if (e.key === 'Enter') {
      const s = ta.selectionStart, line = ta.value.slice(0, s).split('\n').pop();
      const ind = /^\s*/.exec(line)[0] + (/\{\s*$/.test(line) ? '  ' : '');
      e.preventDefault(); ta.setRangeText('\n' + ind, s, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input'));
    }
  });
  render();
  return {
    get value() { return ta.value; },
    set value(v) { ta.value = v; errLine = null; render(); },
    markError(line) {
      errLine = line; render();
      if (line) { const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18; ta.scrollTop = Math.max(0, (line - 4) * lh); sync(); }
    },
  };
}
