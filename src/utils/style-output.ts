/**
 * Shared style-output helpers for command text rendering.
 */

import { fmt } from './theme';

export const MISSING_VALUE = '—';
export const TRUNCATION_SUFFIX = '…';
export const CANONICAL_EMPTY_STATE = 'No results found.';

export type TableColumn = {
  header: string;
  width: number;
  align?: 'left' | 'right';
};

function padValue(
  value: string,
  width: number,
  align: 'left' | 'right' = 'left'
): string {
  if (align === 'right') {
    return value.padStart(width);
  }
  return value.padEnd(width);
}

export function truncateWithEllipsis(value: string, maxLength: number): string {
  if (maxLength <= 0) {
    return '';
  }

  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength === 1) {
    return TRUNCATION_SUFFIX;
  }

  return `${value.slice(0, maxLength - 1)}${TRUNCATION_SUFFIX}`;
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return MISSING_VALUE;
  }

  const stringValue = String(value).trim();
  return stringValue.length > 0 ? stringValue : MISSING_VALUE;
}

export function buildFiltersEcho(
  filters: Array<[string, string | number | boolean | undefined]>
): string | undefined {
  const entries = filters
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`);

  if (entries.length === 0) {
    return undefined;
  }

  return entries.join(', ');
}

export function formatAsOfEst(now: Date = new Date()): string {
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return `${timeFormatter.format(now)} | ${dateFormatter.format(now)}`;
}

export function formatDateOnly(value: string): string {
  if (!value) {
    return MISSING_VALUE;
  }

  const [date] = value.split('T');
  return date || MISSING_VALUE;
}

export function formatHeaderBlock(input: {
  title: string;
  summary: string;
  filters?: string;
  includeFreshness?: boolean;
  now?: Date;
}): string[] {
  const lines: string[] = [];

  lines.push(`  ${fmt.primary(input.title)}`);
  lines.push(`  ${fmt.dim(input.summary)}`);

  if (input.filters) {
    lines.push(`  ${fmt.dim(`Filters: ${input.filters}`)}`);
  }

  if (input.includeFreshness) {
    lines.push(`  ${fmt.dim(`As of (EST): ${formatAsOfEst(input.now)}`)}`);
  }

  lines.push('');

  return lines;
}

export function formatAlignedTable(
  columns: TableColumn[],
  rows: string[][],
  emptyWithDashRow: boolean = true,
  dividerChar: string = '-'
): string {
  const safeRows =
    rows.length === 0 && emptyWithDashRow
      ? [Array.from({ length: columns.length }, () => MISSING_VALUE)]
      : rows;

  const header = columns
    .map((column) => padValue(column.header, column.width, column.align))
    .join('  ');

  const dividerGlyph = dividerChar.length > 0 ? dividerChar[0] : '-';
  const divider = columns
    .map((column) => dividerGlyph.repeat(column.width))
    .join('  ');

  const body = safeRows.map((row) =>
    row
      .map((value, index) => {
        const column = columns[index];
        const normalized = truncateWithEllipsis(
          displayValue(value),
          column.width
        );
        return padValue(normalized, column.width, column.align);
      })
      .join('  ')
  );

  return [header, divider, ...body].join('\n');
}
