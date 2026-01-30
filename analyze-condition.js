// What executeCrawl returns for --progress path

const progressResult = {
  success: true,  // executeCrawl always returns success field
  data: {
    id: "test-id",
    status: "completed",
    total: 771,
    completed: 771,
    creditsUsed: -1,
    expiresAt: "...",
    data: [ /* 771 pages */ ]
  }
};

// What executeCrawl returns for --status flag
const statusCheckResult = {
  success: true,
  data: {
    id: "test-id",
    status: "completed",
    total: 771,
    completed: 771,
    creditsUsed: -1,
    expiresAt: "..."
    // NO data array - this is from checkCrawlStatus()
  }
};

console.log('Line 260 checks: "status" in result && result.data && "status" in result.data');
console.log('');
console.log('For --progress (should embed):');
console.log(`  "status" in result: ${"status" in progressResult}`);
console.log(`  result.data: ${!!progressResult.data}`);
console.log(`  "status" in result.data: ${"status" in progressResult.data}`);
console.log(`  Condition: ${("status" in progressResult) && progressResult.data && ("status" in progressResult.data)}`);
console.log('');
console.log('For --status flag (should NOT embed):');
console.log(`  "status" in result: ${"status" in statusCheckResult}`);
console.log(`  result.data: ${!!statusCheckResult.data}`);
console.log(`  "status" in result.data: ${"status" in statusCheckResult.data}`);
console.log(`  Condition: ${("status" in statusCheckResult) && statusCheckResult.data && ("status" in statusCheckResult.data)}`);
console.log('');
console.log('PROBLEM: Both evaluate to the same! Cannot distinguish them!');
