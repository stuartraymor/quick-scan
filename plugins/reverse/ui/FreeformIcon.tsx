// SPDX-License-Identifier: AGPL-3.0-only
import { useId } from 'react'
/** Original vector symbols; command names remain available to assistive tools. */
export function FreeformIcon({ name, size = 19 }: { name: string; size?: number }) {
  const id = useId().replaceAll(':', '')
  if (name === 'shaded' || name === 'deviation' || name === 'zebra') {
    // Original spherical symbols drawn from the observed display categories.
    // The icon palette is independent of the measured viewport color map.
    return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24">
      <defs>
        <clipPath id={`${id}-ball`}><circle cx="12" cy="12" r="10" /></clipPath>
        <radialGradient id={`${id}-shade`} cx="32%" cy="26%" r="75%">
          <stop offset="0" stopColor={name === 'shaded' ? '#84b8ec' : '#fff'} stopOpacity={name === 'shaded' ? 1 : .55} />
          <stop offset=".48" stopColor={name === 'shaded' ? '#3479b9' : '#fff'} stopOpacity={name === 'shaded' ? 1 : 0} />
          <stop offset="1" stopColor={name === 'shaded' ? '#102c51' : '#071b25'} stopOpacity={name === 'shaded' ? 1 : .7} />
        </radialGradient>
      </defs>
      <rect x=".5" y=".5" width="23" height="23" rx="1" fill="#263743" />
      <g clipPath={`url(#${id}-ball)`}>
        <circle cx="12" cy="12" r="10" fill={name === 'deviation' ? '#18dd37' : name === 'zebra' ? '#eee' : '#3479b9'} />
        {name === 'deviation' && <>
          <path fill="#128bda" d="M1 5Q10 1 15 8T24 15V24H0Z" />
          <path fill="#ffe928" d="M0 7Q8 1 15 5T24 4V0H0Z" />
          <path fill="#ec531e" d="M5 0H22V5Q13 1 5 4Z" />
          <path fill="#29e239" d="M1 10Q10 3 14 10T23 16L20 21Q15 15 10 14T1 16Z" />
        </>}
        {name === 'zebra' && <path fill="none" stroke="#121719" strokeWidth="3.2" d="M-1 3Q17 1 10 10T15 25 M5-3Q23 2 17 10T22 25 M-5 7Q10 6 4 15T8 26" />}
        <circle cx="12" cy="12" r="10" fill={`url(#${id}-shade)`} />
      </g>
      <circle cx="12" cy="12" r="10" fill="none" stroke="#162c3e" strokeWidth=".7" />
    </svg>
  }
  if (name === 'brush-faces' || name === 'brush-smooth') {
    return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" stroke="#315c79" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="22" height="22" fill="#b8dcf4" stroke="#87b9d8" strokeWidth=".7" />
      {name === 'brush-faces' ? <>
        <path d="M3 15 9 12 20 19 14 22Z" fill="#84b9db" stroke="#5a8bad" />
        <path d="M4 3Q3 2 3 5L10 13 13 10Z" fill="#e2eef3" />
        <path d="m10 12 3-3 3 3-3 3Z" fill="#788f9e" />
        <path d="m13 14 3-2q1 4 6 6-4 4-8 1Z" fill="#597b91" />
        <path d="m15 15 4 4m-5-3 3 4" stroke="#d4e4eb" strokeWidth=".8" />
      </> : <>
        <circle cx="12" cy="12" r="8.4" fill="#d5eaf5" />
        <path d="M4 12q4-7 8 0t8 0 M5 16q4-7 8-1t7-3" fill="none" strokeWidth="1.8" />
        <path d="m15 3 4 1-1 4" fill="none" />
      </>}
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
    close_hole: 'M3 3h16v16H3z M3 8h5V3 M14 3v5h5 M19 14h-5v5 M8 19v-5H3 M8 8h6v6H8z',
    crease: 'M2 16l9-10 9 10 M2 11l9-9 9 9',
    remove_crease: 'M2 16Q11 1 20 16 M2 11Q11 0 20 11',
    delete: 'M5 6h12l-1 14H6z M3 6h16 M8 6V3h6v3 M9 9v8 M13 9v8',
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] ?? paths.select} /></svg>
}
