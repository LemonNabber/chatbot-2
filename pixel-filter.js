// ============================================================
// pixel-filter.js
// Pixel-art look for a web page, applied with SVG filters.
// Used by index.html and pixel-test.html.
//
// Mark things to filter with a class:
//   .px      interface pieces (boxes, buttons, messages, headings, text)
//   .px-img  photos, video and gradients (colour bands + dithered seams)
// Add data-px-extra="#ddd" to an element for colours it only shows in
// states the page can't see on load (e.g. a hover colour).
//
// Not used in Safari / WebKit (every iPhone browser uses WebKit): Safari
// mis-renders these filters (blank or striped boxes), so it gets the normal page.
// ============================================================
(function () {
  // ============================================================
  // PIXEL FILTER
  //
  // Two filters, applied to each "asset" separately:
  //  .px      flat interface pieces. Pixel grid, then every colour snaps to the
  //           colours that element (and anything inside it) actually uses.
  //           Designed colours come through exactly; soft anti-aliased edge pixels
  //           snap to one side, so outlines and text edges are crisp.
  //  .px-img  photos and gradients. Pixel grid, then solid colour bands with a
  //           dithered strip where one band meets the next.
  // ============================================================

  const settings = {
    block: 1,       // CSS pixels per block
    levels: 8,      // colour bands per channel (photos and gradients)
    width: 0.25,    // dithered strip, as a fraction of a band (0 = hard bands, 1 = dither everywhere)
    ink: 0.4,       // share of a block text must cover to fill it (lower = bolder text)
    on: true
  };

  // The filters live in a hidden <svg> the script adds to the page.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  svg.appendChild(defs);
  let filterCache = new Map();
  let filterCount = 0;

  // Size of the element whose filter is being built (CSS px).
  // Positions inside the filters are written as fractions of this size ("objectBoundingBox"),
  // because Safari measures plain coordinates from the page corner instead of the element,
  // and drops the whole filter when they fall outside it. Fractions work the same everywhere.
  let cur = { w: 1, h: 1 };

  // Block size in device pixels, so it stays exact on Retina and phone screens.
  function grid() {
    const dpr = window.devicePixelRatio || 1;
    const n = Math.max(1, Math.round(settings.block * dpr));
    return { n, dot: 1 / dpr, cell: n / dpr, fx: v => v / cur.w, fy: v => v / cur.h };
  }

  // Fills each block with one value.
  //  average = true:  the block's average (for text, outlines and photos: thin strokes aren't skipped)
  //  average = false: one exact pixel from the block (for containers: their contents are already
  //                   snapped to exact colours, so picking one keeps those colours exact)
  function pixelateSteps(average = true) {
    const { n, dot, cell, fx, fy } = grid();
    if (n === 1) return '<feOffset in="SourceGraphic" dx="0" dy="0" result="px"/>';
    const ones = new Array(n * n).fill(1).join(' ');
    const avg = average
      ? `<feConvolveMatrix in="SourceGraphic" order="${n}" kernelMatrix="${ones}" divisor="${n * n}"
          targetX="0" targetY="0" edgeMode="none" preserveAlpha="false" result="avg"/>`
      : '';
    return `${avg}
      <feFlood x="0" y="0" width="${fx(dot)}" height="${fy(dot)}" flood-color="#000" result="dot"/>
      <feComposite in="dot" in2="dot" x="0" y="0" width="${fx(cell)}" height="${fy(cell)}" result="cell"/>
      <feTile in="cell" result="grid"/>
      <feComposite in="${average ? 'avg' : 'SourceGraphic'}" in2="grid" operator="in" result="samples"/>
      <feConvolveMatrix in="samples" order="${n}" kernelMatrix="${ones}" divisor="1"
        targetX="${n - 1}" targetY="${n - 1}" edgeMode="none" preserveAlpha="false" result="px"/>`;
  }

  // How much of a block text (or any darker colour) must cover to win it. Lower = bolder text.
  const alphaTable = () => Array.from({ length: 20 }, (_, i) => (i / 20 >= settings.ink ? 1 : 0)).join(' ');

  const luma = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

  // Channel value (0-255) -> filter table value. Browsers round filter output down,
  // so aim for the middle of the step to land exactly on the intended value.
  const tv = v => Math.min(1, (v + 0.5) / 255).toFixed(5);

  // Snap every pixel to one of the given whole colours, chosen by brightness.
  // Output is always exactly one of the palette colours: no red/green/blue mixes.
  function paletteSteps(input, colors) {
    const pal = colors.map(c => ({ c, y: luma(c) })).sort((a, b) => a.y - b.y);
    const pick = [];
    for (let v = 0; v < 256; v++) {
      let k = 0;
      // move to a lighter colour only once v is past the darker colour's share
      while (k < pal.length - 1 && v > pal[k].y + (1 - settings.ink) * (pal[k + 1].y - pal[k].y)) k++;
      pick.push(pal[k].c);
    }
    const table = ch => pick.map(c => tv(c[ch])).join(' ');
    return `
      <feColorMatrix in="${input}" type="matrix" values="
        0.299 0.587 0.114 0 0
        0.299 0.587 0.114 0 0
        0.299 0.587 0.114 0 0
        0 0 0 1 0" result="lum"/>
      <feComponentTransfer in="lum">
        <feFuncR type="discrete" tableValues="${table(0)}"/>
        <feFuncG type="discrete" tableValues="${table(1)}"/>
        <feFuncB type="discrete" tableValues="${table(2)}"/>
        <feFuncA type="discrete" tableValues="${alphaTable()}"/>
      </feComponentTransfer>`;
  }

  // 256-entry lookup table: each channel value -> nearest allowed value.
  function lookupTable(allowed) {
    const out = [];
    for (let v = 0; v < 256; v++) {
      let best = allowed[0];
      for (const a of allowed) if (Math.abs(a - v) < Math.abs(best - v)) best = a;
      out.push(tv(best));
    }
    return out.join(' ');
  }

  function snapSteps(input, r, g, b) {
    return `
      <feComponentTransfer in="${input}">
        <feFuncR type="discrete" tableValues="${lookupTable(r)}"/>
        <feFuncG type="discrete" tableValues="${lookupTable(g)}"/>
        <feFuncB type="discrete" tableValues="${lookupTable(b)}"/>
        <feFuncA type="discrete" tableValues="${alphaTable()}"/>
      </feComponentTransfer>`;
  }

  function bandLevels(L = settings.levels) {
    return Array.from({ length: L }, (_, i) => Math.round(i * 255 / (L - 1)));
  }

  // Per-image options (attributes on a .px-img element):
  //   data-px-levels="4"  colour bands per channel for this image (default: settings.levels)
  //   data-px-width="1"   dithered strip width for this image (default: settings.width)
  //   data-px-grey        turn the image greyscale first
  function imageOptions(el) {
    const d = el.dataset;
    return {
      levels: Math.max(2, Number(d.pxLevels) || settings.levels),
      width: d.pxWidth !== undefined ? Number(d.pxWidth) : settings.width,
      grey: d.pxGrey !== undefined
    };
  }

  // 4x4 ordered-dither pattern, one pattern cell per block.
  function bayerSteps() {
    const { cell, fx, fy } = grid();
    const m = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    let floods = '', merge = '';
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const v = Math.round((m[y][x] + 0.5) / 16 * 255);
      const id = `b${y}${x}`;
      floods += `<feFlood x="${fx(x * cell)}" y="${fy(y * cell)}" width="${fx(cell)}" height="${fy(cell)}" flood-color="rgb(${v},${v},${v})" result="${id}"/>`;
      merge += `<feMergeNode in="${id}"/>`;
    }
    return floods +
      `<feMerge x="0" y="0" width="${fx(4 * cell)}" height="${fy(4 * cell)}" result="bayerCell">${merge}</feMerge>
       <feTile in="bayerCell" result="bayer"/>`;
  }

  function defineFilter(key, body) {
    key = `${cur.w}x${cur.h}|${key}`;
    if (filterCache.has(key)) return filterCache.get(key);
    const id = 'pxf' + (++filterCount);
    defs.insertAdjacentHTML('beforeend',
      `<filter id="${id}" x="0" y="0" width="1" height="1" filterUnits="objectBoundingBox"
        primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">${body}</filter>`);
    filterCache.set(key, id);
    return id;
  }

  // Filters are per element size, so drop ones nothing uses any more.
  const filterUsers = new Map(); // id -> number of elements using it
  const elementFilter = new WeakMap(); // element -> id
  function useFilter(el, id) {
    const old = elementFilter.get(el);
    if (old === id) return;
    if (id) filterUsers.set(id, (filterUsers.get(id) || 0) + 1);
    if (old) {
      const left = filterUsers.get(old) - 1;
      if (left > 0) filterUsers.set(old, left);
      else {
        filterUsers.delete(old);
        document.getElementById(old)?.remove();
        for (const [k, v] of filterCache) if (v === old) filterCache.delete(k);
      }
    }
    if (id) elementFilter.set(el, id); else elementFilter.delete(el);
  }

  function imageFilter(el) {
    const o = imageOptions(el);
    const levels = bandLevels(o.levels);
    const A = o.width / (o.levels - 1);
    const grey = o.grey
      ? '<feColorMatrix in="px" type="saturate" values="0" result="pxg"/>'
      : '';
    return defineFilter(`img|${grid().n}|${o.levels}|${o.width}|${o.grey}|${settings.ink}`,
      pixelateSteps() + grey + bayerSteps() +
      `<feComposite in="${o.grey ? 'pxg' : 'px'}" in2="bayer" operator="arithmetic" k1="0" k2="1" k3="${A}" k4="${-A / 2}" result="dithered"/>` +
      snapSteps('dithered', levels, levels, levels));
  }

  // ---- automatic palettes for .px elements ----

  function parseColor(str) {
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    if (p.length === 4 && p[3] === 0) return null; // fully transparent
    return p.slice(0, 3).map(Math.round);
  }

  // Every colour this element and its contents actually use.
  function collectPalette(el) {
    const seen = new Map();
    const add = c => { if (c) seen.set(c.join(','), c); };
    const nodes = [el, ...el.querySelectorAll('*')];
    for (const node of nodes) {
      const cs = getComputedStyle(node);
      if (cs.display === 'none') continue;
      add(parseColor(cs.backgroundColor));
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if (parseFloat(cs['border' + side + 'Width']) > 0) add(parseColor(cs['border' + side + 'Color']));
      }
      if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) add(parseColor(cs.outlineColor));
      const hasText = [...node.childNodes].some(c => c.nodeType === 3 && c.textContent.trim());
      // inputs hold their text outside the DOM, so their text colour is added directly
      if (hasText || node.matches('input, textarea, select')) add(parseColor(cs.color));
      // ::before / ::after decorations
      for (const pseudo of ['::before', '::after']) {
        const ps = getComputedStyle(node, pseudo);
        if (ps.content && ps.content !== 'none') add(parseColor(ps.backgroundColor));
      }
    }
    // Extra colours for states the page can't see right now (e.g. hover).
    (el.dataset.pxExtra || '').split(/\s+/).filter(Boolean).forEach(hex => {
      const h = hex.replace('#', '');
      const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
      add([0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)));
    });
    return [...seen.values()];
  }

  // Text gets its own asset: each run of inline content (text plus inline tags like
  // <strong>) is wrapped in a block-level <div class="px-t"> with no background.
  // With no background behind it, a soft text edge only changes how see-through a pixel
  // is, never its colour, so it snaps cleanly to the text's own colour.
  // (Block-level on purpose: browsers measure filters on inline elements from the
  // surrounding block's corner, which breaks the pixel grid.)
  const SKIP_TAGS = new Set(['IMG', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'VIDEO', 'CANVAS', 'SVG', 'SCRIPT', 'STYLE', 'BR']);

  function isInlineRunPart(node) {
    if (node.nodeType === 3) return true;
    if (node.nodeType !== 1) return false;
    if (SKIP_TAGS.has(node.tagName.toUpperCase()) || node.matches('.px-img, .px-t, .px')) return false;
    if (!getComputedStyle(node).display.startsWith('inline')) return false;
    return !node.querySelector('img, input, select, textarea, button, video, canvas, svg, .px-img, .px');
  }

  function wrapText(el) {
    if (el.matches('.px-t, .px-img') || SKIP_TAGS.has(el.tagName.toUpperCase())) return;
    let run = [];
    const flush = () => {
      if (run.some(n => n.textContent.trim())) {
        const div = document.createElement('div');
        div.className = 'px-t';
        run[0].before(div);
        run.forEach(n => div.appendChild(n));
      }
      run = [];
    };
    for (const child of [...el.childNodes]) {
      if (isInlineRunPart(child)) { run.push(child); continue; }
      flush();
      if (child.nodeType === 1) wrapText(child);
    }
    flush();
  }

  function uiFilter(el) {
    const colors = collectPalette(el);
    // Containers take one exact pixel per block; elements with nothing filtered inside average.
    const average = !el.querySelector('.px-t, .px-img, .px');
    const pixelate = pixelateSteps(average);
    if (!colors.length) return defineFilter(`plain|${grid().n}|${average}`, pixelate);

    // Fallback: red/green/blue rounded separately. Used when the element contains a
    // photo (whose colours must survive) or two colours are too close in brightness to tell apart.
    const ys = colors.map(luma).sort((a, b) => a - b);
    const tooClose = ys.some((y, i) => i && y - ys[i - 1] < 3);
    if (el.querySelector('.px-img') || tooClose) {
      const sets = [0, 1, 2].map(ch => new Set(colors.map(c => c[ch])));
      // keep the bands of every image inside (each image may have its own number of levels)
      el.querySelectorAll('.px-img').forEach(img =>
        bandLevels(imageOptions(img).levels).forEach(v => sets.forEach(s => s.add(v))));
      const pal = sets.map(s => [...s].sort((a, b) => a - b));
      if (tooClose) console.warn('Pixel filter: colours too close in brightness, using fallback for', el);
      return defineFilter(`ch|${grid().n}|${average}|${settings.ink}|${JSON.stringify(pal)}`, pixelate + snapSteps('px', ...pal));
    }

    const key = colors.map(c => c.join(',')).sort().join(';');
    return defineFilter(`ui|${grid().n}|${average}|${settings.ink}|${key}`, pixelate + paletteSteps('px', colors));
  }

  // Elements get new filters when their size changes (e.g. text wrapping onto another line).
  const resizeWatch = new ResizeObserver(entries => entries.forEach(e => applyTo(e.target)));
  const watched = new WeakSet();

  function applyTo(el) {
    if (!watched.has(el)) { watched.add(el); resizeWatch.observe(el); }
    const r = el.getBoundingClientRect();
    if (!settings.on || !r.width || !r.height) { el.style.filter = ''; useFilter(el, null); return; }
    cur = { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 };
    const id = el.classList.contains('px-img') ? imageFilter(el) : uiFilter(el);
    useFilter(el, id);
    el.style.filter = `url(#${id})`;
  }

  // Text and images first, then the containers around them.
  function applyWithin(roots) {
    roots.forEach(wrapText);
    const inner = roots.flatMap(r => [...r.querySelectorAll('.px-t, .px-img')]);
    const own = roots.filter(r => r.matches('.px-img'));
    [...inner, ...own].forEach(applyTo);
    roots.filter(r => r.matches('.px')).reverse().forEach(applyTo);
  }

  function applyAll() {
    applyWithin([...document.querySelectorAll('.px, .px-img')]);
  }

  function rebuild() {
    defs.innerHTML = '';
    filterCache = new Map();
    filterUsers.clear();
    document.querySelectorAll('.px, .px-img, .px-t').forEach(el => elementFilter.delete(el));
    applyAll();
  }

  // New elements get filtered automatically.
  // Removed elements release their filters.
  function observeChanges() {
    new MutationObserver(records => {
      for (const rec of records) {
        for (const node of rec.removedNodes) {
          if (node.nodeType !== 1 || node.isConnected) continue;
          for (const el of [node, ...node.querySelectorAll('.px, .px-img, .px-t')]) {
            if (elementFilter.has(el)) useFilter(el, null);
            resizeWatch.unobserve(el);
            watched.delete(el);
          }
        }
        for (const node of rec.addedNodes) {
          if (node.nodeType !== 1 || node.closest('svg') || node.matches('.px-t')) continue;
          const roots = [...(node.matches('.px, .px-img') ? [node] : []), ...node.querySelectorAll('.px, .px-img')];
          if (roots.length && settings.on) applyWithin(roots);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // Rebuild when screen density changes (browser zoom, moving to another monitor).
  function watchDensity() {
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => { rebuild(); watchDensity(); }, { once: true });
  }

  // ---- Safari check -------------------------------------------------
  const ua = navigator.userAgent;
  const supported = !(/AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua))
    || new URLSearchParams(location.search).has('force-pixel');
  if (!supported) settings.on = false;

  function start() {
    document.body.appendChild(svg);
    observeChanges();
    watchDensity();
    if (settings.on) applyAll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.PixelFilter = {
    settings,
    supported,
    applyAll,
    rebuild,
    // Turn the effect on or off (ignored where unsupported).
    setEnabled(on) {
      settings.on = !!on && supported;
      rebuild();
      if (!settings.on) document.querySelectorAll('.px, .px-img, .px-t').forEach(el => { el.style.filter = ''; });
    },
    filterCount: () => defs.children.length
  };
})();
