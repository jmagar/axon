require('dotenv').config();
const Firecrawl = require('@mendable/firecrawl-js').default;
const { batchEmbed, createEmbedItems } = require('./dist/utils/embedpipeline.js');
const { initializeConfig } = require('./dist/utils/config.js');

async function main() {
  // Initialize config to load TEI/Qdrant URLs from env
  initializeConfig();
  const client = new Firecrawl({
    apiKey: process.env.FIRECRAWL_API_KEY,
    apiUrl: 'http://localhost:53002'
  });

  console.error('Fetching crawl data...');
  const result = await client.getCrawlStatus('019c0f22-84f8-71b8-8af9-cd2a608c024a');

  if (!result.data || !Array.isArray(result.data)) {
    console.error('No data available');
    return;
  }

  console.error(`Got ${result.data.length} pages`);
  console.error('Creating embed items...');

  const embedItems = createEmbedItems(result.data, 'crawl');
  console.error(`Created ${embedItems.length} embed items`);

  console.error('Starting batch embedding...');
  await batchEmbed(embedItems);

  console.error('Embedding complete!');
}

main().catch(e => console.error('Error:', e));
