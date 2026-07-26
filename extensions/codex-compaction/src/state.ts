/**
 * What this extension remembers within a session.
 *
 * Two things, and both are deliberately cheap to lose:
 *
 *  - the most recent provider payload, so a compaction request can be built
 *    from pi's own request rather than a second reconstruction of it
 *  - artifacts by id, so a marked summary can be swapped back
 *
 * Artifacts are also persisted in the session's compaction entry `details`, so
 * this map is a cache, not the record. Losing it costs a text summary instead
 * of an artifact — the same outcome as never having had one.
 */

import type { CompactionArtifact } from "./protocol.ts";

/** An artifact is only valid for the model that produced it. */
export interface StoredArtifact {
  readonly artifact: CompactionArtifact;
  readonly model: string;
}

export interface PayloadSnapshot {
  readonly payload: Readonly<Record<string, unknown>>;
  readonly model: string;
}

export class CompactionState {
  #snapshot: PayloadSnapshot | undefined;
  readonly #artifacts = new Map<string, StoredArtifact>();

  recordPayload(payload: Readonly<Record<string, unknown>>): void {
    const model = typeof payload.model === "string" ? payload.model : "";
    if (!model) return;
    this.#snapshot = { payload, model };
  }

  get snapshot(): PayloadSnapshot | undefined {
    return this.#snapshot;
  }

  remember(id: string, artifact: CompactionArtifact, model: string): void {
    this.#artifacts.set(id, { artifact, model });
  }

  /**
   * Look up an artifact valid for `model`.
   *
   * Cross-model reuse is refused rather than attempted. The artifact is opaque
   * and server-decrypted; handing gpt-5.6-sol's artifact to another model is at
   * best an error and at worst silent context corruption.
   */
  lookup(id: string, model: string): CompactionArtifact | undefined {
    const stored = this.#artifacts.get(id);
    if (!stored || stored.model !== model) return undefined;
    return stored.artifact;
  }

  has(id: string): boolean {
    return this.#artifacts.has(id);
  }

  clear(): void {
    this.#snapshot = undefined;
    this.#artifacts.clear();
  }

  get size(): number {
    return this.#artifacts.size;
  }
}

/** Shape stored under `CompactionEntry.details` so a reload can restore it. */
export interface PersistedDetails {
  readonly codexCompaction: {
    readonly version: 1;
    readonly id: string;
    readonly model: string;
    readonly artifact: CompactionArtifact;
  };
}

export function toPersistedDetails(
  id: string,
  model: string,
  artifact: CompactionArtifact,
): PersistedDetails {
  return { codexCompaction: { version: 1, id, model, artifact } };
}

export function fromPersistedDetails(
  details: unknown,
): PersistedDetails["codexCompaction"] | undefined {
  if (typeof details !== "object" || details === null) return undefined;
  const entry = (details as Record<string, unknown>).codexCompaction;
  if (typeof entry !== "object" || entry === null) return undefined;
  const { version, id, model, artifact } = entry as Record<string, unknown>;
  if (version !== 1) return undefined;
  if (typeof id !== "string" || typeof model !== "string") return undefined;
  if (typeof artifact !== "object" || artifact === null) return undefined;
  return entry as PersistedDetails["codexCompaction"];
}
