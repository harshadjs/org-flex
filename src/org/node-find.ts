// Go to node (§10b), like org-roam-node-find: every note and heading with an
// ID, by title, and a way to create the note when nothing has that title.

import { offerCreate } from "./new-note";
import { TitleCompletion } from "./vault-index";

export type NodeChoice =
  | { kind: "node"; node: TitleCompletion }
  | { kind: "create"; title: string };

/**
 * FIND-1, FIND-2: the nodes matching `query`, best first (`score` gives a
 * label's match score, or null when it doesn't match; ties keep the index
 * order), then the create entry when no node has exactly that title.
 * An empty query lists every node.
 */
export function findNodes(
  nodes: TitleCompletion[],
  query: string,
  score: (label: string) => number | null,
): NodeChoice[] {
  const choices: NodeChoice[] = [];
  if (!query.trim()) {
    for (const node of nodes) choices.push({ kind: "node", node });
    return choices;
  }
  const scored: { node: TitleCompletion; score: number; i: number }[] = [];
  nodes.forEach((node, i) => {
    const s = score(node.label);
    if (s !== null) scored.push({ node, score: s, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  for (const { node } of scored) choices.push({ kind: "node", node });
  if (offerCreate(nodes.map((n) => n.label), query)) choices.push({ kind: "create", title: query.trim() });
  return choices;
}
