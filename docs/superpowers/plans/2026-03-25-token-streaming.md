# Token Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `graph.invoke()` in `src/app.ts` with `graph.stream()` so LLM tokens appear in the terminal as they are generated.

**Architecture:** Use `streamMode: ["messages", "values"]` to receive both token fragments (for streaming) and full state snapshots (for intent/sources/history) in a single loop. Filter message chunks to the `generate_answer` node only. Use a `hasStreamed` flag to distinguish the streaming path from `handle_unknown` and LLM error fallback paths.

**Tech Stack:** `@langchain/langgraph` ^1.2.1, `@langchain/core`, TypeScript, `tsx`

**Spec:** `docs/superpowers/specs/2026-03-25-streaming-design.md`

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `src/app.ts` | Modify | Replace `graph.invoke()` block with `graph.stream()` loop |

No other files are touched.

---

### Task 1: Replace `graph.invoke()` with `graph.stream()`

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Confirm `AgentStateType` is exported from `graph.ts`**

Read `src/graph.ts` and confirm line 34 reads:

```ts
export type AgentStateType = typeof AgentState.State;
```

Expected: yes, it is exported.

- [ ] **Step 2: Add `AgentStateType` to the import in `app.ts`**

At the top of `src/app.ts`, change:

```ts
import { graph } from "./graph.js";
```

To:

```ts
import { graph, type AgentStateType } from "./graph.js";
```

- [ ] **Step 3: Replace the invoke block**

In `src/app.ts`, replace this entire block inside the `try`:

```ts
      const result = await graph.invoke({
        messages: conversationHistory,
      });

      conversationHistory.push(new AIMessage(result.answer));

      if (DEBUG) {
        console.log(`\n[Intent: ${result.intent}]`);
      }
      console.log("─".repeat(50));
      console.log(result.answer);

      if (VERBOSE && result.sources.length > 0) {
        console.log("─".repeat(50));
        console.log("Sources:", result.sources.join(", "));
      }
      console.log();
```

With:

```ts
      const stream = await graph.stream(
        { messages: conversationHistory },
        { streamMode: ["messages", "values"] }
      );

      let streamedAnswer = "";
      let finalState: AgentStateType | null = null;
      let hasStreamed = false;

      console.log("─".repeat(50));

      for await (const chunk of stream) {
        if (chunk[0] === "messages") {
          const [, [message, metadata]] = chunk as [string, [{ content: unknown }, { langgraph_node: string }]];
          if (
            metadata.langgraph_node === "generate_answer" &&
            typeof message.content === "string" &&
            message.content.length > 0
          ) {
            process.stdout.write(message.content);
            streamedAnswer += message.content;
            hasStreamed = true;
          }
        } else if (chunk[0] === "values") {
          finalState = chunk[1] as AgentStateType;
        }
      }

      const answer = hasStreamed ? streamedAnswer : (finalState?.answer ?? "");

      if (hasStreamed) {
        process.stdout.write("\n");
      } else {
        // handle_unknown or LLM error fallback — print as a block
        console.log(answer);
      }

      // Note: [Intent:] now prints after the answer (previously printed before).
      // This is intentional — the intent is only known after the stream completes.
      if (DEBUG && finalState) {
        console.log(`\n[Intent: ${finalState.intent}]`);
      }
      if (VERBOSE && finalState && finalState.sources.length > 0) {
        console.log("─".repeat(50));
        console.log("Sources:", finalState.sources.join(", "));
      }
      console.log();

      // Only push a non-empty answer to avoid corrupting conversation history
      if (answer) {
        conversationHistory.push(new AIMessage(answer));
      }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors. If you see type errors on the chunk destructuring, the type assertion `chunk as [string, [{ content: unknown }, { langgraph_node: string }]]` may need adjustment based on the inferred type of `streamMode`. A tighter fallback than `any` is `chunk as [string, unknown]`, then cast `chunk[1]` individually — avoid using `any`.

- [ ] **Step 5: Smoke test — normal shopper query**

```bash
pnpm start
```

Type: `What stores sell running shoes at Solana Mall?`

Expected:
- Separator line prints immediately
- Answer tokens appear one by one as they stream
- Cursor ends on a new line after the answer
- No `[object Object]` or garbled output

- [ ] **Step 6: Smoke test — unknown query**

Still in the same session, type: `What is the weather today?`

Expected:
- Separator line prints
- Full guardrail answer prints as a single block (no streaming — `handle_unknown` has no LLM call)
- No extra blank line before the answer

- [ ] **Step 7: Smoke test — multi-turn state isolation**

Exit any running session, then start a new one:

```bash
VERBOSE=true pnpm start
```

In the same session:
- Turn 1: `What events are happening at Solana Mall?` — expect streaming answer with mall sources
- Turn 2: `What is the weather today?` — expect guardrail block answer with **no sources** printed (even in VERBOSE mode), confirming sources from turn 1 don't bleed into turn 2

Type turn 1, then turn 2. Confirm sources are absent after the unknown response.

- [ ] **Step 8: Smoke test — DEBUG mode**

```bash
DEBUG=true pnpm start
```

Type: `What amenities does Verde Gardens have?`

Expected:
- Tokens stream
- After answer (not before): `[Intent: property_inquiry]` printed on its own line

- [ ] **Step 9: Smoke test — VERBOSE mode**

```bash
VERBOSE=true pnpm start
```

Type: `What events are happening at Mercado Village?`

Expected:
- Tokens stream
- After answer: second separator line, then `Sources: mall_events.csv:...`

> **Note:** The LLM error fallback path (when `generate_answer` catches an exception) and the non-string `message.content` guard cannot be exercised without mocking. These paths are correct by code inspection — the `hasStreamed` flag stays `false` in both cases and the block-print branch handles them identically to `handle_unknown`.

- [ ] **Step 10: Commit**

```bash
git add src/app.ts
git commit -m "feat: stream generate_answer tokens to terminal as they arrive"
```
