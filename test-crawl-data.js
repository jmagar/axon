const Firecrawl = require('@mendable/firecrawl-js').default;

const client = new Firecrawl({
  apiKey: process.env.FIRECRAWL_API_KEY,
  apiUrl: 'http://localhost:53002'
});

client.getCrawlStatus('019c0f22-84f8-71b8-8af9-cd2a608c024a')
  .then(r => {
    console.log(JSON.stringify({
      hasData: !!r.data,
      dataType: Array.isArray(r.data) ? 'array' : typeof r.data,
      dataLength: r.data?.length,
      status: r.status,
      total: r.total,
      completed: r.completed
    }, null, 2));
  })
  .catch(e => console.error('Error:', e.message));
