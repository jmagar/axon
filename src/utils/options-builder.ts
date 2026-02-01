/**
 * Fluent API for building option objects
 *
 * Eliminates repetitive conditional option-building code.
 */

/**
 * Fluent builder for constructing option objects
 *
 * @example
 * ```typescript
 * const options = new OptionsBuilder<FirecrawlOptions>()
 *   .add('limit', 10)
 *   .addMapped('maxDepth', 'maxDiscoveryDepth', 5)
 *   .addNested('scrapeTimeout', 'scrapeOptions.timeout', 15000)
 *   .build();
 * ```
 */
export class OptionsBuilder<T extends Record<string, unknown>> {
  private options: Partial<T> = {};

  /**
   * Add a simple key-value pair if value is defined
   *
   * @param key - Property key
   * @param value - Property value (skipped if undefined)
   * @returns This builder for chaining
   */
  add<K extends keyof T>(key: K, value: T[K] | undefined): this {
    if (value !== undefined) {
      this.options[key] = value;
    }
    return this;
  }

  /**
   * Add a mapped key-value pair (source key → target key)
   *
   * @param targetKey - Target property key
   * @param value - Property value (skipped if undefined)
   * @returns This builder for chaining
   */
  addMapped<K extends keyof T>(targetKey: K, value: T[K] | undefined): this {
    if (value !== undefined) {
      this.options[targetKey] = value as Partial<T>[K];
    }
    return this;
  }

  /**
   * Add a nested property (e.g., 'scrapeOptions.timeout')
   *
   * @param sourceKey - Original key name (for documentation/clarity)
   * @param path - Dot-separated path to nested property
   * @param value - Property value (skipped if undefined)
   * @returns This builder for chaining
   * @throws Error if path is invalid (empty, has empty segments, or contains '..')
   */
  addNested(sourceKey: string, path: string, value: unknown): this {
    if (value === undefined) {
      return this;
    }

    // Validate path is not empty
    if (!path || path.trim() === '') {
      throw new Error('Nested path cannot be empty');
    }

    const keys = path.split('.');

    // Validate path segments
    if (
      keys.length === 0 ||
      keys.some(
        (k) =>
          !k || k === '..' || k === '.' || k.startsWith('.') || k.endsWith('.')
      )
    ) {
      throw new Error(`Invalid nested path: "${path}"`);
    }

    let current: Record<string, unknown> = this.options;

    // Navigate/create nested structure
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!current[key]) {
        current[key] = {};
      } else if (
        typeof current[key] !== 'object' ||
        Array.isArray(current[key])
      ) {
        throw new Error(
          `Cannot create nested path "${path}": "${keys.slice(0, i + 1).join('.')}" is not an object`
        );
      }
      current = current[key] as Record<string, unknown>;
    }

    // Set final value
    const finalKey = keys[keys.length - 1];
    current[finalKey] = value;

    return this;
  }

  /**
   * Build the final options object
   *
   * @returns The constructed options object as Partial<T>
   * @warning Ensure all required properties of T have been added before calling build().
   * The builder does not validate completeness at runtime.
   */
  build(): Partial<T> {
    return this.options;
  }
}
