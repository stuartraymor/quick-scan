// SPDX-License-Identifier: AGPL-3.0-only
// Where a box sits in the view's bottom-right corner, as QUICKSURFACE puts
// its hints and its save warning: clear of the view bar along the bottom,
// whose keys it would otherwise cover.

/** The `right` and `bottom` of a corner box, px from the window's edges. */
export function cornerBoxPlace(view: DOMRect): { right: number; bottom: number } {
  const bar = document.querySelector('[data-test="view-bar"]')?.getBoundingClientRect()
  const above = bar && bar.height > 0 && bar.right > view.right - 400 ? view.bottom - bar.top + 8 : 12
  return { right: window.innerWidth - view.right + 12, bottom: window.innerHeight - view.bottom + above }
}
