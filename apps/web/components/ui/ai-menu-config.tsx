import { AIChatPlugin, AIPlugin } from '@platejs/ai/react'
import {
  Album,
  BadgeHelp,
  BookOpenCheck,
  Check,
  CornerUpLeft,
  FeatherIcon,
  ListEnd,
  ListMinus,
  ListPlus,
  PenLine,
  SmileIcon,
  Wand,
  X,
} from 'lucide-react'
import { NodeApi, type SlateEditor } from 'platejs'
import type { PlateEditor } from 'platejs/react'
import type * as React from 'react'

export type EditorChatState =
  | 'cursorCommand'
  | 'cursorSuggestion'
  | 'selectionCommand'
  | 'selectionSuggestion'

const AICommentIcon = () => (
  <svg
    fill="none"
    height="24"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width="24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M0 0h24v24H0z" fill="none" stroke="none" />
    <path d="M8 9h8" />
    <path d="M8 13h4.5" />
    <path d="M10 19l-1 -1h-3a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v4.5" />
    <path d="M17.8 20.817l-2.172 1.138a.392 .392 0 0 1 -.568 -.41l.415 -2.411l-1.757 -1.707a.389 .389 0 0 1 .217 -.665l2.428 -.352l1.086 -2.193a.392 .392 0 0 1 .702 0l1.086 2.193l2.428 .352a.39 .39 0 0 1 .217 .665l-1.757 1.707l.414 2.41a.39 .39 0 0 1 -.567 .411l-2.172 -1.138z" />
  </svg>
)

export interface AIMenuSelectCtx {
  aiEditor: SlateEditor
  editor: PlateEditor
  input: string
}

export interface AIMenuItem {
  icon: React.ReactNode
  label: string
  value: string
  shortcut?: string
  onSelect?: (ctx: AIMenuSelectCtx) => void
}

export const aiChatItems = {
  accept: {
    icon: <Check />,
    label: 'Accept',
    value: 'accept',
    onSelect: ({ aiEditor, editor }) => {
      const { mode, toolName } = editor.getOptions(AIChatPlugin)

      if (mode === 'chat' && toolName === 'generate') {
        return editor.getTransforms(AIChatPlugin).aiChat.replaceSelection(aiEditor)
      }

      editor.getTransforms(AIChatPlugin).aiChat.accept()
      editor.tf.focus({ edge: 'end' })
    },
  },
  comment: {
    icon: <AICommentIcon />,
    label: 'Comment',
    value: 'comment',
    onSelect: ({ editor, input }) => {
      editor.getApi(AIChatPlugin).aiChat.submit(input, {
        mode: 'insert',
        prompt:
          'Please comment on the following content and provide reasonable and meaningful feedback.',
        toolName: 'comment',
      })
    },
  },
  continueWrite: {
    icon: <PenLine />,
    label: 'Continue writing',
    value: 'continueWrite',
    onSelect: ({ editor, input }) => {
      const ancestorNode = editor.api.block({ highest: true })

      if (!ancestorNode) return

      const isEmpty = NodeApi.string(ancestorNode[0]).trim().length === 0

      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        mode: 'insert',
        prompt: isEmpty
          ? `<Document>
{editor}
</Document>
Start writing a new paragraph AFTER <Document> ONLY ONE SENTENCE`
          : 'Continue writing AFTER <Block> ONLY ONE SENTENCE. DONT REPEAT THE TEXT.',
        toolName: 'generate',
      })
    },
  },
  discard: {
    icon: <X />,
    label: 'Discard',
    shortcut: 'Escape',
    value: 'discard',
    onSelect: ({ editor }) => {
      editor.getTransforms(AIPlugin).ai.undo()
      editor.getApi(AIChatPlugin).aiChat.hide()
    },
  },
  emojify: {
    icon: <SmileIcon />,
    label: 'Emojify',
    value: 'emojify',
    onSelect: ({ editor, input }) => {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        prompt:
          'Add a small number of contextually relevant emojis within each block only. You may insert emojis, but do not remove, replace, or rewrite existing text, and do not modify Markdown syntax, links, or line breaks.',
        toolName: 'edit',
      })
    },
  },
  explain: {
    icon: <BadgeHelp />,
    label: 'Explain',
    value: 'explain',
    onSelect: ({ editor, input }) => {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        prompt: {
          default: 'Explain {editor}',
          selecting: 'Explain',
        },
        toolName: 'generate',
      })
    },
  },
  fixSpelling: {
    icon: <Check />,
    label: 'Fix spelling & grammar',
    value: 'fixSpelling',
    onSelect: ({ editor, input }) => {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        prompt:
          'Fix spelling, grammar, and punctuation errors within each block only, without changing meaning, tone, or adding new information.',
        toolName: 'edit',
      })
    },
  },
  generateMarkdownSample: {
    icon: <BookOpenCheck />,
    label: 'Generate Markdown sample',
    value: 'generateMarkdownSample',
    onSelect: ({ editor, input }) => {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        prompt: 'Generate a markdown sample',
        toolName: 'generate',
      })
    },
  },
  generateMdxSample: {
    icon: <BookOpenCheck />,
    label: 'Generate MDX sample',
    value: 'generateMdxSample',
    onSelect: ({ editor, input }) => {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        prompt: 'Generate a mdx sample',
        toolName: 'generate',
      })
    },
  },
  improveWriting: {
    icon: <Wand />,
    label: 'Improve writing',
    value: 'improveWriting',
    onSelect: ({ editor, input }) => {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        prompt:
          'Improve the writing for clarity and flow, without changing meaning or adding new information.',
        toolName: 'edit',
      })
    },
  },
  insertBelow: {
    icon: <ListEnd />,
    label: 'Insert below',
    value: 'insertBelow',
    onSelect: ({ aiEditor, editor }) => {
      void editor.getTransforms(AIChatPlugin).aiChat.insertBelow(aiEditor, { format: 'none' })
    },
  },
  makeLonger: {
    icon: <ListPlus />,
    label: 'Make longer',
    value: 'makeLonger',
    onSelect: ({ editor, input }) => {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        prompt:
          'Make the content longer by elaborating on existing ideas within each block only, without changing meaning or adding new information.',
        toolName: 'edit',
      })
    },
  },
  makeShorter: {
    icon: <ListMinus />,
    label: 'Make shorter',
    value: 'makeShorter',
    onSelect: ({ editor, input }) => {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        prompt:
          'Make the content shorter by reducing verbosity within each block only, without changing meaning or removing essential information.',
        toolName: 'edit',
      })
    },
  },
  replace: {
    icon: <Check />,
    label: 'Replace selection',
    value: 'replace',
    onSelect: ({ aiEditor, editor }) => {
      void editor.getTransforms(AIChatPlugin).aiChat.replaceSelection(aiEditor)
    },
  },
  simplifyLanguage: {
    icon: <FeatherIcon />,
    label: 'Simplify language',
    value: 'simplifyLanguage',
    onSelect: ({ editor, input }) => {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        prompt:
          'Simplify the language by using clearer and more straightforward wording within each block only, without changing meaning or adding new information.',
        toolName: 'edit',
      })
    },
  },
  summarize: {
    icon: <Album />,
    label: 'Add a summary',
    value: 'summarize',
    onSelect: ({ editor, input }) => {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        mode: 'insert',
        prompt: {
          default: 'Summarize {editor}',
          selecting: 'Summarize',
        },
        toolName: 'generate',
      })
    },
  },
  tryAgain: {
    icon: <CornerUpLeft />,
    label: 'Try again',
    value: 'tryAgain',
    onSelect: ({ editor }) => {
      void editor.getApi(AIChatPlugin).aiChat.reload()
    },
  },
} satisfies Record<string, AIMenuItem>

export const menuStateItems: Record<
  EditorChatState,
  {
    items: AIMenuItem[]
    heading?: string
  }[]
> = {
  cursorCommand: [
    {
      items: [
        aiChatItems.comment,
        aiChatItems.generateMdxSample,
        aiChatItems.generateMarkdownSample,
        aiChatItems.continueWrite,
        aiChatItems.summarize,
        aiChatItems.explain,
      ],
    },
  ],
  cursorSuggestion: [
    {
      items: [aiChatItems.accept, aiChatItems.discard, aiChatItems.tryAgain],
    },
  ],
  selectionCommand: [
    {
      items: [
        aiChatItems.improveWriting,
        aiChatItems.comment,
        aiChatItems.emojify,
        aiChatItems.makeLonger,
        aiChatItems.makeShorter,
        aiChatItems.fixSpelling,
        aiChatItems.simplifyLanguage,
      ],
    },
  ],
  selectionSuggestion: [
    {
      items: [
        aiChatItems.accept,
        aiChatItems.discard,
        aiChatItems.insertBelow,
        aiChatItems.tryAgain,
      ],
    },
  ],
}
