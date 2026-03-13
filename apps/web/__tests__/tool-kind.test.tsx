/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  inferToolKind,
  Tool,
  ToolContent,
  ToolHeader,
  toolKindLabel,
} from '@/components/ai-elements/tool'

describe('inferToolKind', () => {
  it('classifies MCP tools by mcp__ namespace', () => {
    expect(inferToolKind('mcp__chrome-dev-tools__click')).toBe('mcp')
  })

  it('classifies terminal tools', () => {
    expect(inferToolKind('exec_command')).toBe('terminal')
    expect(inferToolKind('write_stdin')).toBe('terminal')
  })

  it('classifies file tools', () => {
    expect(inferToolKind('read_file')).toBe('file')
    expect(inferToolKind('apply_patch')).toBe('file')
  })

  it('classifies skills', () => {
    expect(inferToolKind('axon:search')).toBe('skill')
  })

  it('classifies search/web tools', () => {
    expect(inferToolKind('search_query')).toBe('search')
  })

  it('falls back to generic tool kind', () => {
    expect(inferToolKind('some_custom_tool')).toBe('tool')
  })
})

describe('ToolHeader', () => {
  it('renders a kind chip for MCP tools', () => {
    render(
      <Tool defaultOpen>
        <ToolHeader
          title="mcp__chrome-dev-tools__click"
          description="Running"
          kind={inferToolKind('mcp__chrome-dev-tools__click')}
        />
        <ToolContent>body</ToolContent>
      </Tool>,
    )

    expect(screen.getByText(toolKindLabel('mcp'))).toBeTruthy()
  })

  it('renders dense metadata badges', () => {
    render(
      <Tool defaultOpen>
        <ToolHeader title="exec_command" badges={['shell', '#1', '22 ms']} />
        <ToolContent>body</ToolContent>
      </Tool>,
    )

    expect(screen.getByText('shell')).toBeTruthy()
    expect(screen.getByText('#1')).toBeTruthy()
    expect(screen.getByText('22 ms')).toBeTruthy()
  })
})
