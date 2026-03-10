/**
 * LESSON 5: Custom State
 *
 * In Lesson 4, we used MessagesAnnotation — a pre-built state that
 * only tracks messages. But the Algoritmo test requires:
 *
 *   - query: the user's question
 *   - intent: 'shopper_assistant' | 'property_inquiry' | 'unknown'
 *   - context: matched records from knowledge base
 *   - conversation_history: list of messages
 *   - answer: final response
 *   - sources: which data files were used
 *
 * This lesson shows how to define custom state with Annotation,
 * and how each node reads/writes specific fields.
 *
 * Think of state like a shared object passed to every node.
 * Each node reads what it needs and returns what it wants to update.
 */

import "dotenv/config";
import { ChatAnthropic } from "@langchain/anthropic";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";

// ============================================
// STEP 1: Define Custom State with Annotation
// ============================================
// This is the typed state object the Algoritmo test requires.
// Each field has a "reducer" that defines HOW updates are merged.

const AgentState = Annotation.Root({
  // Messages use a reducer that APPENDS new messages (not replaces)
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),

  // Simple fields — new value replaces old value
  query: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),

  intent: Annotation<"shopper_assistant" | "property_inquiry" | "unknown">({
    reducer: (_current, update) => update,
    default: () => "unknown",
  }),

  // Context accumulates — new results are appended
  context: Annotation<Record<string, unknown>[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),

  answer: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),

  // Sources accumulate
  sources: Annotation<string[]>({
    reducer: (current, update) => [...new Set([...current, ...update])],
    default: () => [],
  }),
});

// ============================================
// STEP 2: Define nodes that read/write state
// ============================================

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  temperature: 0,
});

// Node 1: Extract query from messages
function extractQuery(state: typeof AgentState.State) {
  const lastMessage = state.messages[state.messages.length - 1];
  const query = typeof lastMessage.content === "string" ? lastMessage.content : "";

  console.log(`[extract_query] "${query}"`);

  // Return ONLY the fields you want to update
  return { query };
}

// Node 2: Classify intent using LLM
async function classifyIntent(state: typeof AgentState.State) {
  const response = await llm.invoke([
    new SystemMessage(
      `Classify the user's intent. Respond with ONLY one of these exact words:
      - "shopper_assistant" — if asking about malls, stores, events, products, food, parking
      - "property_inquiry" — if asking about condos, units, properties, amenities, pricing
      - "unknown" — if the question is out of scope`
    ),
    new HumanMessage(state.query),
  ]);

  const intent = (response.content as string).trim().toLowerCase() as typeof state.intent;
  console.log(`[classify_intent] "${state.query}" → ${intent}`);

  return { intent };
}

// Node 3: Retrieve data based on intent
async function retrieve(state: typeof AgentState.State) {
  // In the real test, these would search CSV files
  // For now, mock data to show the concept
  let context: Record<string, unknown>[] = [];
  let sources: string[] = [];

  if (state.intent === "shopper_assistant") {
    context = [
      { store: "Seoul Kitchen", category: "Restaurant - Korean", location: "Food Village", mall: "Mercado Village" },
      { store: "Nike", category: "Sportswear", location: "2F", mall: "Solana Mall" },
    ];
    sources = ["mall_directory.csv"];
  } else if (state.intent === "property_inquiry") {
    context = [
      { development: "Verde Gardens", unit_type: "Studio", price: "4.5M-6M", status: "Available" },
      { development: "Willow Grove", unit_type: "Studio", price: "3.8M-5M", status: "Available" },
    ];
    sources = ["property_listings.csv"];
  }

  console.log(`[retrieve] intent=${state.intent}, found ${context.length} records from [${sources}]`);

  return { context, sources };
}

// Node 4: Generate answer using LLM + retrieved context
async function generateAnswer(state: typeof AgentState.State) {
  const response = await llm.invoke([
    new SystemMessage(
      "You are a helpful assistant for Meridian Properties. " +
      "Answer based ONLY on the provided context. " +
      "Cite sources in brackets like [mall_directory.csv]. " +
      "If no relevant data, say so."
    ),
    new HumanMessage(
      `User question: ${state.query}\n\n` +
      `Intent: ${state.intent}\n\n` +
      `Retrieved context:\n${JSON.stringify(state.context, null, 2)}\n\n` +
      `Sources: ${state.sources.join(", ")}`
    ),
  ]);

  const answer = response.content as string;
  console.log(`[generate_answer] Generated ${answer.length} chars`);

  return {
    answer,
    messages: [response],
  };
}

// ============================================
// STEP 3: Build the graph
// ============================================
// This is a LINEAR graph for now — no conditional routing yet (that's Lesson 6)
//
// START → extract_query → classify_intent → retrieve → generate_answer → END

const graph = new StateGraph(AgentState)
  .addNode("extract_query", extractQuery)
  .addNode("classify_intent", classifyIntent)
  .addNode("retrieve", retrieve)
  .addNode("generate_answer", generateAnswer)
  .addEdge(START, "extract_query")
  .addEdge("extract_query", "classify_intent")
  .addEdge("classify_intent", "retrieve")
  .addEdge("retrieve", "generate_answer")
  .addEdge("generate_answer", END)
  .compile();

// ============================================
// STEP 4: Run with different questions
// ============================================
async function main() {
  // Mall question
  console.log("=== Question 1: Mall query ===");
  const result1 = await graph.invoke({
    messages: [new HumanMessage("Where can I find Korean food at Mercado Village?")],
  });
  console.log("\nState after graph:");
  console.log("  query:", result1.query);
  console.log("  intent:", result1.intent);
  console.log("  sources:", result1.sources);
  console.log("  context count:", result1.context.length);
  console.log("  answer:", result1.answer.substring(0, 200) + "...");

  // Property question
  console.log("\n\n=== Question 2: Property query ===");
  const result2 = await graph.invoke({
    messages: [new HumanMessage("Do you have studio units under 5 million?")],
  });
  console.log("\nState after graph:");
  console.log("  query:", result2.query);
  console.log("  intent:", result2.intent);
  console.log("  sources:", result2.sources);
  console.log("  context count:", result2.context.length);
  console.log("  answer:", result2.answer.substring(0, 200) + "...");

  // Out of scope question
  console.log("\n\n=== Question 3: Out of scope ===");
  const result3 = await graph.invoke({
    messages: [new HumanMessage("What is the weather today?")],
  });
  console.log("\nState after graph:");
  console.log("  query:", result3.query);
  console.log("  intent:", result3.intent);
  console.log("  sources:", result3.sources);
  console.log("  context count:", result3.context.length);
  console.log("  answer:", result3.answer.substring(0, 200) + "...");
}

main().catch(console.error);
