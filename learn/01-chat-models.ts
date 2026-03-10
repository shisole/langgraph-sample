/**
 * LESSON 1: ChatModels
 *
 * In EventTara, you did this:
 *   const anthropic = new Anthropic();
 *   const response = await anthropic.messages.create({ model: "claude-haiku-4-5-20251001", ... });
 *
 * In LangChain, you do this instead:
 *   const llm = new ChatAnthropic({ model: "claude-haiku-4-5-20251001" });
 *   const response = await llm.invoke("Hello");
 *
 * Why? Because LangChain wraps the raw SDK so you can:
 *   - Swap providers (OpenAI ↔ Anthropic) without changing your code
 *   - Use the same message format everywhere
 *   - Plug into LangGraph nodes later
 */

import "dotenv/config";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";

async function main() {
  // ============================================
  // PART 1: Basic invocation (simplest form)
  // ============================================
  const llm = new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    temperature: 0,
  });

  // Simple string input — LangChain converts it to a HumanMessage for you
  console.log("=== Part 1: Simple string invoke ===");
  const response1 = await llm.invoke("What is LangChain in one sentence?");
  // console.log("Response:", response1.content);
  // console.log("Type:", typeof response1); // This is an AIMessage object, not just a string
  // console.log();

  // ============================================
  // PART 2: Message objects (the real way)
  // ============================================
  // LangChain uses a message array — just like the Anthropic SDK you used in EventTara
  // But with standardized classes that work across ANY provider
  console.log("=== Part 2: Message objects ===");
  const response2 = await llm.invoke([
    new SystemMessage("You are a helpful real estate assistant for Meridian Properties."),
    new HumanMessage("What's a good question to ask when buying a condo?"),
  ]);
  // console.log("Response:", response2.content);
  // console.log();

  // ============================================
  // PART 3: Conversation (multi-turn)
  // ============================================
  // You manually manage the conversation history, just like you did in EventTara
  // In LangGraph, the graph state will handle this for you
  console.log("=== Part 3: Multi-turn conversation ===");
  const history = [
    new SystemMessage("You are a mall concierge. Keep answers brief."),
    new HumanMessage("What food options do malls usually have?"),
  ];

  const response3 = await llm.invoke(history);
  // console.log("AI:", response3.content);

  // Add the AI response to history, then ask a follow-up
  history.push(response3); // response3 IS already an AIMessage
  history.push(new HumanMessage("What about Korean food specifically?"));

  const response4 = await llm.invoke(history);
  // console.log("AI (follow-up):", response4.content);
  // console.log();

  // ============================================
  // PART 4: What the response object looks like
  // ============================================
  // console.log("=== Part 4: Response structure ===");
  // console.log("content:", response4.content);
  // console.log("response_metadata:", JSON.stringify(response4.response_metadata, null, 2));
  // console.log("usage_metadata:", JSON.stringify(response4.usage_metadata, null, 2));
  console.log(JSON.stringify(response4, null, 2))
  // console.log(response4)
}

main().catch(console.error);
