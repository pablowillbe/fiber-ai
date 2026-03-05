import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";

// ─── Config ──────────────────────────────────────────────────────────────────
const FIBER_BASE_URL = "https://api.fiber.ai";
const PORT = parseInt(process.env.PORT || "3000", 10);
const FIBER_API_KEY = process.env.FIBER_API_KEY || "";

if (!FIBER_API_KEY) {
  console.warn(
    "⚠️  FIBER_API_KEY not set. The server will start but all tool calls will fail."
  );
}

// ─── Fiber API helper ────────────────────────────────────────────────────────
async function callFiber(path: string, body: Record<string, unknown>) {
  const payload = { apiKey: FIBER_API_KEY, ...body };
  const res = await fetch(`${FIBER_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Fiber API error ${res.status} on ${path}: ${text.slice(0, 500)}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// ─── Tool definitions ────────────────────────────────────────────────────────
// We use z.object({ params: z.string() }) so the LLM sends the full search body
// as a JSON string. This avoids having to replicate Fiber's massive nested schemas.

interface ToolDef {
  name: string;
  description: string;
  path: string;
  schema: Record<string, z.ZodTypeAny>;
}

const tools: ToolDef[] = [
  // ── Search ──
  {
    name: "company_search",
    description: `Search for companies in Fiber AI database. Send a JSON object with:
- searchParams (object): filters like headquartersCountryCode, employeeCountV2, industriesV2, keywords, stage, totalFundingUSD, etc.
- pageSize (int, default 25, max 100)
- cursor (string|null): pagination cursor from previous response
- companyExclusionListIDs (string[]): optional exclusion lists
Example searchParams: { "headquartersCountryCode": { "anyOf": ["USA","GBR"] }, "employeeCountV2": { "min": 50, "max": 500 }, "industriesV2": { "anyOf": ["saas","fintech"] } }`,
    path: "/v1/company-search",
    schema: {
      searchParams: z
        .record(z.any())
        .describe("Company search filters object"),
      pageSize: z.number().optional().describe("Page size (1-100, default 25)"),
      cursor: z
        .string()
        .optional()
        .nullable()
        .describe("Pagination cursor from previous response"),
      companyExclusionListIDs: z
        .array(z.string())
        .optional()
        .describe("Company exclusion list IDs"),
    },
  },
  {
    name: "company_count",
    description: `Count companies matching search filters. Same searchParams as company_search but returns only the count.`,
    path: "/v1/company-count",
    schema: {
      searchParams: z
        .record(z.any())
        .describe("Company search filters object"),
      companyExclusionListIDs: z
        .array(z.string())
        .optional()
        .describe("Company exclusion list IDs"),
    },
  },
  {
    name: "investor_search",
    description: `Search for investors. searchParams can include:
- countryCode: { anyOf: ["USA",...] }
- types: { anyOf: ["venture_capital","angel",...] }
- numInvestments: { min, max }
- numLeadInvestments: { min, max }
- leadRate: { min, max }
- lastInvestmentDate: { min, max } (ISO dates)
- foundedOn: { min, max }
- isTopVc: boolean
- domains: string[]
- namePatterns: string[]
- sorting: { field, direction }`,
    path: "/v1/investor-search",
    schema: {
      searchParams: z
        .record(z.any())
        .describe("Investor search filters object"),
      pageSize: z.number().optional().describe("Page size (1-100, default 25)"),
      cursor: z
        .string()
        .optional()
        .nullable()
        .describe("Pagination cursor"),
    },
  },
  {
    name: "investment_search",
    description: `Search for investments / funding rounds. searchParams can include:
- investorName (string): partial match
- investorType: "person"|"organization"|"either"
- investorCountryCode: { anyOf: [...] }
- companyName, companyDomain, companyLinkedinUrl
- roundType: { anyOf: ["seed","series_a",...] }
- roundDate: { min, max }
- raisedAmountUSD: { min, max }
- postMoneyValuationUSD: { min, max }
- wasLeadInvestor: boolean
- sorting: { field, direction }`,
    path: "/v1/investment-search",
    schema: {
      searchParams: z
        .record(z.any())
        .optional()
        .nullable()
        .describe("Investment search filters object"),
      pageSize: z.number().optional().describe("Page size (1-100, default 25)"),
      cursor: z
        .string()
        .optional()
        .nullable()
        .describe("Pagination cursor"),
    },
  },
  {
    name: "people_search",
    description: `Search for people/profiles. searchParams can include:
- country3LetterCode: { anyOf: ["USA",...] }
- jobTitleV2: { anyOf: ["CEO","CTO",...] }
- keywords: { anyOf: [...], allOf: [...] }
- location: { anyOf: [...] }
- yearsOfExperience: { min, max }
- languages: { anyOf: [...] }
- numConnections: { min, max }
- numFollowers: { min, max }
- startedInRole: { min, max } (ISO dates)
- education: filters
Additional top-level params:
- currentCompanies: array of company identifiers
- prospectExclusionListIDs, companyExclusionListIDs: string[]`,
    path: "/v1/people-search",
    schema: {
      searchParams: z
        .record(z.any())
        .describe("People search filters object"),
      pageSize: z.number().optional().describe("Page size (1-100, default 25)"),
      cursor: z
        .string()
        .optional()
        .nullable()
        .describe("Pagination cursor"),
      currentCompanies: z
        .array(z.any())
        .optional()
        .nullable()
        .describe("Filter by current companies"),
      prospectExclusionListIDs: z
        .array(z.string())
        .optional()
        .nullable()
        .describe("Prospect exclusion list IDs"),
      companyExclusionListIDs: z
        .array(z.string())
        .optional()
        .nullable()
        .describe("Company exclusion list IDs"),
    },
  },
  {
    name: "people_search_count",
    description: `Count people matching search filters. Same searchParams as people_search but returns only the count.`,
    path: "/v1/people-search/count",
    schema: {
      searchParams: z
        .record(z.any())
        .describe("People search filters object"),
      currentCompanies: z
        .array(z.any())
        .optional()
        .nullable()
        .describe("Filter by current companies"),
      prospectExclusionListIDs: z
        .array(z.string())
        .optional()
        .nullable()
        .describe("Prospect exclusion list IDs"),
      companyExclusionListIDs: z
        .array(z.string())
        .optional()
        .nullable()
        .describe("Company exclusion list IDs"),
    },
  },
  {
    name: "combined_search_start",
    description: `Start an async combined search for companies AND people at once. Returns a searchId to poll. Params:
- companyParams: same filters as company_search.searchParams
- profileParams: same filters as people_search.searchParams
- maxCompanies (int): max companies to return
- maxProfiles (int): max profiles to return
- companyExclusionListIDs, prospectExclusionListIDs: string[]`,
    path: "/v1/combined-search/start",
    schema: {
      companyParams: z
        .record(z.any())
        .describe("Company search filters"),
      profileParams: z
        .record(z.any())
        .optional()
        .describe("Profile/people search filters"),
      maxCompanies: z
        .number()
        .optional()
        .describe("Max companies to return (default 25)"),
      maxProfiles: z
        .number()
        .optional()
        .describe("Max profiles to return (default 25)"),
      companyExclusionListIDs: z
        .array(z.string())
        .optional()
        .nullable()
        .describe("Company exclusion list IDs"),
      prospectExclusionListIDs: z
        .array(z.string())
        .optional()
        .nullable()
        .describe("Prospect exclusion list IDs"),
    },
  },
  {
    name: "combined_search_sync",
    description: `Run a synchronous combined search (waits for results). Same params as combined_search_start but returns results directly. Use for smaller searches. Params:
- companyParams, profileParams: search filters
- companyItemLimit, profileItemLimit: max items`,
    path: "/v1/combined-search/sync",
    schema: {
      companyParams: z
        .record(z.any())
        .describe("Company search filters"),
      profileParams: z
        .record(z.any())
        .optional()
        .describe("Profile/people search filters"),
      companyItemLimit: z
        .number()
        .optional()
        .nullable()
        .describe("Max companies to return"),
      profileItemLimit: z
        .number()
        .optional()
        .describe("Max profiles to return"),
      companyExclusionListIDs: z
        .array(z.string())
        .optional()
        .nullable()
        .describe("Company exclusion list IDs"),
      prospectExclusionListIDs: z
        .array(z.string())
        .optional()
        .nullable()
        .describe("Prospect exclusion list IDs"),
    },
  },
  {
    name: "combined_search_poll",
    description: `Poll results of a combined search started with combined_search_start. Params:
- searchId (string, required): the ID returned by combined_search_start
- entityType (string, required): "company" or "profile"
- pageSize (int): items per page
- cursor (string|null): pagination cursor`,
    path: "/v1/combined-search/poll",
    schema: {
      searchId: z.string().describe("Search ID from combined_search_start"),
      entityType: z
        .string()
        .describe('Entity type: "company" or "profile"'),
      pageSize: z.number().optional().describe("Page size"),
      cursor: z
        .string()
        .optional()
        .nullable()
        .describe("Pagination cursor"),
    },
  },

  // ── Google Maps ──
  {
    name: "google_maps_search_start",
    description: `Kick off a Google Maps search. Returns a searchID to check/poll. Params:
- query (string, required): what to search, e.g. "plumbers in San Francisco"
- name (string|null): optional business name filter
- maxResults (int): max results (default 100)
- strategy (object, required): one of:
  • { "strategy": "whole-usa" } — broad US search
  • { "strategy": "specific-areas", "unionAll": [{ "regionType": "circle", "center": { "latitude": 40.7, "longitude": -74.0 }, "radiusMiles": 25 }] }
  • { "strategy": "world-cities", "countriesAndRegions": { "unionAll": ["USA","GBR"] } }`,
    path: "/v1/google-maps-search/start",
    schema: {
      query: z.string().describe("Google Maps search query"),
      name: z
        .string()
        .optional()
        .nullable()
        .describe("Business name filter"),
      maxResults: z
        .number()
        .optional()
        .describe("Max results (default 100)"),
      strategy: z
        .record(z.any())
        .describe("Search strategy object (whole-usa, specific-areas, or world-cities)"),
    },
  },
  {
    name: "google_maps_search_check",
    description: `Check progress of a Google Maps search. Returns progress % and status. Params:
- searchID (string, required): the search ID from google_maps_search_start`,
    path: "/v1/google-maps-search/check",
    schema: {
      searchID: z.string().describe("Search ID from google_maps_search_start"),
    },
  },
  {
    name: "google_maps_search_poll",
    description: `Poll / retrieve results of a completed Google Maps search. Params:
- projectID (string, required): the project ID from google_maps_search_start
- pageSize (int): items per page
- cursor (string|null): pagination cursor`,
    path: "/v1/google-maps-search/poll",
    schema: {
      projectID: z.string().describe("Project ID from google_maps_search_start"),
      pageSize: z.number().optional().describe("Page size"),
      cursor: z
        .string()
        .optional()
        .nullable()
        .describe("Pagination cursor"),
    },
  },
];

// ─── Build MCP Server ────────────────────────────────────────────────────────
function createServer(): McpServer {
  const server = new McpServer({
    name: "fiber-ai-search",
    version: "1.0.0",
  });

  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      tool.schema,
      async (params) => {
        try {
          const result = await callFiber(
            tool.path,
            params as Record<string, unknown>
          );
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}

// ─── Express app with Streamable HTTP transport ──────────────────────────────
const app = express();
app.use(express.json());

// Store transports by session ID for session management
const transports = new Map<string, StreamableHTTPServerTransport>();

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// MCP endpoint — handles POST (messages), GET (SSE stream), DELETE (session end)
app.post("/mcp", async (req: Request, res: Response) => {
  try {
    // Check for existing session
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      // Reuse existing transport
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
      return;
    }

    // New session — create transport + server
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport);
        console.log(`Session created: ${id}`);
      },
    });

    // Clean up on close
    transport.onclose = () => {
      const sid = [...transports.entries()].find(
        ([, t]) => t === transport
      )?.[0];
      if (sid) {
        transports.delete(sid);
        console.log(`Session closed: ${sid}`);
      }
    };

    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("MCP POST error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
  transports.delete(sessionId);
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Fiber AI MCP Server listening on port ${PORT}`);
  console.log(`   Health: http://0.0.0.0:${PORT}/health`);
  console.log(`   MCP:    http://0.0.0.0:${PORT}/mcp`);
  console.log(
    `   API Key: ${FIBER_API_KEY ? "✅ configured" : "❌ NOT SET"}`
  );
});
