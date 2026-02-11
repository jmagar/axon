/**
 * Test helper utilities for common assertions
 *
 * Provides reusable assertion patterns to reduce duplication across test files
 */

import type { Mock } from 'vitest';
import { expect } from 'vitest';

/**
 * Success result type for command execution
 */
export interface SuccessResult<T = unknown> {
  success: true;
  data: T;
}

/**
 * Error result type for command execution
 */
export interface ErrorResult {
  success: false;
  error: string;
}

/**
 * Result type for command execution (success or error)
 */
export type Result<T = unknown> = SuccessResult<T> | ErrorResult;

/**
 * Assert that a result is successful
 *
 * @param result - The result to check
 * @throws If result is not successful
 */
export function expectSuccessResult<T>(
  result: Result<T> | { success: boolean; data?: T; error?: string }
): asserts result is SuccessResult<T> {
  expect(result.success).toBe(true);
  expect(result).toHaveProperty('data');
}

/**
 * Assert that a result is an error
 *
 * @param result - The result to check
 * @param expectedError - Optional expected error message substring
 * @throws If result is not an error
 */
export function expectErrorResult(
  result: Result | { success: boolean; data?: unknown; error?: string },
  expectedError?: string
): asserts result is ErrorResult {
  expect(result.success).toBe(false);
  expect(result).toHaveProperty('error');
  if (expectedError) {
    expect((result as ErrorResult).error).toContain(expectedError);
  }
}

/**
 * Assert that a mock was called once with a first argument and optional second argument
 *
 * @param mockFn - The mock function to check
 * @param expectedFirst - Expected first argument (URL, query, etc.)
 * @param expectedOptions - Expected options object (second argument)
 */
function expectCalledWithFirstArgAndOptions(
  mockFn: Mock,
  expectedFirst: string,
  expectedOptions?: Record<string, unknown>
) {
  expect(mockFn).toHaveBeenCalledTimes(1);
  if (expectedOptions) {
    expect(mockFn).toHaveBeenCalledWith(expectedFirst, expectedOptions);
  } else {
    expect(mockFn).toHaveBeenCalledWith(expectedFirst);
  }
}

/**
 * Assert that a mock was called with expected URL and options
 *
 * @param mockFn - The mock function to check
 * @param expectedUrl - Expected URL
 * @param expectedOptions - Expected options object
 */
export function expectCalledWithUrlAndOptions(
  mockFn: Mock,
  expectedUrl: string,
  expectedOptions?: Record<string, unknown>
) {
  expectCalledWithFirstArgAndOptions(mockFn, expectedUrl, expectedOptions);
}

/**
 * Assert that a mock was called with expected query and options
 *
 * @param mockFn - The mock function to check
 * @param expectedQuery - Expected query string
 * @param expectedOptions - Expected options object
 */
export function expectCalledWithQueryAndOptions(
  mockFn: Mock,
  expectedQuery: string,
  expectedOptions?: Record<string, unknown>
) {
  expectCalledWithFirstArgAndOptions(mockFn, expectedQuery, expectedOptions);
}

/**
 * Assert that a mock was called with expected options only
 *
 * @param mockFn - The mock function to check
 * @param expectedOptions - Expected options object
 */
export function expectCalledWithOptions(
  mockFn: Mock,
  expectedOptions: Record<string, unknown>
) {
  expect(mockFn).toHaveBeenCalledTimes(1);
  expect(mockFn).toHaveBeenCalledWith(expectedOptions);
}

/**
 * Assert that a mock was called with options containing specific properties
 *
 * @param mockFn - The mock function to check
 * @param expectedUrl - Expected URL (first argument)
 * @param expectedProperties - Expected properties in options object
 */
export function expectCalledWithContaining(
  mockFn: Mock,
  expectedUrl: string,
  expectedProperties: Record<string, unknown>
) {
  expect(mockFn).toHaveBeenCalledTimes(1);
  expect(mockFn).toHaveBeenCalledWith(
    expectedUrl,
    expect.objectContaining(expectedProperties)
  );
}

/**
 * Assert that a result has expected data properties
 *
 * @param result - The result to check
 * @param expectedProperties - Expected properties in the data object
 */
export function expectResultData<T>(
  result: SuccessResult<T>,
  expectedProperties: Partial<T>
) {
  expect(result.success).toBe(true);
  expect(result.data).toMatchObject(expectedProperties);
}

/**
 * Assert that an array result has expected length and all items match predicate
 *
 * @param result - The result containing an array
 * @param expectedLength - Expected array length
 * @param predicate - Optional function to test each item
 */
export function expectArrayResult<T>(
  result: SuccessResult<T[]>,
  expectedLength: number,
  predicate?: (item: T) => boolean
) {
  expectSuccessResult(result);
  expect(result.data).toHaveLength(expectedLength);
  if (predicate) {
    expect(result.data.every(predicate)).toBe(true);
  }
}

/**
 * Assert that a mock fetch was called with expected URL and method
 *
 * @param mockFetch - The mock fetch function
 * @param expectedUrl - Expected URL
 * @param expectedMethod - Expected HTTP method
 */
export function expectFetchCalled(
  mockFetch: Mock,
  expectedUrl: string,
  expectedMethod = 'POST'
) {
  expect(mockFetch).toHaveBeenCalledWith(
    expectedUrl,
    expect.objectContaining({
      method: expectedMethod,
    })
  );
}

/**
 * Assert that a mock was never called
 *
 * @param mockFn - The mock function to check
 */
export function expectNotCalled(mockFn: Mock) {
  expect(mockFn).not.toHaveBeenCalled();
}

/**
 * Assert that a mock was called exactly N times
 *
 * @param mockFn - The mock function to check
 * @param times - Expected number of calls
 */
export function expectCalledTimes(mockFn: Mock, times: number) {
  expect(mockFn).toHaveBeenCalledTimes(times);
}

/**
 * Assert that a value is defined and not null
 *
 * @param value - The value to check
 */
export function expectDefined<T>(
  value: T | null | undefined
): asserts value is T {
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
}

/**
 * Assert that an object has specific properties with expected values
 *
 * @param obj - The object to check
 * @param properties - Expected property name-value pairs
 */
export function expectProperties<T extends Record<string, unknown>>(
  obj: T,
  properties: Partial<T>
) {
  for (const [key, value] of Object.entries(properties)) {
    expect(obj).toHaveProperty(key);
    expect(obj[key]).toEqual(value);
  }
}
