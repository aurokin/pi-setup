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

/**
 * An artifact is only valid for the exact backend that produced it.
 *
 * Keyed by `provider/model`, not model alone. Two providers can expose the same
 * model id — `openai-codex/gpt-5.6-sol` and any gateway reselling it — and an
 * artifact is opaque ciphertext bound to the ChatGPT account that made it.
 * Replaying it anywhere else fails the request or drops the context silently,
 * which is strictly worse than the text summary it replaced.
 */
export interface StoredArtifact {
  readonly artifact: CompactionArtifact;
  readonly backend: string;
}

export interface PayloadSnapshot {
  readonly payload: Readonly<Record<string, unknown>>;
  readonly model: string;
  readonly backend: string;
  /**
   * When this request was captured.
   *
   * A snapshot is a *request*, so it necessarily predates the response to it.
   * Compaction compares this against the messages it is about to summarize:
   * anything newer is absent from the snapshot, so an artifact built from it
   * would cover less than the summary it replaces.
   */
  readonly capturedAt: number;
}

export function backendKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

export class CompactionState {
  #snapshot: PayloadSnapshot | undefined;
  readonly #artifacts = new Map<string, StoredArtifact>();

  recordPayload(
    payload: Readonly<Record<string, unknown>>,
    provider: string,
    now: number = Date.now(),
  ): void {
    const model = typeof payload.model === "string" ? payload.model : "";
    if (!model || !provider) return;
    this.#snapshot = {
      payload,
      model,
      backend: backendKey(provider, model),
      capturedAt: now,
    };
  }

  get snapshot(): PayloadSnapshot | undefined {
    return this.#snapshot;
  }

  /**
   * Forget the captured request without forgetting the artifacts.
   *
   * Branch and session changes invalidate the snapshot — it describes a
   * conversation the user has navigated away from — while the artifacts stay
   * valid for the compaction entries that still reference them.
   */
  clearSnapshot(): void {
    this.#snapshot = undefined;
  }

  remember(id: string, artifact: CompactionArtifact, backend: string): void {
    this.#artifacts.set(id, { artifact, backend });
  }

  lookup(id: string, backend: string): CompactionArtifact | undefined {
    const stored = this.#artifacts.get(id);
    if (!stored || stored.backend !== backend) return undefined;
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
    /** `provider/model`, so a reload cannot revive an artifact elsewhere. */
    readonly backend: string;
    readonly artifact: CompactionArtifact;
  };
}

export function toPersistedDetails(
  id: string,
  backend: string,
  artifact: CompactionArtifact,
): PersistedDetails {
  return { codexCompaction: { version: 1, id, backend, artifact } };
}

export function fromPersistedDetails(
  details: unknown,
): PersistedDetails["codexCompaction"] | undefined {
  if (typeof details !== "object" || details === null) return undefined;
  const entry = (details as Record<string, unknown>).codexCompaction;
  if (typeof entry !== "object" || entry === null) return undefined;
  const { version, id, backend, artifact } = entry as Record<string, unknown>;
  if (version !== 1) return undefined;
  if (typeof id !== "string" || typeof backend !== "string") return undefined;
  if (typeof artifact !== "object" || artifact === null) return undefined;
  return entry as PersistedDetails["codexCompaction"];
}
