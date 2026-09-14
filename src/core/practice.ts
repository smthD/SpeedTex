export type PracticeStyle = 'physics' | 'mathematics';
export type Difficulty = 'short' | 'standard' | 'extended';
export interface Challenge {
  id: string;
  style: PracticeStyle;
  difficulty: Difficulty;
  topic: string;
  tex: string;
}
export interface PracticeScore {
  id: string;
  style: PracticeStyle;
  difficulty: Difficulty;
  cpm: number;
  seconds: number;
  characters: number;
  date: string;
}
export const SCORE_KEY = 'quill.practice.scores.v1';
export function normalizeEquation(tex: string): string {
  // Preserve command boundaries and spaces inside text; ignore math layout spaces.
  return (
    equationBody(tex)
      .match(/\\text\{[^}]*\}|\\[a-zA-Z]+|\\.|[^\s]/g)
      ?.join('\u0001') || ''
  );
}
export function equationBody(tex: string): string {
  const s = tex.trim();
  for (const [a, b] of [
    ['\\[', '\\]'],
    ['\\(', '\\)'],
    ['$$', '$$'],
    ['$', '$'],
  ])
    if (s.startsWith(a) && s.endsWith(b) && s.length >= a.length + b.length)
      return s.slice(a.length, -b.length).trim();
  return s;
}
export function makeScore(
  challenge: Challenge,
  elapsedMs: number,
  assisted: boolean,
): PracticeScore | null {
  if (assisted || !Number.isFinite(elapsedMs) || elapsedMs < 1000) return null;
  const characters = challenge.tex.replace(/\s/g, '').length;
  return {
    id: challenge.id,
    style: challenge.style,
    difficulty: challenge.difficulty,
    characters,
    seconds: elapsedMs / 1000,
    cpm: Math.round((characters * 60000) / elapsedMs),
    date: new Date().toISOString(),
  };
}
export function readScores(raw: string | null): PracticeScore[] {
  try {
    const value: unknown = JSON.parse(raw || '[]');
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (s): s is PracticeScore =>
          s &&
          typeof s.id === 'string' &&
          ['physics', 'mathematics'].includes(s.style) &&
          ['short', 'standard', 'extended'].includes(s.difficulty) &&
          Number.isFinite(s.cpm) &&
          s.cpm > 0 &&
          Number.isFinite(s.seconds) &&
          s.seconds >= 1 &&
          Number.isFinite(s.characters) &&
          s.characters > 0 &&
          typeof s.date === 'string',
      )
      .slice(0, 300);
  } catch {
    return [];
  }
}
export function addScore(scores: PracticeScore[], score: PracticeScore): PracticeScore[] {
  if (scores.some((s) => s.id === score.id)) return scores;
  return [...scores, score]
    .sort((a, b) => b.cpm - a.cpm)
    .filter(
      (s, i, all) =>
        all.slice(0, i).filter((x) => x.style === s.style && x.difficulty === s.difficulty).length <
        10,
    );
}
export { generateChallenge, createChallengeGenerator } from './practice-generator.ts';
