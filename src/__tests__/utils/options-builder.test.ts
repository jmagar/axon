import { describe, expect, it } from 'vitest';
import { OptionsBuilder } from '../../utils/options-builder';

describe('OptionsBuilder', () => {
  it('should add simple properties', () => {
    const result = new OptionsBuilder<{ limit: number }>()
      .add('limit', 10)
      .build();
    expect(result).toEqual({ limit: 10 });
  });

  it('should skip undefined values', () => {
    const result = new OptionsBuilder<{ limit?: number }>()
      .add('limit', undefined)
      .build();
    expect(result).toEqual({});
  });

  it('should map field names', () => {
    const result = new OptionsBuilder<{ maxDiscoveryDepth: number }>()
      .addMapped('maxDiscoveryDepth', 5)
      .build();
    expect(result).toEqual({ maxDiscoveryDepth: 5 });
  });

  it('should skip undefined mapped values', () => {
    const result = new OptionsBuilder<{ maxDiscoveryDepth?: number }>()
      .addMapped('maxDiscoveryDepth', undefined)
      .build();
    expect(result).toEqual({});
  });

  it('should handle nested properties', () => {
    const result = new OptionsBuilder<{ scrapeOptions: { timeout: number } }>()
      .addNested('scrapeTimeout', 'scrapeOptions.timeout', 15000)
      .build();
    expect(result).toEqual({ scrapeOptions: { timeout: 15000 } });
  });

  it('should skip undefined nested values', () => {
    const result = new OptionsBuilder<{
      scrapeOptions?: { timeout?: number };
    }>()
      .addNested('scrapeTimeout', 'scrapeOptions.timeout', undefined)
      .build();
    expect(result).toEqual({});
  });

  it('should handle multi-level nested properties', () => {
    const result = new OptionsBuilder<{
      crawl: { scrape: { options: { timeout: number } } };
    }>()
      .addNested('timeout', 'crawl.scrape.options.timeout', 10000)
      .build();
    expect(result).toEqual({
      crawl: { scrape: { options: { timeout: 10000 } } },
    });
  });

  it('should chain multiple operations', () => {
    type ComplexOptions = {
      limit: number;
      maxDiscoveryDepth: number;
      scrapeOptions: { timeout: number };
    };

    const result = new OptionsBuilder<ComplexOptions>()
      .add('limit', 100)
      .addMapped('maxDiscoveryDepth', 3)
      .addNested('scrapeTimeout', 'scrapeOptions.timeout', 10000)
      .build();

    expect(result).toEqual({
      limit: 100,
      maxDiscoveryDepth: 3,
      scrapeOptions: { timeout: 10000 },
    });
  });

  it('should handle mixed defined and undefined values', () => {
    type MixedOptions = {
      limit?: number;
      maxDiscoveryDepth?: number;
      delay: number;
    };

    const result = new OptionsBuilder<MixedOptions>()
      .add('limit', undefined)
      .addMapped('maxDiscoveryDepth', 5)
      .add('delay', 1000)
      .build();

    expect(result).toEqual({
      maxDiscoveryDepth: 5,
      delay: 1000,
    });
  });

  it('should merge into existing nested objects', () => {
    type NestedOptions = {
      scrapeOptions: { timeout: number; waitTime?: number };
    };

    const result = new OptionsBuilder<NestedOptions>()
      .addNested('timeout', 'scrapeOptions.timeout', 15000)
      .addNested('waitTime', 'scrapeOptions.waitTime', 2000)
      .build();

    expect(result).toEqual({
      scrapeOptions: {
        timeout: 15000,
        waitTime: 2000,
      },
    });
  });

  it('should handle empty builder', () => {
    const result = new OptionsBuilder<Record<string, never>>().build();
    expect(result).toEqual({});
  });

  it('should preserve false and 0 values', () => {
    type BoolOptions = {
      enabled: boolean;
      count: number;
      name?: string;
    };

    const result = new OptionsBuilder<BoolOptions>()
      .add('enabled', false)
      .add('count', 0)
      .add('name', undefined)
      .build();

    expect(result).toEqual({
      enabled: false,
      count: 0,
    });
  });

  it('should reject invalid nested paths', () => {
    expect(() => {
      new OptionsBuilder().addNested('test', '', 'value').build();
    }).toThrow('Nested path cannot be empty');

    expect(() => {
      new OptionsBuilder().addNested('test', 'a..b', 'value').build();
    }).toThrow('Invalid nested path: "a..b"');

    expect(() => {
      new OptionsBuilder().addNested('test', 'a.', 'value').build();
    }).toThrow('Invalid nested path: "a."');

    expect(() => {
      new OptionsBuilder().addNested('test', '.a', 'value').build();
    }).toThrow('Invalid nested path: ".a"');
  });

  it('should handle very deep nesting', () => {
    type DeepOptions = {
      a: { b: { c: { d: { e: { f: { g: string } } } } } };
    };

    const result = new OptionsBuilder<DeepOptions>()
      .addNested('deep', 'a.b.c.d.e.f.g', 'value')
      .build();

    expect(result.a?.b?.c?.d?.e?.f?.g).toBe('value');
  });
});
