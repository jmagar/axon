'use client'

import { createPlatePlugin } from 'platejs/react'
import { BlockDiscussion } from '@/components/ui/block-discussion'
import type { TComment } from '@/components/ui/comment'

export type TDiscussion = {
  id: string
  comments: TComment[]
  createdAt: Date
  isResolved: boolean
  userId: string
  documentContent?: string
}

const discussionsData: TDiscussion[] = [
  {
    id: 'discussion1',
    comments: [
      {
        id: 'comment1',
        contentRich: [
          {
            children: [
              {
                text: 'Comments are a great way to provide feedback and discuss changes.',
              },
            ],
            type: 'p',
          },
        ],
        createdAt: new Date(Date.now() - 600_000),
        discussionId: 'discussion1',
        isEdited: false,
        userId: 'charlie',
      },
      {
        id: 'comment2',
        contentRich: [
          {
            children: [
              {
                text: 'Agreed! The link to the docs makes it easy to learn more.',
              },
            ],
            type: 'p',
          },
        ],
        createdAt: new Date(Date.now() - 500_000),
        discussionId: 'discussion1',
        isEdited: false,
        userId: 'bob',
      },
    ],
    createdAt: new Date(),
    documentContent: 'comments',
    isResolved: false,
    userId: 'charlie',
  },
  {
    id: 'discussion2',
    comments: [
      {
        id: 'comment1',
        contentRich: [
          {
            children: [
              {
                text: 'Nice demonstration of overlapping annotations with both comments and suggestions!',
              },
            ],
            type: 'p',
          },
        ],
        createdAt: new Date(Date.now() - 300_000),
        discussionId: 'discussion2',
        isEdited: false,
        userId: 'bob',
      },
      {
        id: 'comment2',
        contentRich: [
          {
            children: [
              {
                text: 'This helps users understand how powerful the editor can be.',
              },
            ],
            type: 'p',
          },
        ],
        createdAt: new Date(Date.now() - 200_000),
        discussionId: 'discussion2',
        isEdited: false,
        userId: 'charlie',
      },
    ],
    createdAt: new Date(),
    documentContent: 'overlapping',
    isResolved: false,
    userId: 'bob',
  },
]

// Local inline-SVG initials avatar — no external network requests (self-hosted policy)
const avatarUrl = (initial: string, bg: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="16" fill="${bg}"/><text x="16" y="22" text-anchor="middle" font-size="14" font-family="sans-serif" fill="white">${initial}</text></svg>`)}`

const usersData: Record<string, { id: string; avatarUrl: string; name: string; hue?: number }> = {
  alice: {
    id: 'alice',
    avatarUrl: avatarUrl('A', '#5b7dd8'),
    name: 'Alice',
  },
  bob: {
    id: 'bob',
    avatarUrl: avatarUrl('B', '#6c8fbf'),
    name: 'Bob',
  },
  charlie: {
    id: 'charlie',
    avatarUrl: avatarUrl('C', '#7a6ab5'),
    name: 'Charlie',
  },
}

// This plugin is purely UI. It's only used to store the discussions and users data
export const discussionPlugin = createPlatePlugin({
  key: 'discussion',
  options: {
    currentUserId: 'alice',
    discussions: discussionsData,
    users: usersData,
  },
})
  .configure({
    render: { aboveNodes: BlockDiscussion },
  })
  .extendSelectors(({ getOption }) => ({
    currentUser: () => getOption('users')[getOption('currentUserId')],
    user: (id: string) => getOption('users')[id],
  }))

export const DiscussionKit = [discussionPlugin]
