import { faker } from '@faker-js/faker'

const delay = faker.number.int({ max: 20, min: 5 })

const mdxBasicChunks = [
  {
    delay,
    texts: '## ',
  },
  {
    delay,
    texts: 'Basic ',
  },
  {
    delay,
    texts: 'Markdown\n\n',
  },
  {
    delay,
    texts: '> ',
  },
  {
    delay,
    texts: 'The ',
  },
  {
    delay,
    texts: 'following ',
  },
  {
    delay,
    texts: 'node ',
  },
  {
    delay,
    texts: 'and ',
  },
  {
    delay,
    texts: 'marks ',
  },
  {
    delay,
    texts: 'is ',
  },
  {
    delay,
    texts: 'supported ',
  },
  {
    delay,
    texts: 'by ',
  },
  {
    delay,
    texts: 'the ',
  },
  {
    delay,
    texts: 'Markdown ',
  },
  {
    delay,
    texts: 'standard.\n\n',
  },
  {
    delay,
    texts: 'Format ',
  },
  {
    delay,
    texts: 'text ',
  },
  {
    delay,
    texts: 'with **b',
  },
  {
    delay,
    texts: 'old**, _',
  },
  {
    delay,
    texts: 'italic_,',
  },
  {
    delay,
    texts: ' _**comb',
  },
  {
    delay,
    texts: 'ined sty',
  },
  {
    delay,
    texts: 'les**_, ',
  },
  {
    delay,
    texts: '~~strike',
  },
  {
    delay,
    texts: 'through~',
  },
  {
    delay,
    texts: '~, `code',
  },
  {
    delay,
    texts: '` format',
  },
  {
    delay,
    texts: 'ting, an',
  },
  {
    delay,
    texts: 'd [hyper',
  },
  {
    delay,
    texts: 'links](https://en.wikipedia.org/wiki/Hypertext).\n\n',
  },
  {
    delay,
    texts: '```javascript\n',
  },
  {
    delay,
    texts: '// Use code blocks to showcase code snippets\n',
  },
  {
    delay,
    texts: 'function greet() {\n',
  },
  {
    delay,
    texts: '  console.info("Hello World!")\n',
  },
  {
    delay,
    texts: '}\n',
  },
  {
    delay,
    texts: '```\n\n',
  },
  {
    delay,
    texts: '- Simple',
  },
  {
    delay,
    texts: ' lists f',
  },
  {
    delay,
    texts: 'or organ',
  },
  {
    delay,
    texts: 'izing co',
  },
  {
    delay,
    texts: 'ntent\n',
  },
  {
    delay,
    texts: '1. ',
  },
  {
    delay,
    texts: 'Numbered ',
  },
  {
    delay,
    texts: 'lists ',
  },
  {
    delay,
    texts: 'for ',
  },
  {
    delay,
    texts: 'sequential ',
  },
  {
    delay,
    texts: 'steps\n\n',
  },
  {
    delay,
    texts: '| **Plugin**  | **Element** | **Inline** | **Void** |\n',
  },
  {
    delay,
    texts: '| ----------- | ----------- | ---------- | -------- |\n',
  },
  {
    delay,
    texts: '| **Heading** |             |            | No       |\n',
  },
  {
    delay,
    texts: '| **Image**   | Yes         | No         | Yes      |\n',
  },
  {
    delay,
    texts: '| **Ment',
  },
  {
    delay,
    texts: 'ion** | Yes         | Yes        | Yes      |\n\n',
  },
  {
    delay,
    texts:
      '![](https://images.unsplash.com/photo-1712688930249-98e1963af7bd?q=80&w=2070&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D)\n\n',
  },
  {
    delay,
    texts: '- [x] Co',
  },
  {
    delay,
    texts: 'mpleted ',
  },
  {
    delay,
    texts: 'tasks\n',
  },
  {
    delay,
    texts: '- [ ] Pe',
  },
  {
    delay,
    texts: 'nding ta',
  },
  {
    delay,
    texts: 'sks\n\n',
  },
]

export { mdxBasicChunks }
