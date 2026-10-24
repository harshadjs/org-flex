// The front matter panel (§7): the file's property drawer and `#+` lines as
// a title and a list of properties.

import { frontMatterPanel } from "../editor/front-matter-panel";
import type { Feature } from "./feature";

export const frontMatter: Feature = {
  id: "front-matter",
  section: "7. Front matter panel",
  editor: () => frontMatterPanel(),
};
