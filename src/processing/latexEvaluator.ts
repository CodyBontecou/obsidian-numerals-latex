import { ComputeEngine } from '@cortex-js/compute-engine';
import type { Expression } from '@cortex-js/compute-engine';
import { NumeralsError, NumeralsScope } from '../numerals.types';

/**
 * The CE's public `Expression` interface intentionally omits `op1`/`op2`/`ops`
 * (those are on narrowed sub-interfaces). In practice every object returned by
 * `ce.parse()` or `expr.evaluate()` is a concrete `_BoxedExpression` that has
 * these properties. We extend the interface locally so TypeScript is happy
 * without sprinkling `any` casts everywhere.
 */
interface CeExpr extends Expression {
	/** First operand (meaningful when the expression is a function call) */
	op1: CeExpr;
	/** Second operand (meaningful when the expression is a function call) */
	op2: CeExpr;
	/** All operands (undefined for atoms like numbers and symbols) */
	ops?: ReadonlyArray<CeExpr>;
	/** Symbol name — defined only when the expression is a symbol */
	symbol?: string;
}

/**
 * Applies a NumeralsScope (built from frontmatter) to the ComputeEngine symbol table.
 *
 * Only numeric values are applied — MathJS unit types and complex objects are skipped
 * because the CE uses its own type system. Multi-letter variable names parsed through
 * the CE's LaTeX parser are split into individual-letter products, so only single-letter
 * names are reliably usable in LaTeX expressions. Users can define multi-letter variables
 * inline using x = value assignment syntax.
 *
 * @param scope - The NumeralsScope from frontmatter/dataview processing
 * @param ce - The ComputeEngine instance to assign variables into
 */
export function applyNumeralsScopeToComputeEngine(
	scope: NumeralsScope | undefined,
	ce: ComputeEngine
): void {
	if (!scope) return;

	for (const [key, value] of scope.entries()) {
		try {
			if (typeof value === 'number' && isFinite(value)) {
				ce.assign(key, value);
			}
			// MathJS units, functions, and complex objects are not converted —
			// they'd require non-trivial translation to CE types.
		} catch {
			// Skip types that can't be assigned
		}
	}
}

/**
 * Evaluates a single row as either an assignment or a plain expression.
 *
 * Assignment detection: if the expression is `x = value` where the LHS is a
 * simple symbol (single or greek letter), the RHS is evaluated and assigned to
 * that symbol. This matches the natural LaTeX convention where `=` is used for
 * both definition and equality. The evaluated RHS is returned as the result.
 *
 * All other expressions are evaluated normally via the CE.
 *
 * @param row - LaTeX string with `__prev`/`__total` already substituted
 * @param ce - The ComputeEngine instance (holds variable assignments)
 * @returns The evaluated BoxedExpression
 */
function evaluateRow(row: string, ce: ComputeEngine): CeExpr {
	const expr = ce.parse(row) as CeExpr;

	if (expr.operator === 'Equal' && expr.op1?.symbol) {
		// Treat `x = value` as an assignment (most natural for a calculator)
		const sym = expr.op1.symbol;
		const val = expr.op2.evaluate() as CeExpr;
		ce.assign(sym, val);
		return val;
	}

	return expr.evaluate() as CeExpr;
}

/**
 * Substitutes the @prev magic variable placeholder (`__prev`) in a row with
 * the actual LaTeX of the previous result, wrapped in parentheses for safety.
 *
 * This avoids passing multi-letter identifiers to the CE's LaTeX parser,
 * which would split them into individual-letter products.
 */
function substitutePrev(row: string, prevLatex: string): string {
	return row.replace(/__prev\b/g, `\\left(${prevLatex}\\right)`);
}

/**
 * Substitutes the @sum/@total magic variable placeholder (`__total`) in a row
 * with the actual sum LaTeX, wrapped in parentheses.
 */
function substituteTotal(row: string, totalLatex: string): string {
	return row.replace(/__total\b/g, `\\left(${totalLatex}\\right)`);
}

/**
 * Computes the sum of a list of LaTeX result strings using the ComputeEngine.
 * Returns null if the sum cannot be computed (e.g., purely symbolic and non-addable).
 */
function computeSum(sectionResults: string[], ce: ComputeEngine): string | null {
	if (sectionResults.length === 0) return null;
	if (sectionResults.length === 1) return sectionResults[0];

	const sumLatex = sectionResults
		.map(r => `\\left(${r}\\right)`)
		.join('+');

	try {
		const sumExpr = ce.parse(sumLatex).evaluate();
		return sumExpr.latex;
	} catch {
		return null;
	}
}

/**
 * Evaluates a block of LaTeX math expressions using the Cortex Compute Engine.
 *
 * Each row is evaluated in sequence. The results are returned as LaTeX strings
 * suitable for rendering with MathJax. Variable assignments persist across rows
 * within the same block via the CE's internal symbol table.
 *
 * Magic directives (`@prev` → `__prev`, `@sum`/`@total` → `__total`) are
 * handled by substituting the actual previous/sum values directly into the
 * row string before the CE parses it. This avoids the CE's LaTeX parser
 * splitting multi-letter identifiers into letter products.
 *
 * @param processedSource - The preprocessed source (directives replaced, ready for CE)
 * @param ce - A fresh ComputeEngine instance per block (ensures isolation)
 * @returns Evaluation results, inputs, and any error information
 */
export function evaluateLatexFromSourceStrings(
	processedSource: string,
	ce: ComputeEngine
): {
	results: unknown[];
	inputs: string[];
	errorMsg: Error | null;
	errorInput: string;
} {
	let errorMsg: Error | null = null;
	let errorInput = '';

	const rows: string[] = processedSource.split('\n');
	const results: unknown[] = [];
	const inputs: string[] = [];

	// Remove trailing empty line (mirrors existing evaluator behavior)
	const isLastRowEmpty = rows[rows.length - 1] === '';
	const rowsToProcess = isLastRowEmpty ? rows.slice(0, -1) : rows;

	// Track start of current "sum section" (resets after empty/comment lines)
	let sectionStart = 0;

	for (const [index, row] of rowsToProcess.entries()) {
		const trimmed = row.trim();

		// Empty line or comment-only line: push undefined and reset section
		if (!trimmed || /^#/.test(trimmed)) {
			results.push(undefined);
			inputs.push(row);
			sectionStart = index + 1;
			continue;
		}

		// Collect valid results since the last section break (for @sum/@total)
		const sectionResults = (results.slice(sectionStart, index) as (string | undefined)[])
			.filter((r): r is string => r !== undefined);

		// Find most recent non-undefined result (for @prev)
		const lastValidResult = [...results]
			.reverse()
			.find((r): r is string => r !== undefined);

		// Validate @prev usage before substitution
		if (/__prev\b/i.test(row)) {
			if (lastValidResult === undefined) {
				errorMsg = new NumeralsError(
					'Previous Value Error',
					'Error evaluating @prev directive. There is no previous result.'
				);
				errorInput = row;
				break;
			}
		}

		// Validate @total/@sum usage before substitution
		if (/__total\b/i.test(row)) {
			if (sectionResults.length === 0) {
				errorMsg = new NumeralsError(
					'Summing Error',
					'Error evaluating @sum or @total directive. Previous lines may not be summable.'
				);
				errorInput = row;
				break;
			}
		}

		// Substitute magic variables with their actual LaTeX values
		// (avoids multi-letter identifier issues in the CE's LaTeX parser)
		let processedRow = row;

		if (lastValidResult !== undefined && /__prev\b/i.test(row)) {
			processedRow = substitutePrev(processedRow, lastValidResult);
		}

		if (sectionResults.length > 0 && /__total\b/i.test(row)) {
			const totalLatex = computeSum(sectionResults, ce);
			if (totalLatex !== null) {
				processedRow = substituteTotal(processedRow, totalLatex);
			} else {
				errorMsg = new NumeralsError(
					'Summing Error',
					'Error evaluating @sum or @total directive. Previous lines may not be summable.'
				);
				errorInput = row;
				break;
			}
		}

		// Evaluate the row
		try {
			const result = evaluateRow(processedRow, ce);

			// Surface CE evaluation errors (operator === 'Error')
			if (result.operator === 'Error') {
				const firstOp = result.ops?.[0];
				// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
				const errDetail = (firstOp as any)?.string ?? firstOp?.latex ?? 'Evaluation error';
				throw new NumeralsError('Evaluation Error', String(errDetail));
			}

			const resultLatex = result.latex;
			results.push(resultLatex);
			inputs.push(row);
		} catch (error) {
			errorMsg = error instanceof Error ? error : new Error(String(error));
			errorInput = row;
			break;
		}
	}

	return { results, inputs, errorMsg, errorInput };
}
