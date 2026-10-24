// Task lists in Markdown notes (§11): the `orgmode-tasks` code block.

import { registerTaskBlocks } from "../ui/tasks-block";
import type { Feature } from "./feature";

export const taskBlocks: Feature = {
  id: "task-blocks",
  section: "11. Org tasks in Markdown notes",
  load: registerTaskBlocks,
};
