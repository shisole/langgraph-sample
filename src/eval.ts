import "dotenv/config";
import { HumanMessage } from "@langchain/core/messages";
import { graph, type AgentStateType } from "./graph.js";

interface TestCase {
  question: string;
  expectedIntent: AgentStateType["intent"];
  category: string;
  expectSources: boolean;
}

const TEST_CASES: TestCase[] = [
  {
    question: "What stores sell running shoes at Solana Mall?",
    expectedIntent: "shopper_assistant",
    category: "Shopper",
    expectSources: true,
  },
  {
    question: "What events are happening at Mercado Village this March?",
    expectedIntent: "shopper_assistant",
    category: "Shopper",
    expectSources: true,
  },
  {
    question: "Where can I find Korean food at Mercado Village?",
    expectedIntent: "shopper_assistant",
    category: "Shopper",
    expectSources: true,
  },
  {
    question: "What are the parking rates at Parkview Shopping Center?",
    expectedIntent: "shopper_assistant",
    category: "Shopper",
    expectSources: true,
  },
  {
    question: "What 2-bedroom units are available at Central Park Towers?",
    expectedIntent: "property_inquiry",
    category: "Property",
    expectSources: true,
  },
  {
    question: "What amenities does Verde Gardens have?",
    expectedIntent: "property_inquiry",
    category: "Property",
    expectSources: true,
  },
  {
    question: "Do you have studio units under 5 million pesos?",
    expectedIntent: "property_inquiry",
    category: "Property",
    expectSources: true,
  },
  {
    question: "Tell me about properties near Metro Central.",
    expectedIntent: "property_inquiry",
    category: "Property",
    expectSources: true,
  },
  {
    question: "I am at Solana Mall, tell me about the nearby condos.",
    expectedIntent: "property_inquiry",
    category: "Cross-intent",
    expectSources: true,
  },
  {
    question: "What is the weather today?",
    expectedIntent: "unknown",
    category: "Out-of-scope",
    expectSources: false,
  },
];

interface TestResult {
  question: string;
  category: string;
  passed: boolean;
  failures: string[];
  intent: string;
  expectedIntent: string;
  sourceCount: number;
  answerLength: number;
}

async function runTest(testCase: TestCase): Promise<TestResult> {
  const result = await graph.invoke({
    messages: [new HumanMessage(testCase.question)],
  });

  const failures: string[] = [];

  // output should be JSON-serializable
  try {
    const output = {
      query: result.query,
      intent: result.intent,
      context: result.context,
      answer: result.answer,
      sources: result.sources,
    };
    JSON.parse(JSON.stringify(output));
  } catch {
    failures.push("Output is not valid JSON (not serializable)");
  }

  if (typeof result.intent !== "string") {
    failures.push("Missing or invalid intent field");
  }
  if (typeof result.answer !== "string" || result.answer.length === 0) {
    failures.push("Missing or empty answer");
  }
  if (!Array.isArray(result.sources)) {
    failures.push("Missing sources array");
  }
  if (!Array.isArray(result.context)) {
    failures.push("Missing context array");
  }

  if (result.intent !== testCase.expectedIntent) {
    failures.push(
      `Intent mismatch: expected "${testCase.expectedIntent}", got "${result.intent}"`
    );
  }

  if (testCase.expectSources && result.sources.length === 0) {
    failures.push("Expected source references but got none");
  }

  if (!testCase.expectSources && result.sources.length > 0) {
    failures.push(
      `Out-of-scope question should not have sources, got ${result.sources.length}`
    );
  }

  if (testCase.expectedIntent === "unknown") {
    const answerLower = result.answer.toLowerCase();
    const hasGuardrail =
      answerLower.includes("outside") ||
      answerLower.includes("can help") ||
      answerLower.includes("meridian properties") ||
      answerLower.includes("beyond");
    if (!hasGuardrail) {
      failures.push("Out-of-scope answer does not contain guardrail language");
    }
  }

  if (testCase.expectSources && result.answer.length > 0) {
    const hasCitation = /\[.*?\.(csv|txt).*?\]/.test(result.answer);
    if (!hasCitation) {
      failures.push("Answer does not contain source citations in brackets");
    }
  }

  return {
    question: testCase.question,
    category: testCase.category,
    passed: failures.length === 0,
    failures,
    intent: result.intent,
    expectedIntent: testCase.expectedIntent,
    sourceCount: result.sources.length,
    answerLength: result.answer.length,
  };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Meridian Properties Chatbot — Evaluation Suite");
  console.log("  Running", TEST_CASES.length, "test cases...");
  console.log("═══════════════════════════════════════════════════════\n");

  const results: TestResult[] = [];

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    process.stdout.write(
      `[${i + 1}/${TEST_CASES.length}] ${tc.category}: "${tc.question.substring(0, 50)}..." `
    );

    try {
      const result = await runTest(tc);
      results.push(result);

      if (result.passed) {
        console.log("PASS");
      } else {
        console.log("FAIL");
        result.failures.forEach((f) => console.log(`     - ${f}`));
      }
    } catch (error) {
      console.log("ERROR");
      const errMsg = error instanceof Error ? error.message : String(error);
      console.log(`     - ${errMsg}`);
      results.push({
        question: tc.question,
        category: tc.category,
        passed: false,
        failures: [`Runtime error: ${errMsg}`],
        intent: "error",
        expectedIntent: tc.expectedIntent,
        sourceCount: 0,
        answerLength: 0,
      });
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  RESULTS SUMMARY");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Total:  ${results.length}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Pass Rate: ${((passed / results.length) * 100).toFixed(0)}%`);
  console.log("═══════════════════════════════════════════════════════\n");

  console.log("  # | Category     | Intent Match | Sources | Status");
  console.log("  ──┼──────────────┼──────────────┼─────────┼───────");
  results.forEach((r, i) => {
    const intentOk = r.intent === r.expectedIntent ? "yes" : "NO";
    const status = r.passed ? "PASS" : "FAIL";
    console.log(
      `  ${(i + 1).toString().padStart(2)} | ${r.category.padEnd(12)} | ${intentOk.padEnd(12)} | ${r.sourceCount.toString().padEnd(7)} | ${status}`
    );
  });

  console.log();

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
