require('dotenv').config();
const Firecrawl = require('@mendable/firecrawl-js').default;

const client = new Firecrawl({
  apiKey: process.env.FIRECRAWL_API_KEY,
  apiUrl: 'http://localhost:53002'
});

// This is what getCrawlStatus returns (what --progress uses)
client.getCrawlStatus('019c0f22-84f8-71b8-8af9-cd2a608c024a')
  .then(status => {
    console.log('getCrawlStatus returns:');
    console.log(JSON.stringify({
      hasJobId: 'jobId' in status,
      hasId: 'id' in status,
      hasData: 'data' in status,
      dataType: status.data ? (Array.isArray(status.data) ? 'array' : typeof status.data) : 'undefined',
      dataLength: status.data?.length,
      keys: Object.keys(status)
    }, null, 2));

    console.log('\nSo the embedding code at line 287 checks:');
    console.log(`  "jobId" in crawlResult.data = ${'jobId' in status}`);
    console.log('\nAnd at line 322 tries:');
    console.log(`  crawlResult.data.data = ${status.data ? 'exists' : 'undefined'}`);
    console.log(`  Array length: ${status.data?.length || 0}`);
  });
