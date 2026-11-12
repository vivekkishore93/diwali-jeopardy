// Load user-supplied font overrides from public/fonts/ (clue.*, value.*, category.*).
export async function loadFontOverrides() {
  try {
    const { fonts } = await fetch('/api/assets').then(r => r.json());
    const map = { clue: 'ClueOverride', value: 'ValueOverride', category: 'CategoryOverride' };
    const css = [];
    for (const f of fonts) {
      const m = f.match(/^(clue|value|category)\.(woff2?|ttf|otf)$/i);
      if (m) css.push(`@font-face{font-family:'${map[m[1].toLowerCase()]}';src:url('/fonts/${encodeURIComponent(f)}');font-display:block}`);
    }
    if (css.length) {
      const s = document.createElement('style');
      s.textContent = css.join('\n');
      document.head.appendChild(s);
    }
  } catch { /* ignore */ }
}

// A small diya (oil lamp) SVG used as timer lights and control marker.
export const DIYA_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <path class="flame" d="M32 6c5 9 9 14 9 20a9 9 0 0 1-18 0c0-6 4-11 9-20z"/>
  <path class="flame-core" d="M32 18c2.5 4.5 4 7 4 10a4 4 0 0 1-8 0c0-3 1.5-5.5 4-10z"/>
  <path class="bowl" d="M4 38h56c-2 12-13 20-28 20S6 50 4 38z"/>
  <path class="rim" d="M4 38h56v3H4z"/>
</svg>`;
