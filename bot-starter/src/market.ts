import { LETTER_VALUE } from "./dictionary.js";

type Class = "p4" | "p58" | "pZQ";
type Observation = { match: bigint; id: bigint; letter: string; paid: number };

// Keep auction identities so reconnects cannot double-count observations.
// Sort within each match before assigning phases: subscription snapshots
// need not deliver rows in auction order.
export class MarketLearner {
  private rows = new Map<bigint, Observation>();
  private cached: Record<Class, (number | null)[]> | undefined;

  observe(match: bigint, id: bigint, letter: string, paid: number) {
    if (this.rows.has(id)) return;
    this.rows.set(id, { match, id, letter, paid });
    this.cached = undefined;
    if (this.rows.size > 20000) {
      const oldest = [...this.rows.values()].reduce((a, b) => a.match < b.match ? a : b).match;
      for (const [key, row] of this.rows) if (row.match === oldest) this.rows.delete(key);
    }
  }

  table(): Record<Class, (number | null)[]> {
    if (this.cached) return this.cached;
    const samples: Record<Class, number[][]> = {
      p4: [[], [], [], [], []], p58: [[], [], [], [], []], pZQ: [[], [], [], [], []],
    };
    const rounds = new Map<bigint, number>();
    const rows = [...this.rows.values()].sort((a, b) => a.id < b.id ? -1 : 1);
    for (const row of rows) {
      const round = rounds.get(row.match) ?? 0;
      rounds.set(row.match, round + 1);
      const face = LETTER_VALUE[row.letter] ?? 0;
      if (face < 4 || row.paid <= 0) continue;
      const cls: Class = face >= 10 ? "pZQ" : face >= 5 ? "p58" : "p4";
      const phase = round < 16 ? 0 : round < 31 ? 1 : round < 46 ? 2 : round < 60 ? 3 : 4;
      const cell = samples[cls][phase]!;
      cell.push(row.paid);
      if (cell.length > 60) cell.shift();
    }
    const median = (cell: number[]) => cell.length < 8 ? null : [...cell].sort((a, b) => a - b)[Math.floor(cell.length / 2)]!;
    return this.cached = { p4: samples.p4.map(median), p58: samples.p58.map(median), pZQ: samples.pZQ.map(median) };
  }
}
