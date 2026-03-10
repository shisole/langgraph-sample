/**
 * LESSON 2: Tools
 *
 * In EventTara, you did this:
 *   1. Send user query to Claude
 *   2. Claude returns JSON with search params
 *   3. YOU manually query Supabase with those params
 *
 * With LangChain Tools:
 *   1. You define functions as "tools" with descriptions
 *   2. Bind them to the LLM
 *   3. The LLM decides WHICH tool to call and with WHAT arguments
 *   4. You execute the tool and send results back
 *
 * The LLM doesn't execute the tool — it just says "I want to call X with Y".
 * YOU (or LangGraph later) actually run the function.
 */

import "dotenv/config";
import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";

// ============================================
// PART 1: Define tools
// ============================================
// A tool is just a function + a name + a description + input schema
// The description is KEY — it tells the LLM when to use this tool

const searchMallDirectory = tool(
  async ({ mallName, category }) => {
    // In the real Algoritmo test, this would search mall_directory.csv
    // For now, hardcoded mock data
    const mockData: Record<string, Record<string, string[]>> = {
      "Solana Mall": {
        Sportswear: ["Nike - 2F, 10:00-21:00"],
        "Coffee & Cafe": ["Starbucks - GF, 07:00-22:00"],
        Electronics: ["Samsung - 2F, 10:00-21:00"],
      },
      "Mercado Village": {
        "Restaurant - Korean": ["Seoul Kitchen - Food Village, 11:00-22:00"],
        "Restaurant - Filipino": ["Grill House - Food Village, 11:00-22:00"],
      },
    };

    const mall = mockData[mallName];
    if (!mall) return JSON.stringify({ error: `Mall "${mallName}" not found` });

    if (category) {
      // Fuzzy match: check if any category contains the search term
      const matches = Object.entries(mall)
        .filter(([cat]) => cat.toLowerCase().includes(category.toLowerCase()))
        .flatMap(([cat, stores]) => stores.map((s) => `[${cat}] ${s}`));
      return JSON.stringify({ mall: mallName, results: matches, source: "mall_directory.csv" });
    }

    // Return all stores
    const allStores = Object.entries(mall).flatMap(([cat, stores]) =>
      stores.map((s) => `[${cat}] ${s}`)
    );
    return JSON.stringify({ mall: mallName, results: allStores, source: "mall_directory.csv" });
  },
  {
    name: "search_mall_directory",
    description:
      "Search for stores, restaurants, or services in a specific mall. Use this when the user asks about what's available at a mall.",
    schema: z.object({
      mallName: z.string().describe("The name of the mall to search"),
      category: z.string().optional().describe("Optional category filter like 'Korean', 'Coffee', 'Sportswear'"),
    }),
  }
);

const searchProperties = tool(
  async ({ development, bedrooms, maxPrice }) => {
    // In the real test, this would search property_listings.csv
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
    description:
      "Search for available property listings. Use this when the user asks about condos, units, pricing, or availability.",
    schema: z.object({
      development: z.string().optional().describe("Development name like 'Central Park Towers'"),
      bedrooms: z.number().optional().describe("Number of bedrooms (0 for studio)"),
      maxPrice: z.string().optional().describe("Maximum price budget"),
    }),
  }
);

async function main() {
  const llm = new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    temperature: 0,
  });

  // ============================================
  // PART 2: Bind tools to the LLM
  // ============================================
  // This tells Claude: "hey, you have these functions available"
  const llmWithTools = llm.bindTools([searchMallDirectory, searchProperties]);

  // ============================================
  // PART 3: LLM decides to call a tool
  // ============================================
  console.log("=== Part 3: LLM decides which tool to call ===");
  const response = await llmWithTools.invoke([
    new HumanMessage("Do you have studio units under 5 million pesos?"),
    // new HumanMessage("What stores sell running shoes at Solana Mall?"),
  ]);

  console.log("Content:", response.content); // May be empty or a brief message
  console.log("Tool calls:", JSON.stringify(response.tool_calls, null, 2));
  // ^ THIS is the key — the LLM says "call search_mall_directory with these args"
  // The LLM did NOT run the function. It just told you what to call.
  console.log();

  // ============================================
  // PART 4: Execute the tool and send result back
  // ============================================
  // This is the manual loop that LangGraph will automate for you
  console.log("=== Part 4: Execute tool and get final answer ===");

  if (response.tool_calls && response.tool_calls.length > 0) {
    const toolCall = response.tool_calls[0];
    console.log(`LLM wants to call: ${toolCall.name}(${JSON.stringify(toolCall.args)})`);

    // Execute the tool
    let toolResult: string;
    if (toolCall.name === "search_mall_directory") {
      toolResult = await searchMallDirectory.invoke(toolCall.args);
    } else if (toolCall.name === "search_properties") {
      toolResult = await searchProperties.invoke(toolCall.args);
    } else {
      toolResult = JSON.stringify({ error: "Unknown tool" });
    }

    console.log("Tool result:", toolResult);

    // Send the tool result BACK to the LLM so it can formulate a human-friendly answer
    const finalResponse = await llmWithTools.invoke([
      new HumanMessage("What stores sell running shoes at Solana Mall?"),
      response, // The AI message with tool_calls
      new ToolMessage({
        content: toolResult,
        tool_call_id: toolCall.id!, // Links this result to the specific tool call
      }),
    ]);

    console.log("\nFinal answer:", finalResponse.content);
    console.log("Tool calls:", finalResponse.tool_calls); // Should be empty now — LLM is done
  }

  // ============================================
  // PART 5: Try a property question — watch it pick the OTHER tool
  // ============================================
  // console.log("\n=== Part 5: Different intent → different tool ===");
  // const response2 = await llmWithTools.invoke([
  //   new HumanMessage("Do you have studio units under 5 million pesos?"),
  // ]);
  

  // console.log("Tool calls:", JSON.stringify(response2.tool_calls, null, 2));
  // Notice: it picked search_properties, not search_mall_directory!
}

main().catch(console.error);
