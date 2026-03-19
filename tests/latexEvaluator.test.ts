/**
 * Tests for the LaTeX evaluator (Cortex Compute Engine integration).
 *
 * These tests validate the evaluation logic for `math-latex` blocks:
 * - Basic arithmetic (exact rational results)
 * - Variable assignment and reuse
 * - Greek letter variables
 * - Trigonometry and constants
 * - @prev / @sum directives (via __prev / __total placeholders)
 * - Empty line / comment handling
 * - Error cases
 */

import { ComputeEngine } from '@cortex-js/compute-engine';
import {
	evaluateLatexFromSourceStrings,
	applyNumeralsScopeToComputeEngine,
} from '../src/processing/latexEvaluator';
import { NumeralsScope } from '../src/numerals.types';

function makeEvaluator(source: string) {
	const ce = new ComputeEngine();
	return evaluateLatexFromSourceStrings(source, ce);
}

// ---------------------------------------------------------------------------
// Basic arithmetic
// ---------------------------------------------------------------------------

describe('Basic arithmetic', () => {
	test('integer addition', () => {
		const { results, errorMsg } = makeEvaluator('2 + 3');
		expect(errorMsg).toBeNull();
		expect(results[0]).toBe('5');
	});

	test('exact fraction addition', () => {
		const { results, errorMsg } = makeEvaluator('\\frac{1}{2} + \\frac{1}{4}');
		expect(errorMsg).toBeNull();
		// CE returns exact rational: 3/4
		expect(results[0]).toMatch(/frac.*3.*4|3\/4/);
	});

	test('multiplication', () => {
		const { results, errorMsg } = makeEvaluator('6 \\times 7');
		expect(errorMsg).toBeNull();
		expect(results[0]).toBe('42');
	});

	test('power', () => {
		const { results, errorMsg } = makeEvaluator('2^{10}');
		expect(errorMsg).toBeNull();
		// CE may format large numbers with thin-space thousands separators (e.g. "1\,024")
		expect(String(results[0]).replace(/\\,/g, '')).toBe('1024');
	});

	test('square root (exact)', () => {
		const { results, errorMsg } = makeEvaluator('\\sqrt{9}');
		expect(errorMsg).toBeNull();
		expect(results[0]).toBe('3');
	});

	test('multiline expressions', () => {
		const { results, errorMsg } = makeEvaluator('1 + 1\n2 + 2\n3 + 3');
		expect(errorMsg).toBeNull();
		expect(results).toEqual(['2', '4', '6']);
	});
});

// ---------------------------------------------------------------------------
// Variable assignment
// ---------------------------------------------------------------------------

describe('Variable assignment', () => {
	test('assigns single-letter variable and reuses it', () => {
		const { results, errorMsg } = makeEvaluator('x = 5\nx^2 + 3');
		expect(errorMsg).toBeNull();
		expect(results[0]).toBe('5');
		expect(results[1]).toBe('28');
	});

	test('chained assignments', () => {
		const { results, errorMsg } = makeEvaluator('a = 3\nb = 4\na^2 + b^2');
		expect(errorMsg).toBeNull();
		expect(results[2]).toBe('25');
	});

	test('greek letter assignment', () => {
		const { results, errorMsg } = makeEvaluator('\\alpha = 3\n\\alpha^2');
		expect(errorMsg).toBeNull();
		expect(results[0]).toBe('3');
		expect(results[1]).toBe('9');
	});

	test('assignment result is the RHS value', () => {
		const { results, errorMsg } = makeEvaluator('r = 7');
		expect(errorMsg).toBeNull();
		expect(results[0]).toBe('7');
	});
});

// ---------------------------------------------------------------------------
// Trigonometry and constants
// ---------------------------------------------------------------------------

describe('Trigonometry and constants', () => {
	test('sin(pi/6) = 1/2 (exact)', () => {
		const { results, errorMsg } = makeEvaluator('\\sin\\left(\\frac{\\pi}{6}\\right)');
		expect(errorMsg).toBeNull();
		expect(results[0]).toMatch(/frac.*1.*2|1\/2/);
	});

	test('cos(pi) = -1', () => {
		const { results, errorMsg } = makeEvaluator('\\cos(\\pi)');
		expect(errorMsg).toBeNull();
		expect(results[0]).toBe('-1');
	});
});

// ---------------------------------------------------------------------------
// Empty lines and comments
// ---------------------------------------------------------------------------

describe('Empty lines and comments', () => {
	test('empty line gives undefined result', () => {
		const { results, errorMsg } = makeEvaluator('1 + 1\n\n2 + 2');
		expect(errorMsg).toBeNull();
		expect(results[0]).toBe('2');
		expect(results[1]).toBeUndefined();
		expect(results[2]).toBe('4');
	});

	test('comment-only line gives undefined result', () => {
		const { results, errorMsg } = makeEvaluator('1 + 1\n# this is a comment\n3 + 3');
		expect(errorMsg).toBeNull();
		expect(results[0]).toBe('2');
		expect(results[1]).toBeUndefined();
		expect(results[2]).toBe('6');
	});

	test('trailing newline is ignored', () => {
		const { results, errorMsg } = makeEvaluator('5\n');
		expect(errorMsg).toBeNull();
		expect(results).toHaveLength(1);
		expect(results[0]).toBe('5');
	});
});

// ---------------------------------------------------------------------------
// @prev directive (substituted as __prev)
// ---------------------------------------------------------------------------

describe('@prev directive (__prev)', () => {
	test('__prev references previous result', () => {
		const { results, errorMsg } = makeEvaluator('5\n__prev + 3');
		expect(errorMsg).toBeNull();
		expect(results[0]).toBe('5');
		expect(results[1]).toBe('8');
	});

	test('__prev with fraction', () => {
		const { results, errorMsg } = makeEvaluator('\\frac{1}{2}\n__prev + \\frac{1}{2}');
		expect(errorMsg).toBeNull();
		expect(results[1]).toBe('1');
	});

	test('__prev with no previous result gives error', () => {
		const { errorMsg, errorInput } = makeEvaluator('__prev + 1');
		expect(errorMsg).not.toBeNull();
		expect(errorMsg?.name).toBe('Previous Value Error');
		expect(errorInput).toBe('__prev + 1');
	});

	test('__prev skips undefined (empty) lines', () => {
		// Empty line doesn't reset @prev — it should still reference the last value
		const { results, errorMsg } = makeEvaluator('3\n\n__prev + 1');
		expect(errorMsg).toBeNull();
		expect(results[2]).toBe('4');
	});
});

// ---------------------------------------------------------------------------
// @sum / @total directive (substituted as __total)
// ---------------------------------------------------------------------------

describe('@sum / @total directive (__total)', () => {
	test('__total sums section results', () => {
		const { results, errorMsg } = makeEvaluator('2\n3\n4\n__total');
		expect(errorMsg).toBeNull();
		expect(results[3]).toBe('9');
	});

	test('__total with fractions', () => {
		const { results, errorMsg } = makeEvaluator('\\frac{1}{4}\n\\frac{1}{4}\n__total');
		expect(errorMsg).toBeNull();
		expect(results[2]).toMatch(/frac.*1.*2|1\/2/);
	});

	test('__total with no previous results gives error', () => {
		const { errorMsg } = makeEvaluator('__total');
		expect(errorMsg).not.toBeNull();
		expect(errorMsg?.name).toBe('Summing Error');
	});

	test('empty line resets __total section', () => {
		const { results, errorMsg } = makeEvaluator('10\n20\n\n5\n__total');
		expect(errorMsg).toBeNull();
		// After the empty line, only 5 is in the current section
		expect(results[4]).toBe('5');
	});
});

// ---------------------------------------------------------------------------
// Frontmatter scope application
// ---------------------------------------------------------------------------

describe('applyNumeralsScopeToComputeEngine', () => {
	test('applies numeric scope values to CE', () => {
		const scope = new NumeralsScope();
		scope.set('x', 10);
		const ce = new ComputeEngine();
		applyNumeralsScopeToComputeEngine(scope, ce);

		const result = evaluateLatexFromSourceStrings('x^2', ce);
		expect(result.errorMsg).toBeNull();
		expect(result.results[0]).toBe('100');
	});

	test('skips non-numeric scope values without error', () => {
		const scope = new NumeralsScope();
		scope.set('x', 5);
		scope.set('unitValue', { toNumber: () => 42 }); // MathJS unit mock
		const ce = new ComputeEngine();
		// Should not throw
		expect(() => applyNumeralsScopeToComputeEngine(scope, ce)).not.toThrow();
	});

	test('handles undefined scope gracefully', () => {
		const ce = new ComputeEngine();
		expect(() => applyNumeralsScopeToComputeEngine(undefined, ce)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// inputs array matches evaluated rows
// ---------------------------------------------------------------------------

describe('inputs array', () => {
	test('inputs contains only successfully evaluated rows', () => {
		const { inputs, results } = makeEvaluator('1\n2\n3');
		expect(inputs).toHaveLength(3);
		expect(results).toHaveLength(3);
	});

	test('stops at error on __prev with no previous result', () => {
		// @prev with no prior result is a well-defined error case
		const { inputs, results, errorMsg, errorInput } = makeEvaluator('__prev + 1\n2 + 2');
		expect(errorMsg).not.toBeNull();
		expect(errorInput).toBe('__prev + 1');
		// Nothing should have been evaluated before the error
		expect(inputs).toHaveLength(0);
		expect(results).toHaveLength(0);
	});
});
