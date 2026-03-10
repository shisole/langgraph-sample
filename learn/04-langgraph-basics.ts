/**
 * LESSON 4: LangGraph Basics
 *
 * Remember the manual while loop from Lesson 3?
 *
 *   while (hasToolCalls) {
 *     call LLM → execute tools → send results back → repeat
 *   }
 *
 * LangGraph replaces that with a graph:
 *
 *   START → [llm node] → has tool calls? → YES → [tool node] → back to [llm node]
 *                                        → NO  → END
 *
 * Same behavior, but declarative — you define WHAT connects to WHAT,
 * not HOW to loop.
 */

import "dotenv/config";
import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  StateGraph,
  START,
  END,
  MessagesAnnotation,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage } from "@langchain/core/messages";

// ============================================
// STEP 1: Same tools from Lesson 2 & 3
// ============================================
const searchMallDirectory = tool(
  async ({ mallName, category }) => {
    const mockData: Record<string, Record<string, string[]>> = {
      "Solana Mall": {
        Sportswear: ["Nike - 2F, 10:00-21:00"],
        "Coffee & Cafe": ["Starbucks - GF, 07:00-22:00"],
        Electronics: ["Samsung - 2F, 10:00-21:00"],
        Apparel: ["Uniqlo - 1F, 10:00-21:00"],
        "Health & Beauty": ["Watsons - GF, 10:00-21:00"],
      },
      "Mercado Village": {
        "Restaurant - Korean": ["Seoul Kitchen - Food Village, 11:00-22:00"],
        "Restaurant - Filipino": ["Grill House - Food Village, 11:00-22:00"],
      },
    };

    const mall = mockData[mallName];
    if (!mall) return JSON.stringify({ error: `Mall "${mallName}" not found`, source: "mall_directory.csv" });

    if (category) {
      const matches = Object.entries(mall)
        .filter(([cat]) => cat.toLowerCase().includes(category.toLowerCase()))
        .flatMap(([cat, stores]) => stores.map((s) => `[${cat}] ${s}`));
      return JSON.stringify({ mall: mallName, results: matches, source: "mall_directory.csv" });
    }

    const allStores = Object.entries(mall).flatMap(([cat, stores]) =>
      stores.map((s) => `[${cat}] ${s}`)
    );
    return JSON.stringify({ mall: mallName, results: allStores, source: "mall_directory.csv" });
  },
  {
    name: "search_mall_directory",
    description: "Search for stores, restaurants, or services in a specific mall.",
    schema: z.object({
      mallName: z.string().describe("The name of the mall"),
      category: z.string().optional().describe("Optional category filter"),
    }),
  }
);

const searchProperties = tool(
  async ({ development, bedrooms }) => {
    const mockData = [
      { development: "Central Park Towers", unit_type: "2BR", bedrooms: 2, area: 68, price: "25M-35M", status: "Available" },
      { development: "Central Park Towers", unit_type: "Studio", bedrooms: 0, area: 28, price: "8M-10M", status: "Available" },
      { development: "Verde Gardens", unit_type: "Studio", bedrooms: 0, area: 24, price: "4.5M-6M", status: "Available" },
      { development: "Willow Grove", unit_type: "Studio", bedrooms: 0, area: 22, price: "3.8M-5M", status: "Available" },
    ];

    let results = mockData;
    if (development) results = results.filter((r) => r.development.toLowerCase().includes(development.toLowerCase()));
    if (bedrooms !== undefined) results = results.filter((r) => r.bedrooms === bedrooms);

    return JSON.stringify({ results, source: "property_listings.csv" });
  },
  {
    name: "search_properties",
    description: "Search for available property listings. If no development specified, search all.",
    schema: z.object({
      development: z.string().optional().describe("Development name"),
      bedrooms: z.number().optional().describe("Number of bedrooms (0 for studio)"),
    }),
  }
);

const tools = [searchMallDirectory, searchProperties];

// ============================================
// STEP 2: Create the LLM with tools bound
// ============================================
const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  temperature: 0,
}).bindTools(tools);

// ============================================
// STEP 3: Define the graph nodes
// ============================================

// Node 1: Call the LLM
// This replaces "Step 1: Call the LLM" from our while loop
async function callLLM(state: typeof MessagesAnnotation.State) {
  const response = await llm.invoke(state.messages);
  // Return messages to ADD to state (not replace)
  return { messages: [response] };
}

// Node 2: Execute tools
// This replaces the "Step 3: Execute each tool call" from our while loop
// ToolNode does this automatically — no manual if/else needed!
const toolNode = new ToolNode(tools);

// ============================================
// STEP 4: Define the routing logic
// ============================================

// This replaces the "if (!response.tool_calls)" check from our while loop
function shouldContinue(state: typeof MessagesAnnotation.State) {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

  // If the LLM made tool calls, go to the tool node
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return "tools";
  }
  // Otherwise, we're done
  return END;
}

// ============================================
// STEP 5: Build the graph
// ============================================
// This is the equivalent of our entire while loop, but declarative

const graph = new StateGraph(MessagesAnnotation)
  // Add nodes
  .addNode("llm", callLLM)
  .addNode("tools", toolNode)
  // Add edges
  .addEdge(START, "llm")                              // START → always go to LLM first
  .addConditionalEdges("llm", shouldContinue)          // LLM → tools (if tool calls) or END
  .addEdge("tools", "llm")                            // tools → always go back to LLM
  .compile();

// ============================================
// STEP 6: Run it!
// ============================================
async function main() {
  console.log("=== Question 1: Mall query ===");
  const result1 = await graph.invoke({
    messages: [
      {
        role: "system",
        content:
          "You are a helpful assistant for Meridian Properties. " +
          "Always use your tools to search before responding. " +
          "Always cite your sources like [mall_directory.csv].",
      },
      {
        role: "user",
        content: "Where can I find Korean food at Mercado Village?",
      },
    ],
  });

  // Print all messages to see the full flow
  console.log("\n--- Full message flow ---");
  for (const msg of result1.messages) {
    const type = msg._getType();
    if (type === "system") {
      console.log(`[SYSTEM] ${(msg.content as string).substring(0, 60)}...`);
    } else if (type === "human") {
      console.log(`[USER] ${msg.content}`);
    } else if (type === "ai") {
      const ai = msg as AIMessage;
      if (ai.tool_calls && ai.tool_calls.length > 0) {
        console.log(`[AI → TOOL CALL] ${ai.tool_calls[0].name}(${JSON.stringify(ai.tool_calls[0].args)})`);
      } else {
        console.log(`[AI → FINAL ANSWER] ${(ai.content as string).substring(0, 200)}...`);
      }
    } else if (type === "tool") {
      console.log(`[TOOL RESULT] ${(msg.content as string).substring(0, 100)}...`);
    }
  }

  // ============================================
  // Question 2: Property query — different tool!
  // ============================================
  console.log("\n\n=== Question 2: Property query ===");
  const result2 = await graph.invoke({
    messages: [
      {
        role: "system",
        content:
          "You are a helpful assistant for Meridian Properties. " +
          "Always use your tools to search before responding. " +
          "If the user doesn't specify a development, search across all. " +
          "Always cite your sources like [property_listings.csv].",
      },
      {
        role: "user",
        content: "Do you have studio units under 5 million pesos?",
      },
    ],
  });

  console.log("\n--- Full message flow ---");
  for (const msg of result2.messages) {
    const type = msg._getType();
    if (type === "system") {
      console.log(`[SYSTEM] ${(msg.content as string).substring(0, 60)}...`);
    } else if (type === "human") {
      console.log(`[USER] ${msg.content}`);
    } else if (type === "ai") {
      const ai = msg as AIMessage;
      if (ai.tool_calls && ai.tool_calls.length > 0) {
        console.log(`[AI → TOOL CALL] ${ai.tool_calls[0].name}(${JSON.stringify(ai.tool_calls[0].args)})`);
      } else {
        console.log(`[AI → FINAL ANSWER] ${(ai.content as string).substring(0, 300)}...`);
      }
    } else if (type === "tool") {
      console.log(`[TOOL RESULT] ${(msg.content as string).substring(0, 150)}...`);
    }
  }
}

main().catch(console.error);
