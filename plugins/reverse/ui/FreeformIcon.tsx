// SPDX-License-Identifier: AGPL-3.0-only
/** Original vector symbols; command names remain available to assistive tools. */
export function FreeformIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    extrapolate: 'M3 19l7-7 4 2 7-11 M15 3h6v6 M2 18h3v3H2z M9 11h3v3H9z',
    smooth: 'M2 9l5-4 5 4 5-4 5 4 M2 18Q7 8 12 18T22 18',
    snap: 'M2 19Q12 2 22 12 M4 4v8 M1 9l3 3 3-3 M15 8h3v3h-3z',
    resolution: 'M3 3h18v18H3z M9 3v18 M15 3v18 M3 9h18 M3 15h18',
    select: 'M3 3h16v16H3z M3 3l6 5-3 2z M13 12l6 7 M13 12v6 M13 12h6',
    points: 'M4 4h3v3H4z M17 4h3v3h-3z M4 17h3v3H4z M17 17h3v3h-3z M6 6h12v12H6z',
    edges: 'M4 4h16v16H4z M4 4l16 16 M3 3h3v3H3z M18 18h3v3h-3z',
    'align-h': 'M2 5h20 M4 10h4v4H4z M10 10h4v4h-4z M16 10h4v4h-4z M3 19h18',
    'align-v': 'M5 2v20 M10 4h4v4h-4z M10 10h4v4h-4z M10 16h4v4h-4z M19 3v18',
    undo: 'M7 5L2 10l5 5 M2 10h11q8 0 8 9',
    redo: 'M17 5l5 5-5 5 M22 10H11q-8 0-8 9',
    faces: 'M3 3h16v16H3z M3 11h16 M11 3v16',
    split: 'M3 3h16v16H3z M11 3v16 M8 8l3-3 3 3 M8 14l3 3 3-3',
    bridge: 'M2 3v16 M20 3v16 M2 7h18 M2 15h18 M7 7v8 M15 7v8',
    close_hole: 'M3 3h16v16H3z M3 8h5V3 M14 3v5h5 M19 14h-5v5 M8 19v-5H3 M8 8h6v6H8z',
    crease: 'M2 16l9-10 9 10 M2 11l9-9 9 9',
    remove_crease: 'M2 16Q11 1 20 16 M2 11Q11 0 20 11',
    delete: 'M5 6h12l-1 14H6z M3 6h16 M8 6V3h6v3 M9 9v8 M13 9v8',
    shaded: 'M11 2l9 5v10l-9 5-9-5V7z M2 7l9 5 9-5 M11 12v10',
    deviation: 'M11 2l9 5v10l-9 5-9-5V7z M2 7l9 5 9-5 M11 12v10',
    zebra: 'M11 2l9 5v10l-9 5-9-5V7z M3 8c6 1 10 5 17 2 M3 13c7 0 9 5 17 3 M7 20c3-5 8-5 12-4',
  }
  return <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill={name === 'shaded' ? '#4f8ed0' : name === 'deviation' ? '#49c85c' : name === 'zebra' ? '#292d31' : 'none'} stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round"><path d={paths[name] ?? paths.select} /></svg>
}
