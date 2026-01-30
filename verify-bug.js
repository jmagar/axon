// Simulate what handleCrawlCommand receives from --progress path

const result = {
  success: true,
  data: {
    id: "test-id",
    status: "completed", // ← This causes the early return!
    total: 771,
    completed: 771,
    data: [ /* 771 pages */ ]
  }
};

// Line 260 condition:
const condition1 = "status" in result;
const condition2 = result.data;
const condition3 = "status" in result.data;

console.log('Line 260 condition evaluation:');
console.log(`  "status" in result: ${condition1}`);
console.log(`  result.data: ${!!condition2}`);
console.log(`  "status" in result.data: ${condition3}`);
console.log(`  Full condition: ${condition1 && condition2 && condition3}`);
console.log('');
console.log('Result: EARLY RETURN at line 273');
console.log('Embedding code at line 284 is NEVER reached!');
