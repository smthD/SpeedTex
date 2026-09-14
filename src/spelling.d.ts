declare module 'nspell' {
  export default function nspell(dictionary: { aff: string; dic: string }): {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string): void;
  };
}
