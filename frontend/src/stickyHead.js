// Keeps a wide table's header row just under the page banner while the PAGE scrolls.
// CSS "position: sticky" cannot do this here: the table's box scrolls sideways, and a header inside a
// sideways-scrolling box can only stick to that box, never to the window. So the header cells are moved
// down by exactly the distance the table has gone up behind the banner (CSS variable --head-shift).
export function followHeader(wrap) {
  const table = wrap?.querySelector(':scope > table');
  const head = table?.tHead;
  if (!head) return () => {};

  const update = () => {
    // the lowest edge of whatever stays fixed at the top of the screen (page banner; the menu bar on phones)
    let edge = 0;
    document.querySelectorAll('.page-header, .mobile-bar').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height && r.top <= 1) edge = Math.max(edge, r.bottom);
    });
    const r = table.getBoundingClientRect();
    const max = Math.max(0, r.height - head.offsetHeight - 40); // never past the last row
    const shift = Math.min(max, Math.max(0, edge - r.top));
    table.style.setProperty('--head-shift', `${shift}px`);
  };

  window.addEventListener('scroll', update, { passive: true, capture: true });
  window.addEventListener('resize', update);
  const ro = new ResizeObserver(update);
  ro.observe(table);
  update();

  return () => {
    window.removeEventListener('scroll', update, { capture: true });
    window.removeEventListener('resize', update);
    ro.disconnect();
  };
}
