import { faker } from '@faker-js/faker'

const delay = faker.number.int({ max: 20, min: 5 })

const mdxMediaChunks = [
  {
    delay,
    texts: 'The ',
  },
  {
    delay,
    texts: 'table ',
  },
  {
    delay,
    texts: 'of ',
  },
  {
    delay,
    texts: 'contents ',
  },
  {
    delay,
    texts: 'feature ',
  },
  {
    delay,
    texts: 'automatically ',
  },
  {
    delay,
    texts: 'generates ',
  },
  {
    delay,
    texts: 'document ',
  },
  {
    delay,
    texts: 'structure ',
  },
  {
    delay,
    texts: 'for ',
  },
  {
    delay,
    texts: 'easy ',
  },
  {
    delay,
    texts: 'navigation.\n\n',
  },
  {
    delay,
    texts: '<toc ',
  },
  {
    delay,
    texts: '/>\n\n',
  },
  {
    delay,
    texts: 'Math ',
  },
  {
    delay,
    texts: 'formula ',
  },
  {
    delay,
    texts: 'support ',
  },
  {
    delay,
    texts: 'makes ',
  },
  {
    delay,
    texts: 'displaying ',
  },
  {
    delay,
    texts: 'complex ',
  },
  {
    delay,
    texts: 'mathematical ',
  },
  {
    delay,
    texts: 'expressions ',
  },
  {
    delay,
    texts: 'simple.\n\n',
  },
  {
    delay,
    texts: '$$\n',
  },
  {
    delay,
    texts: 'a^2',
  },
  {
    delay,
    texts: '+b^2',
  },
  {
    delay,
    texts: '=c^2\n',
  },
  {
    delay,
    texts: '$$\n\n',
  },
  {
    delay,
    texts: 'Multi-co',
  },
  {
    delay,
    texts: 'lumn lay',
  },
  {
    delay,
    texts: 'out feat',
  },
  {
    delay,
    texts: 'ures ena',
  },
  {
    delay,
    texts: 'ble rich',
  },
  {
    delay,
    texts: 'er page ',
  },
  {
    delay,
    texts: 'designs ',
  },
  {
    delay,
    texts: 'and cont',
  },
  {
    delay,
    texts: 'ent layo',
  },
  {
    delay,
    texts: 'uts.\n\n',
  },
  // {
  //  delay,
  //   texts: '<column_group layout="[50,50]">\n',
  // },
  // {
  //  delay,
  //   texts: '<column width="50%">\n',
  // },
  // {
  //  delay,
  //   texts: '  left\n',
  // },
  // {
  //  delay,
  //   texts: '</column>\n',
  // },
  // {
  //  delay,
  //   texts: '<column width="50%">\n',
  // },
  // {
  //  delay,
  //   texts: '  right\n',
  // },
  // {
  //  delay,
  //   texts: '</column>\n',
  // },
  // {
  //  delay,
  //   texts: '</column_group>\n\n',
  // },
  {
    delay,
    texts: 'PDF ',
  },
  {
    delay,
    texts: 'embedding ',
  },
  {
    delay,
    texts: 'makes ',
  },
  {
    delay,
    texts: 'document ',
  },
  {
    delay,
    texts: 'referencing ',
  },
  {
    delay,
    texts: 'simple ',
  },
  {
    delay,
    texts: 'and ',
  },
  {
    delay,
    texts: 'intuitive.\n\n',
  },
  {
    delay,
    texts: '<file ',
  },
  {
    delay,
    texts: 'name="sample.pdf" ',
  },
  {
    delay,
    texts: 'align="center" ',
  },
  {
    delay,
    texts:
      'src="https://s26.q4cdn.com/900411403/files/doc_downloads/test.pdf" width="80%" isUpload="true" />\n\n',
  },
  {
    delay,
    texts: 'Audio ',
  },
  {
    delay,
    texts: 'players ',
  },
  {
    delay,
    texts: 'can ',
  },
  {
    delay,
    texts: 'be ',
  },
  {
    delay,
    texts: 'embedded ',
  },
  {
    delay,
    texts: 'directly ',
  },
  {
    delay,
    texts: 'into ',
  },
  {
    delay,
    texts: 'documents, ',
  },
  {
    delay,
    texts: 'supporting ',
  },
  {
    delay,
    texts: 'online ',
  },
  {
    delay,
    texts: 'audio ',
  },
  {
    delay,
    texts: 'resources.\n\n',
  },
  {
    delay,
    texts: '<audio ',
  },
  {
    delay,
    texts: 'align="center" ',
  },
  {
    delay,
    texts: 'src="https://samplelib.com/lib/preview/mp3/sample-3s.mp3" width="80%" />\n\n',
  },
  {
    delay,
    texts: 'Video ',
  },
  {
    delay,
    texts: 'playback ',
  },
  {
    delay,
    texts: 'features ',
  },
  {
    delay,
    texts: 'support ',
  },
  {
    delay,
    texts: 'embedding ',
  },
  {
    delay,
    texts: 'various ',
  },
  {
    delay,
    texts: 'online ',
  },
  {
    delay,
    texts: 'video ',
  },
  {
    delay,
    texts: 'resources, ',
  },
  {
    delay,
    texts: 'enriching ',
  },
  {
    delay,
    texts: 'document ',
  },
  {
    delay,
    texts: 'content.\n\n',
  },
  {
    delay,
    texts: '<video ',
  },
  {
    delay,
    texts: 'align="center" ',
  },
  {
    delay,
    texts:
      'src="https://videos.pexels.com/video-files/6769791/6769791-uhd_2560_1440_24fps.mp4" width="80%" isUpload="true" />',
  },
]

export { mdxMediaChunks }
