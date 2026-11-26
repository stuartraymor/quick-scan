// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'

import type { Vec3 } from '../../../src/core/types'
export type TrimPickState = { removed?: { body: number; at: Vec3 }[]; corrections?: { at: Vec3; keep: boolean }[] }
export type TrimView = 'remaining' | 'removed' | 'all'
const initial = { view: 'remaining' as TrimView, wireframe: false, hidden: [] as number[], history: [] as TrimPickState[] }
export const useTrimDisplay = create(() => initial)
export const resetTrimDisplay = () => useTrimDisplay.setState(initial)
