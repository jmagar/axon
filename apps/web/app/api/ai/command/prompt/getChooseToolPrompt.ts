import dedent from 'dedent'
import type { ChatMessage } from '@/components/editor/use-chat'

import { buildStructuredPrompt, formatTextFromMessages, getLastUserInstruction } from '../utils'

const GENERATE_EXAMPLES = [
  dedent`
    <instruction>
    Write a paragraph about AI ethics
    </instruction>

    <output>
    generate
    </output>
  `,
  dedent`
    <instruction>
    Create a short poem about spring
    </instruction>

    <output>
    generate
    </output>
  `,
  dedent`
    <instruction>
    Summarize this text
    </instruction>

    <output>
    generate
    </output>
  `,
  dedent`
    <instruction>
    List three key takeaways from this
    </instruction>

    <output>
    generate
    </output>
  `,
]

const EDIT_EXAMPLES = [
  dedent`
    <instruction>
    Please fix grammar.
    </instruction>

    <output>
    edit
    </output>
  `,
  dedent`
    <instruction>
    Improving writing style.
    </instruction>

    <output>
    edit
    </output>
  `,
  dedent`
    <instruction>
    Making it more concise.
    </instruction>

    <output>
    edit
    </output>
  `,
  dedent`
    <instruction>
    Translate this paragraph into French
    </instruction>

    <output>
    edit
    </output>
  `,
]

const COMMENT_EXAMPLES = [
  dedent`
    <instruction>
    Can you review this text and give me feedback?
    </instruction>

    <output>
    comment
    </output>
  `,
  dedent`
    <instruction>
    Add inline comments to this code to explain what it does
    </instruction>

    <output>
    comment
    </output>
  `,
]

const BASE_RULES = dedent`
  - Default is "generate". Any open question, idea request, creation request, summarization, or explanation → "generate".
  - Only return "comment" if the user explicitly asks for comments, feedback, annotations, or review. Do not infer "comment" implicitly.
  - Return only one enum value with no explanation.
  - CRITICAL: Examples are for format reference only. NEVER output content from examples.
`.trim()

const EDIT_RULE = dedent`
  - Return "edit" only for requests that require rewriting the selected text as a replacement in-place (e.g., fix grammar, improve writing, make shorter/longer, translate, simplify).
  - Requests like summarize/explain/extract/takeaways/table/questions should be "generate" even if text is selected.
`.trim()

const TASK_WHEN_SELECTING =
  'You are a strict classifier. Classify the user\'s last request as "generate", "edit", or "comment".'
const TASK_WITHOUT_SELECTION =
  'You are a strict classifier. Classify the user\'s last request as "generate" or "comment".'

function buildExamples(isSelecting: boolean) {
  return isSelecting
    ? [...GENERATE_EXAMPLES, ...EDIT_EXAMPLES, ...COMMENT_EXAMPLES]
    : [...GENERATE_EXAMPLES, ...COMMENT_EXAMPLES]
}

function buildRules(isSelecting: boolean) {
  return isSelecting ? `${BASE_RULES}\n${EDIT_RULE}` : BASE_RULES
}

export interface GetChooseToolPromptParams {
  isSelecting: boolean
  messages: ChatMessage[]
}

export function getChooseToolPrompt({ isSelecting, messages }: GetChooseToolPromptParams) {
  const examples = buildExamples(isSelecting)
  const rules = buildRules(isSelecting)
  const task = isSelecting ? TASK_WHEN_SELECTING : TASK_WITHOUT_SELECTION

  return buildStructuredPrompt({
    examples,
    history: formatTextFromMessages(messages),
    instruction: getLastUserInstruction(messages),
    rules,
    task,
  })
}
