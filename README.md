# Meridian Properties Corp. — Real Estate AI Chatbot

A LangGraph-powered chatbot that serves as a unified customer-facing assistant for Meridian Properties Corp., handling **mall/shopping inquiries** and **residential property inquiries** through intelligent intent routing.

## Quick Start

```bash
# Install dependencies
pnpm install

# Set up your Anthropic API key
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Run the interactive chatbot
pnpm start

# Run the evaluation suite (10 test questions)
pnpm eval
```

## Graph Design

The chatbot uses a 7-node LangGraph workflow with conditional routing based on intent classification:

```
START → [extract_query] → [classify_intent] → ROUTE
                                                 ├─ shopper_assistant → [retrieve_mall]  ──┐
                                                 ├─ property_inquiry  → [retrieve_property]┤
                                                 │                                         ↓
                                                 │                            [generate_answer]
                                                 │                                         ↓
                                                 │                             [quality_check] → END
                                                 └─ unknown → [handle_unknown] ──────────────→ END
```

### Nodes

| Node | Purpose |
|------|---------|
| `extract_query` | Parses the user's message from the conversation state |
| `classify_intent` | LLM classifies intent as `shopper_assistant`, `property_inquiry`, or `unknown` |
| `retrieve_mall` | Searches mall CSV/TXT data files for relevant stores, events, products, and mall info |
| `retrieve_property` | Searches property CSV/TXT data files for listings and amenity details |
| `handle_unknown` | Returns a polite out-of-scope message with guidance on what the bot can help with |
| `generate_answer` | LLM produces a grounded, cited response based only on retrieved context |
| `quality_check` | Validates the answer: replaces empty-context answers with an honest "not found" message, and appends source citations if missing |

### State

```typescript
{
  messages: BaseMessage[]       // conversation history
  query: string                 // current user question
  intent: string                // 'shopper_assistant' | 'property_inquiry' | 'unknown'
  context: Record<string, unknown>[]  // retrieved records
  answer: string                // final response
  sources: string[]             // data source references
}
```

### Conditional Routing

After `classify_intent`, `addConditionalEdges` routes to the appropriate retrieval node. The `unknown` path bypasses answer generation entirely and returns a pre-defined guardrail response. For recognized intents, the `quality_check` node runs after `generate_answer` as a LangGraph-native reliability gate — it replaces empty-context answers with an honest "not found" message and ensures source citations are present.

### Evidence Grounding

- All factual answers cite their data sources in brackets (e.g., `[mall_directory.csv]`)
- If context is insufficient, the LLM explicitly says so
- Out-of-scope questions are politely declined
- No hallucinated information — answers draw only from retrieved context

## Data Files

| File | Description |
|------|-------------|
| `data/mall_directory.csv` | Store directory across 4 malls (19 entries) |
| `data/mall_events.csv` | Upcoming mall events (10 entries) |
| `data/mall_products.csv` | Product inventory by store (17 entries) |
| `data/mall_info.txt` | Mall hours, parking, contact, features (4 malls) |
| `data/property_listings.csv` | Property listings across 5 developments (16 units) |
| `data/property_amenities.txt` | Development amenities, nearby, transport (5 developments) |

## Project Structure

```
src/
  tools.ts    # Data loading (CSV/TXT) and search functions (6 search tools)
  graph.ts    # LangGraph definition — state, nodes, routing, compiled graph
  app.ts      # Interactive CLI chatbot (readline REPL)
  eval.ts     # Evaluation script — 10 test questions with assertions
data/         # Synthetic knowledge base files
```

## Tools

The chatbot uses 6 search functions as tools:

1. `searchMallDirectory(query, mallName?, category?)` — search store directory
2. `searchMallEvents(query, mallName?)` — search mall events
3. `searchMallProducts(query, mallName?, category?)` — search product inventory
4. `getMallInfo(mallName)` — get mall hours, parking, contact info
5. `searchProperties(query, development?, bedrooms?, maxPrice?)` — search property listings
6. `getPropertyAmenities(development)` — get development amenities and details

All searches use case-insensitive keyword matching with stopword filtering.

## Mock Mode (No API Key Required)

When `ANTHROPIC_API_KEY` is not set, the chatbot automatically switches to **mock mode** with deterministic, keyword-based classification and template-based answer generation. The graph structure, state, conditional routing, and tool-based retrieval remain identical — only the two LLM-dependent nodes (`classify_intent` and `generate_answer`) are swapped out.

```bash
# Run without an API key — mock mode activates automatically
unset ANTHROPIC_API_KEY
pnpm start
pnpm eval    # all 10 tests still pass
```

This lets reviewers test the graph structure, routing logic, state flow, and tool integration without needing credentials.

## Requirements

- Node.js 18+
- pnpm
- Anthropic API key — **optional** (uses Claude Haiku 4.5 when set; falls back to mock mode when absent)
