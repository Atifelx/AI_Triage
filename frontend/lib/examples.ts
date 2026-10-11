// Manual-triage examples: 50 held-out incidents served by the backend
// (GET /api/v1/examples). Each click deals the next card from a shuffled deck, so no
// example repeats until all 50 have been shown.

import { getExamples } from "./api";
import type { Example } from "./types";

export class ExampleDeck {
  private order: number[] = [];
  private cursor = 0;

  constructor(
    private readonly examples: Example[],
    private readonly random: () => number = Math.random,
  ) {
    this.shuffle();
  }

  get size(): number {
    return this.examples.length;
  }

  private shuffle() {
    this.order = this.examples.map((_, i) => i);
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
    this.cursor = 0;
  }

  /** Next unseen example; reshuffles after the whole deck has been dealt. */
  next(): { example: Example; dealt: number } {
    if (this.cursor >= this.order.length) this.shuffle();
    const example = this.examples[this.order[this.cursor++]];
    return { example, dealt: this.cursor };
  }
}

let deck: Promise<ExampleDeck | null> | null = null;

/** Loads the deck once per page load; resolves null when the backend has none. */
export function loadDeck(): Promise<ExampleDeck | null> {
  deck ??= getExamples()
    .then((r) => (r.examples.length ? new ExampleDeck(r.examples) : null))
    .catch(() => {
      deck = null; // allow a retry on the next click
      return null;
    });
  return deck;
}

/** Test hook: forget the cached deck. */
export function resetExampleDeck(): void {
  deck = null;
}
