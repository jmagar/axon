import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OptionsBuilder } from '../../utils/options-builder';

describe('OptionsBuilder', () => {
  beforeEach(() => {});

  afterEach(() => {});

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
    const result = new OptionsBuilder<{
      scrapeOptions: { onlyMainContent: boolean };
    }>()
      .addNested('scrapeOptions.onlyMainContent', true)
      .build();
    expect(result).toEqual({ scrapeOptions: { onlyMainContent: true } });
  });

  it('should skip undefined nested values', () => {
    const result = new OptionsBuilder<{
      scrapeOptions?: { onlyMainContent?: boolean };
    }>()
      .addNested('scrapeOptions.onlyMainContent', undefined)
      .build();
    expect(result).toEqual({});
  });

  it('should handle multi-level nested properties', () => {
    const result = new OptionsBuilder<{
      crawl: { scrape: { options: { onlyMainContent: boolean } } };
    }>()
      .addNested('crawl.scrape.options.onlyMainContent', true)
      .build();
    expect(result).toEqual({
      crawl: { scrape: { options: { onlyMainContent: true } } },
    });
  });

  it('should chain multiple operations', () => {
    type ComplexOptions = {
      limit: number;
      maxDiscoveryDepth: number;
      scrapeOptions: { onlyMainContent: boolean };
    };

    const result = new OptionsBuilder<ComplexOptions>()
      .add('limit', 100)
      .addMapped('maxDiscoveryDepth', 3)
      .addNested('scrapeOptions.onlyMainContent', true)
      .build();

    expect(result).toEqual({
      limit: 100,
      maxDiscoveryDepth: 3,
      scrapeOptions: { onlyMainContent: true },
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
      scrapeOptions: { onlyMainContent: boolean; waitTime?: number };
    };

    const result = new OptionsBuilder<NestedOptions>()
      .addNested('scrapeOptions.onlyMainContent', true)
      .addNested('scrapeOptions.waitTime', 2000)
      .build();

    expect(result).toEqual({
      scrapeOptions: {
        onlyMainContent: true,
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
      new OptionsBuilder().addNested('', 'value').build();
    }).toThrow('Nested path cannot be empty');

    expect(() => {
      new OptionsBuilder().addNested('a..b', 'value').build();
    }).toThrow('Invalid nested path: "a..b"');

    expect(() => {
      new OptionsBuilder().addNested('a.', 'value').build();
    }).toThrow('Invalid nested path: "a."');

    expect(() => {
      new OptionsBuilder().addNested('.a', 'value').build();
    }).toThrow('Invalid nested path: ".a"');
  });

  it('should handle very deep nesting', () => {
    type DeepOptions = {
      a: { b: { c: { d: { e: { f: { g: string } } } } } };
    };

    const result = new OptionsBuilder<DeepOptions>()
      .addNested('a.b.c.d.e.f.g', 'value')
      .build();

    expect(result.a?.b?.c?.d?.e?.f?.g).toBe('value');
  });
});
