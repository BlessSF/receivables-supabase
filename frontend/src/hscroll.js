// Horizontal scrolling helper for every wide table (.table-wrap that holds a <table>).
// When a table is wider than its panel it gets: a toolbar above it with ← / → buttons and a
// draggable scroll bar, a thick visible native scrollbar, and smooth Shift + mouse-wheel scrolling.
// Tables that fit are left exactly as they were.

const STEP = 0.8; // arrow buttons move 80% of the visible width

function smoothTo(el, target) {
  const max = el.scrollWidth - el.clientWidth;
  const to = Math.max(0, Math.min(max, target));
  if (el.__hsRaf) cancelAnimationFrame(el.__hsRaf);
  el.__hsTarget = to;
  const tick = () => {
    const cur = el.scrollLeft;
    const diff = el.__hsTarget - cur;
    if (Math.abs(diff) < 0.6) { el.scrollLeft = el.__hsTarget; el.__hsRaf = 0; return; }
    el.scrollLeft = cur + diff * 0.2;
    el.__hsRaf = requestAnimationFrame(tick);
  };
  el.__hsRaf = requestAnimationFrame(tick);
}

function enhance(wrap) {
  if (wrap.__hs) return;
  const table = wrap.querySelector(':scope > table');
  if (!table) return;

  const bar = document.createElement('div');
  bar.className = 'hs-bar';
  bar.hidden = true;
  bar.innerHTML =
    '<button type="button" class="hs-btn" aria-label="Scroll left" title="Scroll left">‹</button>' +
    '<div class="hs-track" role="scrollbar" aria-orientation="horizontal"><div class="hs-thumb"></div></div>' +
    '<button type="button" class="hs-btn" aria-label="Scroll right" title="Scroll right">›</button>' +
    '<span class="hs-hint">Shift + wheel to scroll sideways</span>';
  wrap.parentNode.insertBefore(bar, wrap);
  const [left, track, right] = [bar.children[0], bar.children[1], bar.children[2]];
  const thumb = track.firstChild;

  function update() {
    const overflow = table.offsetWidth - wrap.clientWidth > 2 || wrap.scrollWidth - wrap.clientWidth > 2;
    wrap.classList.toggle('hscroll-on', overflow);
    bar.hidden = !overflow;
    if (!overflow) return;
    const max = wrap.scrollWidth - wrap.clientWidth;
    const tw = track.clientWidth;
    const size = Math.max(36, (wrap.clientWidth / wrap.scrollWidth) * tw);
    thumb.style.width = size + 'px';
    thumb.style.transform = `translateX(${max > 0 ? (wrap.scrollLeft / max) * (tw - size) : 0}px)`;
    left.disabled = wrap.scrollLeft <= 1;
    right.disabled = wrap.scrollLeft >= max - 1;
  }

  left.addEventListener('click', () => smoothTo(wrap, (wrap.__hsTarget ?? wrap.scrollLeft) - wrap.clientWidth * STEP));
  right.addEventListener('click', () => smoothTo(wrap, (wrap.__hsTarget ?? wrap.scrollLeft) + wrap.clientWidth * STEP));

  // Shift + wheel (and trackpad sideways swipes) scroll smoothly
  wrap.addEventListener('wheel', (e) => {
    if (!wrap.classList.contains('hscroll-on')) return;
    const dx = e.shiftKey ? (e.deltaY || e.deltaX) : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
    if (!dx) return;
    e.preventDefault();
    const px = e.deltaMode === 1 ? dx * 40 : dx;
    smoothTo(wrap, (wrap.__hsTarget ?? wrap.scrollLeft) + px * 1.4);
  }, { passive: false });

  // Drag the thumb, or click the track to jump
  function jumpTo(clientX, grab) {
    const r = track.getBoundingClientRect();
    const size = thumb.offsetWidth;
    const max = wrap.scrollWidth - wrap.clientWidth;
    const x = Math.min(Math.max(clientX - r.left - grab, 0), r.width - size);
    wrap.scrollLeft = r.width - size > 0 ? (x / (r.width - size)) * max : 0;
    wrap.__hsTarget = wrap.scrollLeft;
  }
  track.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (wrap.__hsRaf) { cancelAnimationFrame(wrap.__hsRaf); wrap.__hsRaf = 0; }
    const onThumb = e.target === thumb;
    const grab = onThumb ? e.clientX - thumb.getBoundingClientRect().left : thumb.offsetWidth / 2;
    track.setPointerCapture(e.pointerId);
    track.classList.add('dragging');
    jumpTo(e.clientX, grab);
    const move = (ev) => jumpTo(ev.clientX, grab);
    const up = () => {
      track.classList.remove('dragging');
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
      track.removeEventListener('pointercancel', up);
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
  });

  wrap.addEventListener('scroll', () => {
    if (!wrap.__hsRaf) wrap.__hsTarget = wrap.scrollLeft;
    update();
  }, { passive: true });
  const ro = new ResizeObserver(update);
  ro.observe(wrap);
  ro.observe(table);
  update();

  wrap.__hs = { bar, ro, update };
}

function sweep() {
  document.querySelectorAll('.table-wrap').forEach((w) => {
    if (!w.__hs && w.isConnected) enhance(w);
  });
  // Remove toolbars whose table was removed by React
  document.querySelectorAll('.hs-bar').forEach((b) => {
    const next = b.nextElementSibling;
    if (!next || !next.__hs || next.__hs.bar !== b) b.remove();
  });
}

export function initHScroll() {
  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; sweep(); });
  };
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
  queue();
}