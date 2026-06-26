import "server-only";
import OpenAI from "openai";

/**
 * Lazy OpenAI singleton. Mirrors the Stripe/rate-limit pattern (build on first
 * use, throw only when actually called) rather than the Prisma pattern (throw
 * at import) so the build and non-AI routes never fail just because the key is
 * absent in an environment that doesn't use AI features.
 */
let client: OpenAI | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — required for AI features.`);
  }
  return value;
}

export function getOpenAI(): OpenAI {
  if (client) return client;
  client = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  return client;
}
