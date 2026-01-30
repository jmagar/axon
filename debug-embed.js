require('dotenv').config();
const { autoEmbed } = require('./dist/utils/embedpipeline.js');
const { getConfig, initializeConfig } = require('./dist/utils/config.js');

async function main() {
  // MUST call initializeConfig() to load env vars into config!
  initializeConfig();

  const config = getConfig();

  console.log('Config:', JSON.stringify({
    hasTeiUrl: !!config.teiUrl,
    hasQdrantUrl: !!config.qdrantUrl,
    teiUrl: config.teiUrl,
    qdrantUrl: config.qdrantUrl,
    collection: config.qdrantCollection
  }, null, 2));

  console.log('\nTesting single embed...');

  try {
    await autoEmbed('Test content for embedding', {
      url: 'https://test.com',
      title: 'Test',
      sourceCommand: 'test'
    });
    console.log('Embed completed');
  } catch (e) {
    console.error('Embed error:', e.message);
  }
}

main();
