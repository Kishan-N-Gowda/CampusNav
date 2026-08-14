import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Read Vite / Vercel environment variables directly from import.meta.env
const rawSupabaseUrl =
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL
    ? String(import.meta.env.VITE_SUPABASE_URL).trim()
    : typeof process !== 'undefined' && process.env?.VITE_SUPABASE_URL
    ? String(process.env.VITE_SUPABASE_URL).trim()
    : '';

const rawSupabaseKey =
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY
    ? String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY).trim()
    : typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY
    ? String(import.meta.env.VITE_SUPABASE_ANON_KEY).trim()
    : typeof process !== 'undefined' && process.env?.VITE_SUPABASE_PUBLISHABLE_KEY
    ? String(process.env.VITE_SUPABASE_PUBLISHABLE_KEY).trim()
    : typeof process !== 'undefined' && process.env?.VITE_SUPABASE_ANON_KEY
    ? String(process.env.VITE_SUPABASE_ANON_KEY).trim()
    : '';

export const DEFAULT_SUPABASE_URL = 'https://zqrkpfavuqnvwbqxwacc.supabase.co';

export const isSupabaseConfigured = Boolean(
  rawSupabaseKey && rawSupabaseKey.length > 10 && !rawSupabaseKey.includes('placeholder')
);

// Masked key for diagnostic screen display (e.g. eyJhbGciOi...1234)
const getMaskedKey = (key: string) => {
  if (!key) return '';
  if (key.length <= 12) return '********';
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
};

export const supabaseConfigStatus = {
  hasUrl: Boolean(rawSupabaseUrl || DEFAULT_SUPABASE_URL),
  hasKey: isSupabaseConfigured,
  isConfigured: isSupabaseConfigured,
  url: rawSupabaseUrl || DEFAULT_SUPABASE_URL,
  maskedKey: isSupabaseConfigured ? getMaskedKey(rawSupabaseKey) : '',
};

export const SUPABASE_URL = rawSupabaseUrl || DEFAULT_SUPABASE_URL;

// If real publishable key is present, use it.
// If missing, use a safe non-empty string solely to prevent createClient from crashing
// the JavaScript bundle before React can mount the diagnostic error screen.
const SAFE_EMPTY_FALLBACK_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxcmtwZmF2dXFudndicXh3YWNjIiwicm9sZSI6ImFub24ifQ.unconfigured_missing_key';

export const SUPABASE_PUBLISHABLE_KEY = isSupabaseConfigured
  ? rawSupabaseKey
  : SAFE_EMPTY_FALLBACK_KEY;

if (!isSupabaseConfigured) {
  console.error(
    '[Supabase Configuration Error] VITE_SUPABASE_PUBLISHABLE_KEY is not configured in Vercel environment variables. The application requires this variable to connect to the database.'
  );
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof localStorage !== 'undefined' ? localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  },
});

