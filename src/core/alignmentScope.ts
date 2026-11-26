// SPDX-License-Identifier: AGPL-3.0-only
export interface AlignmentScope { features:boolean; importedCad:boolean }
export const defaultAlignmentScope:AlignmentScope={features:true,importedCad:false}
// Store subscribers run synchronously inside the alignment transaction.
let applying:AlignmentScope|null=null
export const activeAlignmentScope=()=>applying
export function withAlignmentScope<T>(scope:AlignmentScope,work:()=>T):T {
  const before=applying
  applying=scope
  try{return work()}finally{applying=before}
}
