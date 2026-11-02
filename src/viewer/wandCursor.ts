// SPDX-License-Identifier: AGPL-3.0-only
// Original artwork. The star tip is the pick point; CSS pixels keep its
// hit position consistent across display scaling. Never applied to panels.
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M11 12L27 28" stroke="#111" stroke-width="6" stroke-linecap="round"/><path d="M11 12L27 28" stroke="white" stroke-width="3" stroke-linecap="round"/><path d="M10 2L12 7L17 9L12 11L10 16L8 11L3 9L8 7Z" fill="#ffe073" stroke="#111" stroke-width="1.5"/><path d="M23 2V8M20 5H26M2 20V24M0 22H4" stroke="white" stroke-width="1.5"/></svg>'
export const wandCursor = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") 10 9, crosshair'
