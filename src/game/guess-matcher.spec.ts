import { matchGuess } from './guess-matcher';

describe('matchGuess', () => {
  describe('exact matches', () => {
    it('accepts an exact match', () => {
      const result = matchGuess('Drake', 'Drake');
      expect(result.isCorrect).toBe(true);
      expect(result.isExactMatch).toBe(true);
      expect(result.points).toBeGreaterThan(0);
    });

    it('is case-insensitive', () => {
      expect(matchGuess('drake', 'Drake').isCorrect).toBe(true);
    });

    it('ignores surrounding whitespace', () => {
      expect(matchGuess('  Drake  ', 'Drake').isCorrect).toBe(true);
    });
  });

  describe('missing articles', () => {
    it('accepts the answer without a leading "The"', () => {
      expect(matchGuess('weeknd', 'The Weeknd').isCorrect).toBe(true);
    });

    it('accepts the answer with a leading "The"', () => {
      expect(matchGuess('The Weeknd', 'Weeknd').isCorrect).toBe(true);
    });

    it('accepts "The Beatles" without the article', () => {
      expect(matchGuess('beatles', 'The Beatles').isCorrect).toBe(true);
    });
  });

  describe('typos', () => {
    it('accepts a single typo in a short title', () => {
      expect(matchGuess('the weekend', 'The Weeknd').isCorrect).toBe(true);
    });

    it('accepts a missing accent', () => {
      expect(matchGuess('Beyonce', 'Beyoncé').isCorrect).toBe(true);
    });

    it('accepts a small typo in a longer title', () => {
      expect(matchGuess('bohemian rapsody', 'Bohemian Rhapsody').isCorrect).toBe(true);
    });
  });

  describe('featuring artists', () => {
    it('accepts the primary artist when the answer features another', () => {
      expect(matchGuess('Drake', 'Drake feat. Rihanna').isCorrect).toBe(true);
    });

    it('accepts the primary artist when the answer uses "feat"', () => {
      expect(matchGuess('Calvin Harris', 'Calvin Harris feat Rihanna').isCorrect).toBe(true);
    });
  });

  describe('stop words', () => {
    it('rejects a guess made only of stop words', () => {
      expect(matchGuess('the', 'The Weeknd').isCorrect).toBe(false);
    });

    it('rejects "love" against a title containing it', () => {
      expect(matchGuess('love', 'Crazy in Love').isCorrect).toBe(false);
    });

    it('rejects a stop-word-only guess against a longer title', () => {
      expect(matchGuess('a the of', 'The Lord of the Rings').isCorrect).toBe(false);
    });
  });

  describe('superstrings', () => {
    it('rejects a long wrong guess that contains the answer', () => {
      expect(matchGuess('not drake at all', 'Drake').isCorrect).toBe(false);
    });

    it('rejects a guess that merely contains the answer as a substring', () => {
      expect(matchGuess('the weeknd is great', 'The Weeknd').isCorrect).toBe(false);
    });
  });

  describe('unrelated guesses', () => {
    it('rejects a completely different title', () => {
      expect(matchGuess('Taylor Swift', 'Drake').isCorrect).toBe(false);
    });

    it('rejects an empty guess', () => {
      expect(matchGuess('', 'Drake').isCorrect).toBe(false);
    });
  });
});
