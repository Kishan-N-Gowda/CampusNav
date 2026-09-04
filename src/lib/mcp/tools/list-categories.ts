import { defineTool } from "@lovable.dev/mcp-js";
import { mcpSupabase } from "../supabase";
import { parsePauseValue } from "../../databasePause";

export default defineTool({
  name: "list_categories",
  title: "List location categories",
  description: "Return the distinct set of campus location categories with counts.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async () => {
    const supabase = mcpSupabase();
    const { data: settings } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["database_paused", "campus_map"]);

    const pausedRow = (settings ?? []).find((s) => s.key === "database_paused");
    const mapRow = (settings ?? []).find((s) => s.key === "campus_map");

    let isPaused = false;
    if (pausedRow?.value != null) {
      isPaused = parsePauseValue(pausedRow.value).paused;
    } else if ((mapRow?.value as any)?.database_paused != null) {
      isPaused = parsePauseValue((mapRow?.value as any).database_paused).paused;
    }

    if (isPaused) {
      return {
        content: [{ type: "text", text: "Campus Navigation is temporarily unavailable." }],
        structuredContent: { categories: [], isPaused: true },
      };
    }
    const { data, error } = await supabase.from("locations").select("category");
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const c = (row as any).category ?? "uncategorized";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const categories = Array.from(counts, ([category, count]) => ({ category, count })).sort(
      (a, b) => b.count - a.count,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(categories, null, 2) }],
      structuredContent: { categories },
    };
  },
});
