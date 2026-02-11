import { afterEach, describe, expect, it } from 'vitest';
import { hasDoctorDebugBackendConfigured } from '../../commands/doctor-debug';

const ORIGINAL_ENV = { ...process.env };

describe('doctor-debug backend selection', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns false when neither ASK_CLI nor OpenAI fallback is configured', () => {
    delete process.env.ASK_CLI;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    expect(hasDoctorDebugBackendConfigured()).toBe(false);
  });

  it('returns true when ASK_CLI is configured', () => {
    process.env.ASK_CLI = 'gemini-3-flash-preview';
    expect(hasDoctorDebugBackendConfigured()).toBe(true);
  });

  it('returns true when OpenAI fallback is fully configured', () => {
    delete process.env.ASK_CLI;
    process.env.OPENAI_BASE_URL = 'https://example.com/v1';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_MODEL = 'gpt-4o-mini';
    expect(hasDoctorDebugBackendConfigured()).toBe(true);
  });
});
