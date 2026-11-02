// SPDX-License-Identifier: AGPL-3.0-only
import { wandCursor } from './wandCursor'

/** Own only the cursor written for the active wand. Other viewport tools
 * may replace it; releasing the wand must not erase their newer cursor. */
export class WandCursorOwner {
  private owned: string | null = null

  update(style: Pick<CSSStyleDeclaration, 'cursor'>, active: boolean, navigating: boolean, overGizmo: boolean): boolean {
    if (active) {
      style.cursor = navigating ? 'grabbing' : overGizmo ? 'pointer' : wandCursor
      this.owned = style.cursor
      return false
    }
    if (this.owned === null) return false
    if (style.cursor === this.owned) style.cursor = overGizmo ? 'pointer' : ''
    this.owned = null
    return true
  }
}
