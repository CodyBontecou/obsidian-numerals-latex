import { LineRenderData, RenderContext } from '../numerals.types';
import { BaseLineRenderer } from './BaseLineRenderer';
import { mathjaxLoop } from '../rendering/displayUtils';

/**
 * LaTeX-native renderer for Numerals blocks.
 *
 * Unlike the TeX renderer (which converts MathJS results into TeX), this
 * renderer works with expressions that are already LaTeX — both on the input
 * side (the user writes LaTeX) and the result side (the Compute Engine returns
 * LaTeX). Both sides are rendered directly via MathJax with no intermediate
 * conversion.
 *
 * Magic directive placeholders in `processedInput` (`__prev`, `__total`) are
 * replaced with readable display text before rendering so the user sees
 * familiar `@prev` / `@sum` labels rather than internal variable names.
 */
export class LatexRenderer extends BaseLineRenderer {
	/**
	 * Renders a single line of a LaTeX-mode Numerals block.
	 *
	 * - Empty lines (no result): show raw input as plain text with comment
	 * - Non-empty lines: render input as MathJax, render result as MathJax
	 *
	 * @param container - The line container element
	 * @param lineData - Prepared line data (result is a LaTeX string)
	 * @param context - Rendering context with settings and formatting
	 */
	renderLine(
		container: HTMLElement,
		lineData: LineRenderData,
		context: RenderContext
	): void {
		const { inputElement, resultElement } = this.createElements(container);

		if (lineData.isEmpty) {
			// Empty line: show raw input as plain text (usually a comment or blank)
			const displayText = lineData.rawInput + (lineData.comment || '');
			inputElement.setText(displayText);
			resultElement.setText('\xa0');
			this.handleEmptyLine(inputElement, resultElement);
		} else {
			// Non-empty line: render both sides as LaTeX via MathJax
			this.renderInputLatex(inputElement, lineData);
			this.renderResultLatex(resultElement, lineData, context);

			if (lineData.comment) {
				this.renderInlineComment(inputElement, lineData.comment);
			}
		}
	}

	/**
	 * Renders the input portion as LaTeX via MathJax.
	 *
	 * The `processedInput` from the preprocessor contains internal magic variable
	 * names (`__prev`, `__total`). These are replaced with display-friendly
	 * labels before rendering:
	 *   - `__prev`  → `\text{@prev}`
	 *   - `__total` → `\text{@sum}`
	 *
	 * @param inputElement - The input container element
	 * @param lineData - Prepared line data
	 * @private
	 */
	private renderInputLatex(inputElement: HTMLElement, lineData: LineRenderData): void {
		let displayLatex = lineData.processedInput
			.replace(/__prev\b/g, '\\text{@prev}')
			.replace(/__total\b/g, '\\text{@sum}');

		const inputTexElement = inputElement.createEl('span', { cls: 'numerals-tex' });
		void mathjaxLoop(inputTexElement, displayLatex);
	}

	/**
	 * Renders the result portion as LaTeX via MathJax.
	 *
	 * The result stored in `lineData.result` is a LaTeX string produced by the
	 * Compute Engine (e.g., `\frac{3}{4}`, `42`, `\sqrt{2}`). It is rendered
	 * directly with MathJax without any conversion.
	 *
	 * @param resultElement - The result container element
	 * @param lineData - Prepared line data
	 * @param context - Rendering context (used for result separator)
	 * @private
	 */
	private renderResultLatex(
		resultElement: HTMLElement,
		lineData: LineRenderData,
		context: RenderContext
	): void {
		const resultLatex = String(lineData.result);

		// Show the separator as plain text before the MathJax result,
		// matching the visual behaviour of the other renderers.
		resultElement.createEl('span', {
			cls: 'numerals-result-separator',
			text: context.settings.resultSeparator,
		});

		const resultTexElement = resultElement.createEl('span', { cls: 'numerals-tex' });
		void mathjaxLoop(resultTexElement, resultLatex);
	}
}
