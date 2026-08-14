import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { mcpSupabase } from "../supabase";

export default defineTool({
  name: "search_locations",
  title: "Search campus locations",
  description:
    "Search campus locations by free-text name (English or Kannada) and/or category. Returns matching locations with slug, name, category, floor, and description.",
  inputSchema: {
    query: z.string().trim().optional().describe("Free-text match on the location name."),
    category: z.string().trim().optional().describe("Exact category filter (e.g. 'academic', 'food')."),
    limit: z.number().int().min(1).max(50).optional().describe("Max results (default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, category, limit }) => {
    const supabase = mcpSupabase();
    let q = supabase
      .from("locations")
      .select("slug,name_en,name_kn,category,floor,description")
      .order("name_en")
      .limit(limit ?? 20);
    if (query) q = q.or(`name_en.ilike.%${query}%,name_kn.ilike.%${query}%,description.ilike.%${query}%`);
    if (category) q = q.eq("category", category);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { results: data ?? [] },
    };
  },
});
