'use client'

import { useAIChatEditor } from '@platejs/ai/react'
import { usePlateEditor } from 'platejs/react'
import * as React from 'react'

import { BaseEditorKit } from '@/components/editor/editor-base-kit'

import { EditorStatic } from './editor-static'

export interface AIChatEditorProps {
  content: string
}

export const AIChatEditor = React.memo(function AIChatEditor({ content }: AIChatEditorProps) {
  const aiEditor = usePlateEditor({
    plugins: BaseEditorKit,
  })

  const value = useAIChatEditor(aiEditor, content)

  return <EditorStatic variant="aiChat" editor={aiEditor} value={value} />
})
