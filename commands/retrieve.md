---
description: Retrieve full document from vector database by URL
argument-hint: <url> [--collection name]
allowed-tools: Bash(axon *)
---

# Retrieve Full Document

Execute the Axon retrieve command with the provided arguments:

```bash
axon retrieve $ARGUMENTS
```

## Instructions

1. **Execute the command** using the Bash tool with the arguments provided
2. **Parse the response** to extract:
   - Full reconstructed document content
   - Document metadata
   - Chunk information
   - Embedding details
3. **Present the results** including:
   - Complete document content
   - Source URL
   - Metadata (title, description, timestamp)
   - Number of chunks reassembled
4. **Verify completeness**:
   - Confirm all chunks retrieved
   - Check for missing sections
   - Validate content integrity

## Expected Output

The command returns JSON containing:
- `content`: Full reconstructed document
- `url`: Source URL
- `metadata`: Document metadata (title, description, etc.)
- `chunks`: Number of chunks reassembled
- `collection`: Qdrant collection name

Present the complete document content with metadata confirmation.
