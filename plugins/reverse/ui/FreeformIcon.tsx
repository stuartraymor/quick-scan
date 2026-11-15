// SPDX-License-Identifier: AGPL-3.0-only
/** Original vector symbols; command names remain available to assistive tools. */
export function FreeformIcon({ name, size = 19 }: { name: string; size?: number }) {
  if (name === 'shaded' || name === 'deviation' || name === 'zebra') {
    const [top, left, right] = name === 'shaded'
      ? ['#78bafa', '#397bc1', '#24528e']
      : name === 'deviation' ? ['#ffd13d', '#35cb67', '#168cd7'] : ['#d7dde4', '#393f48', '#707983']
    return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" strokeLinejoin="round">
      <path fill={top} d="M2 7 12 2 22 7 12 12Z" />
      <path fill={left} d="M2 7 12 12V22L2 17Z" />
      <path fill={right} d="M12 12 22 7V17L12 22Z" />
      {name === 'deviation' && <path fill="#ec5840" d="M7 7 12 4.5 17 7 12 9.5Z" />}
      {name === 'zebra' && <path fill="none" stroke="#f0f3f7" strokeWidth="1.6" d="M2 10 12 15 22 10 M2 14 12 19 22 14" />}
      <path fill="none" stroke="currentColor" strokeWidth="1.2" d="M2 7 12 2 22 7V17L12 22 2 17Z M2 7 12 12 22 7 M12 12V22" />
    </svg>
  }
  const paths: Record<string, string> = {
    isolate: 'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5 M5 12q7-8 14 0-7 8-14 0Z M14 12a2 2 0 1 0-4 0 2 2 0 1 0 4 0Z',
    hide: 'M3 3l18 18 M4 9l-2 3q5 6 10 6h2 M8 6q7-2 14 6l-3 3',
    show: 'M2 12q10-12 20 0-10 12-20 0Z M15 12a3 3 0 1 0-6 0 3 3 0 1 0 6 0Z',
    extrapolate: 'M3 19l7-7 4 2 7-11 M15 3h6v6 M2 18h3v3H2z M9 11h3v3H9z',
    smooth: 'M2 9l5-4 5 4 5-4 5 4 M2 18Q7 8 12 18T22 18',
    snap: 'M2 19Q12 2 22 12 M4 4v8 M1 9l3 3 3-3 M15 8h3v3h-3z',
    resolution: 'M2 2h20v20H2z M7 2v20 M12 2v20 M17 2v20 M2 7h20 M2 12h20 M2 17h20',
    select: 'M3 3h16v16H3z M3 3l6 5-3 2z M13 12l6 7 M13 12v6 M13 12h6',
    points: 'M4 4h3v3H4z M17 4h3v3h-3z M4 17h3v3H4z M17 17h3v3h-3z M6 6h12v12H6z',
    edges: 'M4 4h16v16H4z M4 4l16 16 M3 3h3v3H3z M18 18h3v3h-3z',
    'align-h': 'M2 5h20 M4 10h4v4H4z M10 10h4v4h-4z M16 10h4v4h-4z M3 19h18',
    'align-v': 'M5 2v20 M10 4h4v4h-4z M10 10h4v4h-4z M10 16h4v4h-4z M19 3v18',
    undo: 'M7 5L2 10l5 5 M2 10h11q8 0 8 9',
    redo: 'M17 5l5 5-5 5 M22 10H11q-8 0-8 9',
    faces: 'M3 3h16v16H3z M3 11h16 M11 3v16',
    split: 'M2 2h20v20H2z M12 2v20 M2 12h20',
    bridge: 'M2 2h20v20H2z M8 2v20 M16 2v20 M2 12h6 M16 12h6 M8 8h8 M8 16h8',
    commands: 'M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20Z M7.5 12h.1 M12 12h.1 M16.5 12h.1',
    'add-face': 'M5 3l14 3-2 15-14-3Z M4 1h2v4H4z M18 4h2v4h-2z M16 19h2v4h-2z M2 16h2v4H2z',
    rectangle: 'M4 4h16v16H4Z M2 2h4v4H2z M18 18h4v4h-4z',
    'brush-faces': 'M2 3h20v18H2z M3 5l9 6 1 4 8 5 M4 5l9 5 3 4',
    'brush-smooth': 'M2 8q5-8 10 0t10 0 M2 17q5 8 10 0t10 0 M5 12q7-5 14 0',
    close_hole: 'M3 3h16v16H3z M3 8h5V3 M14 3v5h5 M19 14h-5v5 M8 19v-5H3 M8 8h6v6H8z',
    crease: 'M2 16l9-10 9 10 M2 11l9-9 9 9',
    remove_crease: 'M2 16Q11 1 20 16 M2 11Q11 0 20 11',
    delete: 'M5 6h12l-1 14H6z M3 6h16 M8 6V3h6v3 M9 9v8 M13 9v8',
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] ?? paths.select} /></svg>
}
