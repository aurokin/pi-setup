/**
 * Corrections to pi's generated base prompt, applied before our policy is appended.
 *
 * These are not policy. They repair guidance pi emits that is wrong *for this
 * install*, which is cheaper and clearer than arguing with it in prose.
 */

/**
 * pi decides whether to recommend shelling out for search by checking for tools
 * literally named `grep`, `find`, and `ls`:
 *
 *   const hasGrep = tools.includes("grep");   // system-prompt.js:55-61
 *   if (hasBash && !hasGrep && !hasFind && !hasLs)
 *     addGuideline("Use bash for file operations like ls, rg, find");
 *
 * The file-search extension registers its tools as `rg` and `fd`
 * (file-search/index.ts:211,282), so all three checks are false and pi tells the
 * model to shell out — directly contradicting the first-class tools this setup
 * ships. Verified present in a captured provider payload, not just in source.
 *
 * Removing the line is better than countering it: one instruction beats two
 * opposed ones, and it costs no prompt tokens to delete.
 */
const PI_BASH_SEARCH_GUIDELINE =
  "- Use bash for file operations like ls, rg, find\n";

export function stripContradictoryGuidelines(systemPrompt: string) {
  return systemPrompt.replace(PI_BASH_SEARCH_GUIDELINE, "");
}
