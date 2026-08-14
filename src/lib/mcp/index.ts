import { defineMcp } from "@lovable.dev/mcp-js";
import searchLocations from "./tools/search-locations";
import listCategories from "./tools/list-categories";
import getDirections from "./tools/get-directions";

export default defineMcp({
  name: "campus-navigator-mcp",
  title: "Campus Navigator MCP",
  version: "0.1.0",
  instructions:
    "Tools for the Campus Navigator app. Use `search_locations` to find places on campus, `list_categories` to browse categories, and `get_directions` to compute a walking route between two locations by slug.",
  tools: [searchLocations, listCategories, getDirections],
});
