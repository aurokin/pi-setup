/**
 * The set of live loops, and what to do with them on each tick.
 *
 * Kept separate from the scheduling arithmetic so the collection's own
 * behaviour — ids never colliding, expiry actually removing things — is
 * testable on its own.
 */

import { tick, type Loop } from "./schedule.ts";

export interface Advance {
  readonly fire: readonly Loop[];
  readonly expired: readonly Loop[];
}

export class LoopRegistry {
  #loops = new Map<string, Loop>();
  #counter = 0;

  /**
   * Monotonic, never reused within a session.
   *
   * Reusing a freed id would let `/loop stop 2` cancel a loop the user never
   * meant, in the window between reading the list and typing the command.
   */
  nextId(): string {
    this.#counter += 1;
    return `loop-${this.#counter}`;
  }

  add(loop: Loop): void {
    this.#loops.set(loop.id, loop);
  }

  get(id: string): Loop | undefined {
    return this.#loops.get(id);
  }

  remove(id: string): boolean {
    return this.#loops.delete(id);
  }

  clear(): number {
    const count = this.#loops.size;
    this.#loops.clear();
    return count;
  }

  list(): Loop[] {
    return [...this.#loops.values()];
  }

  get size(): number {
    return this.#loops.size;
  }

  /**
   * Advance every loop and report what should happen.
   *
   * Expired loops are removed here rather than by a separate sweep, so there is
   * no state in which a loop is past its expiry and still able to fire.
   */
  advance(now: number, busy: boolean): Advance {
    const fire: Loop[] = [];
    const expired: Loop[] = [];
    for (const [id, loop] of this.#loops) {
      // At most one loop fires per sweep. `busy` is a snapshot taken before any
      // of them ran, so firing every due loop against it would queue the second
      // and third behind the turn the first just started — stacking the prompts
      // the scheduler exists to keep from stacking. The rest are skipped, which
      // is what they would have been had the snapshot been taken a moment later.
      const action = tick(loop, now, busy || fire.length > 0);
      switch (action.kind) {
        case "idle":
          break;
        case "expired":
          this.#loops.delete(id);
          expired.push(action.loop);
          break;
        case "skip":
          this.#loops.set(id, action.loop);
          break;
        case "fire":
          this.#loops.set(id, action.loop);
          fire.push(action.loop);
          break;
      }
    }
    return { fire, expired };
  }
}
