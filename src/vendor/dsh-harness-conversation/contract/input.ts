import type { ReferenceInsert as HarnessReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Minimal type bridge used by the official Harness Lexical editor source. */
export type { ArbitrateKey, ArbitrateOutcome } from '@deepseek-ai/dsh-client-ui-conversation/client'
export type ReferenceInsert = HarnessReferenceInsert

export interface Occurrence {
  readonly occurrenceId: number
  readonly source: string
  readonly ref: string
  readonly offset: number
  readonly length: number
  readonly label: string
  readonly appearance?: ReferenceInsert['appearance']
  readonly clipboardText: string
  readonly invalid?: boolean
}
