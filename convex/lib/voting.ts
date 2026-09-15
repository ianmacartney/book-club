import type { Id } from "../_generated/dataModel";

type Candidate = Id<"nominations">;
export type Count = { nominationId: Candidate; votes: number };
export type Result = {
  label: string;
  counts: Count[];
  exhaustedBallots: number;
  eliminatedNominationId?: Candidate;
  tieBreakUsed: boolean;
};

export function countVotes(
  candidates: Candidate[],
  ballots: Candidate[][],
): Count[] {
  const counts = new Map(candidates.map((id) => [id, 0]));
  for (const ballot of ballots) {
    for (const id of ballot) {
      if (counts.has(id)) counts.set(id, counts.get(id)! + 1);
    }
  }
  return candidates.map((nominationId) => ({
    nominationId,
    votes: counts.get(nominationId)!,
  }));
}

/** Earlier in the published draw wins a tie for a place; later is eliminated. */
export function orderCounts(counts: Count[], draw: Candidate[]): Count[] {
  return [...counts].sort(
    (a, b) =>
      b.votes - a.votes ||
      draw.indexOf(a.nominationId) - draw.indexOf(b.nominationId),
  );
}

/** Instant runoff: transfer to the highest surviving preference until a majority.
 * Partial ballots exhaust. A tied final pair goes to a fresh, explicit runoff. */
export function rankedChoice(
  candidates: Candidate[],
  ballots: Candidate[][],
  draw: Candidate[],
) {
  let remaining = [...candidates];
  const results: Result[] = [];
  while (remaining.length > 0) {
    const preferences = ballots.map((b) => {
      const id = b.find((candidate) => remaining.includes(candidate));
      return id ? [id] : [];
    });
    const active = preferences.filter((b) => b.length > 0).length;
    const counts = orderCounts(countVotes(remaining, preferences), draw);
    const result: Result = {
      label: `Ranked count ${results.length + 1}`,
      counts,
      exhaustedBallots: ballots.length - active,
      tieBreakUsed: false,
    };
    results.push(result);
    if (counts[0].votes > active / 2) {
      return { winner: counts[0].nominationId, finalists: [], results };
    }
    if (remaining.length === 2) {
      return {
        winner: null,
        finalists: counts.map((c) => c.nominationId),
        results,
      };
    }
    const last = counts[counts.length - 1];
    result.tieBreakUsed = counts[counts.length - 2].votes === last.votes;
    result.eliminatedNominationId = last.nominationId;
    remaining = remaining.filter((id) => id !== last.nominationId);
  }
  throw new Error("Ranked voting needs candidates.");
}
