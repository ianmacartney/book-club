export type SubmissionDraft = { quotes: string; thoughts: string };

// Survives screen/tab/auth remounts for the life of the app process. Scope by
// both writer and section so a recovered draft never opens under another user.
const drafts = new Map<string, SubmissionDraft>();

export function readSubmissionDraft(key: string): SubmissionDraft {
  return drafts.get(key) ?? { quotes: "", thoughts: "" };
}

export function saveSubmissionDraft(key: string, draft: SubmissionDraft): void {
  if (draft.quotes.length === 0 && draft.thoughts.length === 0) {
    drafts.delete(key);
  } else {
    drafts.set(key, draft);
  }
}

export function clearSubmissionDraft(key: string): void {
  drafts.delete(key);
}
