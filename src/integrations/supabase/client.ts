import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Default existing Supabase project URL
export const DEFAULT_SUPABASE_URL = 'https://zqrkpfavuqnvwbqxwacc.supabase.co';

// Helper to inspect environment variables from import.meta.env or process.env
const getEnvVar = (name: string): string | undefined => {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const val = import.meta.env[name];
    if (val && typeof val === 'string' && val.trim() !== '') return val.trim();
  }
  if (typeof process !== 'undefined' && process.env) {
    const val = process.env[name];
    if (val && typeof val === 'string' && val.trim() !== '') return val.trim();
  }
  return undefined;
};

// Supported Supabase Key variable names in Vercel, Vite, and integrations
const KEY_CANDIDATE_NAMES = [
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_KEY',
  'VITE_SUPABASE_API_KEY',
  'VITE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_KEY',
  'REACT_APP_SUPABASE_ANON_KEY',
  'REACT_APP_SUPABASE_PUBLISHABLE_KEY',
  'REACT_APP_SUPABASE_KEY',
] as const;

// Supported Supabase URL variable names
const URL_CANDIDATE_NAMES = [
  'VITE_SUPABASE_URL',
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'REACT_APP_SUPABASE_URL',
] as const;

let resolvedUrl = DEFAULT_SUPABASE_URL;
let resolvedUrlVarName = 'DEFAULT_PROJECT_URL';
for (const name of URL_CANDIDATE_NAMES) {
  const val = getEnvVar(name);
  if (val) {
    resolvedUrl = val;
    resolvedUrlVarName = name;
    break;
  }
}

let resolvedKey = '';
let resolvedKeyVarName = '';
for (const name of KEY_CANDIDATE_NAMES) {
  const val = getEnvVar(name);
  if (val && val.length > 10 && !val.includes('placeholder') && !val.includes('unconfigured')) {
    resolvedKey = val;
    resolvedKeyVarName = name;
    break;
  }
}

export const isSupabaseConfigured = Boolean(resolvedKey.length > 0);

// Masked key for diagnostic screen display
const getMaskedKey = (key: string) => {
  if (!key) return '';
  if (key.length <= 12) return '********';
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
};

export const supabaseConfigStatus = {
  hasUrl: Boolean(resolvedUrl),
  hasKey: isSupabaseConfigured,
  isConfigured: isSupabaseConfigured,
  url: resolvedUrl,
  urlVarName: resolvedUrlVarName,
  keyVarName: resolvedKeyVarName || 'VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY',
  maskedKey: isSupabaseConfigured ? getMaskedKey(resolvedKey) : '',
};

export const SUPABASE_URL = resolvedUrl;

// Safe JWT fallback solely used to prevent createClient from crashing initial bundle evaluation
// before React can render the diagnostic configuration screen.
const SAFE_EMPTY_FALLBACK_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxcmtwZmF2dXFudndicXh3YWNjIiwicm9sZSI6ImFub24ifQ.unconfigured_missing_key';

export const SUPABASE_PUBLISHABLE_KEY = isSupabaseConfigured
  ? resolvedKey
  : SAFE_EMPTY_FALLBACK_KEY;

if (isSupabaseConfigured) {
  console.info(`[Supabase] Successfully initialized using environment variable: ${resolvedKeyVarName}`);
} else {
  console.error(
    `[Supabase Configuration Error] No Supabase key found in Vercel environment variables. Checked: ${KEY_CANDIDATE_NAMES.join(
      ', '
    )}`
  );
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof localStorage !== 'undefined' ? localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  },
});


