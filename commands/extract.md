---
description: Extract structured data from URLs using prompts or schemas
argument-hint: <url> --prompt "extraction prompt"
allowed-tools: Bash(axon *)
---

# Extract Structured Data

Execute the Axon extract command with the provided arguments:

```bash
axon extract $ARGUMENTS
```

## Instructions

1. **Execute the command** using the Bash tool with the arguments provided
2. **Parse the response** to extract:
   - Structured data matching the prompt/schema
   - Extracted fields and values
   - Metadata about the extraction
3. **Present the results** in a structured format:
   - Table format for structured data
   - JSON format for complex nested data
   - Clear labeling of extracted fields
4. **Validate** that data matches the requested schema or prompt

## Expected Output

The command returns JSON containing:
- `data`: Extracted structured data matching prompt/schema
- `metadata`: Source URL, extraction timestamp
- `schema`: Schema used for extraction (if provided)

Present the extracted data in a clear, organized format that matches the user's extraction requirements.
