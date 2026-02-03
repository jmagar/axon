# Firecrawl Extract Validation Bug Report

**Date:** 2026-02-03
**Reporter:** CLI Firecrawl Team
**Status:** Unresolved
**Severity:** High - Feature completely non-functional in self-hosted setups

---

## Executive Summary

The `/extract` endpoint in self-hosted Firecrawl fails with validation errors despite using a capable LLM (Gemini 3 Flash Preview) that successfully extracts the requested data. The bug occurs in Firecrawl's internal `analyzeSchemaAndPrompt` validation layer, which expects additional metadata fields not present in user-defined schemas.

## Environment

- **Firecrawl Version:** `ghcr.io/firecrawl/firecrawl:latest` (pulled 2026-02-03)
- **Deployment:** Docker Compose (self-hosted)
- **LLM Provider:** Gemini 3 Flash Preview via OpenAI-compatible API
- **Client:** Firecrawl CLI v1.1.1 with `@mendable/firecrawl-js@4.12.0`

### Configuration
```bash
MODEL_NAME=gemini-3-flash-preview
OPENAI_API_KEY=sk-***
OPENAI_BASE_URL=https://cli-api.tootie.tv/v1
FIRECRAWL_API_URL=http://localhost:53002
```

---

## Bug Description

### What Happens

When calling the extract endpoint with either `--prompt` or `--schema`, the request fails with a Zod validation error. The LLM successfully extracts the requested data, but Firecrawl's internal validation rejects it before returning to the client.

### Expected Behavior

- User provides a schema or prompt
- LLM extracts data matching the user's request
- API returns extracted data to client

### Actual Behavior

- User provides a schema or prompt
- LLM successfully extracts requested data
- **Internal validation fails** expecting fields `isMultiEntity`, `reasoning`, `keyIndicators`
- API returns empty `data: {}` to client
- Extracted data is discarded

---

## Reproduction Steps

### Test 1: Using Natural Language Prompt

```bash
node dist/index.js extract https://modelcontextprotocol.io \
  --prompt "What is MCP and what are its key features?" \
  --pretty \
  --no-embed
```

**Result:**
```json
{
  "success": true,
  "data": {}
}
```

### Test 2: Using JSON Schema

```bash
node dist/index.js extract https://example.com \
  --schema '{"type":"object","properties":{"title":{"type":"string"},"message":{"type":"string"}}}' \
  --pretty \
  --no-embed
```

**Result:**
```json
{
  "success": true,
  "data": {}
}
```

---

## Technical Analysis

### Error Location

The validation failure occurs in:
```
/app/dist/src/lib/extract/fire-0/completions/analyzeSchemaAndPrompt-f0.js:24:49
```

Function: `analyzeSchemaAndPrompt_F0`

### Error Details from Logs

```
(analyzeSchemaAndPrompt) Error parsing schema analysis {
  "error": {
    "name": "AI_NoObjectGeneratedError",
    "cause": {
      "name": "AI_TypeValidationError",
      "cause": {
        "name": "ZodError",
        "issues": [
          {
            "code": "invalid_type",
            "expected": "boolean",
            "received": "undefined",
            "path": ["isMultiEntity"],
            "message": "Invalid input: expected boolean, received undefined"
          },
          {
            "code": "invalid_type",
            "expected": "string",
            "received": "undefined",
            "path": ["reasoning"],
            "message": "Invalid input: expected string, received undefined"
          },
          {
            "code": "invalid_type",
            "expected": "array",
            "received": "undefined",
            "path": ["keyIndicators"],
            "message": "Invalid input: expected array, received undefined"
          }
        ]
      }
    }
  }
}
```

### What the LLM Actually Produced

Despite the validation error, logs show the LLM **successfully extracted** the requested data:

**Example 1 (MCP site with prompt):**
```json
{
  "title": "Model Context Protocol (MCP)",
  "mainPurpose": "An open standard that enables developers to build secure, two-way connections between their data sources and AI models...",
  "keyFeatures": [
    "Standardized architecture for connecting AI models to data and tools",
    "Pre-built connectors for popular platforms like GitHub, Slack, and Google Drive",
    "Support for both local and remote resource access",
    "Tool use capabilities allowing models to perform actions across different systems",
    "Prompt templates for standardized model interactions",
    "Security-focused design with fine-grained permissions and local-first options"
  ]
}
```

**Example 2 (example.com with prompt):**
```json
{
  "page_title": "Example Domain",
  "main_message": "This domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination or asking for permission."
}
```

### The Problem

Firecrawl's `analyzeSchemaAndPrompt` validation expects this internal schema:
```typescript
{
  isMultiEntity: boolean,      // Internal Firecrawl metadata
  reasoning: string,            // Internal Firecrawl metadata
  keyIndicators: string[],      // Internal Firecrawl metadata
  // ... user's actual schema fields
}
```

But the LLM only returns the user's requested fields, causing validation to fail and discard the correctly extracted data.

---

## Comparison to Issue #1294

### Similarities

1. **Same error**: `isMultiEntity`, `reasoning`, `keyIndicators` validation failure
2. **Same function**: `analyzeSchemaAndPrompt` validation
3. **Self-hosted only**: Cloud API works fine
4. **Same error structure**: Zod validation error in AI SDK

### Key Difference

**Issue #1294 Resolution:**
- **Problem**: Weak LLM (`llama3.2:1b`) couldn't produce structured output
- **Solution**: "Use a better model" (closed as "not much we can do")
- **Quote from maintainer (mogery)**:
  > "llama3.2:1b is not good enough to run Extract in our experience. As you can see from the validation error it is not respecting the structured output that is required by Extract."

**Our Issue:**
- **Problem**: Strong LLM (`gemini-3-flash-preview`) produces correct output, but validation schema is wrong
- **Evidence**: Logs prove LLM extracted data correctly
- **Root cause**: Firecrawl's internal validation expects metadata fields that shouldn't be in user schemas

This is a **different bug** - not an LLM capability issue, but a **validation schema bug**.

---

## Impact Assessment

### Affected Users

- **All self-hosted Firecrawl deployments** using the extract endpoint
- Users with capable LLMs (GPT-4, Claude, Gemini, etc.)
- Both `--prompt` and `--schema` extraction modes

### Workarounds

1. **Use `scrape --format summary`** for AI-generated summaries:
   ```bash
   firecrawl scrape URL --format summary
   ```
   - ✅ Works perfectly
   - ✅ Uses same LLM for analysis
   - ❌ Less control over output structure
   - ❌ Cannot specify custom schemas

2. **Use Firecrawl Cloud API** (not self-hosted)
   - ✅ Extract works properly
   - ❌ Not viable for users requiring self-hosting

---

## Proposed Solutions

### Option 1: Fix Validation Schema (Recommended)

Remove internal metadata fields from the user-facing validation layer. Split validation into:
- **Internal validation**: For Firecrawl's metadata (`isMultiEntity`, etc.)
- **User validation**: Only for user-provided schema/prompt fields

### Option 2: Make Metadata Optional

Change the Zod schema to make `isMultiEntity`, `reasoning`, `keyIndicators` optional:
```typescript
{
  isMultiEntity: z.boolean().optional(),
  reasoning: z.string().optional(),
  keyIndicators: z.array(z.string()).optional(),
}
```

### Option 3: Post-Process LLM Response

Add the required metadata fields after LLM generation but before validation, using defaults or deriving values from the response.

---

## Evidence Files

- **Firecrawl logs**: Show successful LLM extraction + validation failure
- **CLI output**: Empty `data: {}` despite successful LLM response
- **Docker configuration**: `docker-compose.yaml` with environment setup
- **Test commands**: Reproducible with any URL and schema/prompt

---

## Related Issues

- **#1294** - "[Self-Host] /extract endpoint failing with ollama / llama3.2:1b" (CLOSED)
  - Similar symptoms but different root cause (weak LLM vs validation bug)
  - Closed without addressing the validation schema issue

---

## Request for Firecrawl Team

1. **Reproduce**: Test extract with Gemini/GPT-4 in self-hosted setup
2. **Review**: Examine `analyzeSchemaAndPrompt_F0` validation schema
3. **Fix**: Separate internal metadata validation from user schema validation
4. **Regression test**: Ensure fix doesn't break cloud deployments

---

## Additional Notes

- The `summary` format in scrape command works because it doesn't use this validation layer
- This suggests the validation bug is specific to the extract endpoint's analysis phase
- The LLM is performing correctly - it's purely a validation issue

---

**Contact**: Available for testing, providing additional logs, or clarifying technical details.
