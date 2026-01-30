const { getConfig } = require('./dist/utils/config.js');

const config = getConfig();

console.log(JSON.stringify({
  teiUrl: config.teiUrl,
  qdrantUrl: config.qdrantUrl,
  qdrantCollection: config.qdrantCollection,
  hasApiKey: !!config.apiKey
}, null, 2));
