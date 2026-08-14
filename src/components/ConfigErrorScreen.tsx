import React, { useState } from "react";
import {
  AlertTriangle,
  KeyRound,
  Database,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabaseConfigStatus } from "@/integrations/supabase/client";

interface ConfigErrorScreenProps {
  onDismiss?: () => void;
  isDismissable?: boolean;
}

export const ConfigErrorScreen: React.FC<ConfigErrorScreenProps> = ({
  onDismiss,
  isDismissable = true,
}) => {
  const [copied, setCopied] = useState(false);
  const status = supabaseConfigStatus;

  const copyTemplate = () => {
    const text = `VITE_SUPABASE_URL=${status.url || "https://zqrkpfavuqnvwbqxwacc.supabase.co"}\nVITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_publishable_key_here`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div
      id="supabase-config-error-screen"
      className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-4 sm:p-6"
    >
      <div className="w-full max-w-2xl rounded-3xl border border-destructive/30 bg-card p-6 sm:p-8 shadow-xl">
        {/* Header Badge & Title */}
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-destructive/10 text-destructive border border-destructive/20">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold text-destructive">
              Runtime Configuration Missing
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              Supabase Environment Variables Required
            </h1>
            <p className="text-sm text-muted-foreground">
              The application could not establish a connection to your Supabase project because the required Vercel environment variables are missing at runtime.
            </p>
          </div>
        </div>

        {/* Variables Diagnostic Table */}
        <div className="mt-6 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Variable Status
          </h2>
          <div className="divide-y divide-border rounded-2xl border border-border bg-muted/40 overflow-hidden">
            {/* VITE_SUPABASE_URL */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <code className="text-xs font-mono font-bold text-foreground">
                    VITE_SUPABASE_URL
                  </code>
                </div>
                <div className="text-xs text-muted-foreground pl-6">
                  {status.hasUrl
                    ? `Configured: ${status.url}`
                    : "Expected: https://zqrkpfavuqnvwbqxwacc.supabase.co"}
                </div>
              </div>
              <div className="sm:self-center pl-6 sm:pl-0">
                {status.hasUrl ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Present
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive bg-destructive/10 px-2.5 py-1 rounded-full border border-destructive/20">
                    <XCircle className="h-3.5 w-3.5" /> Missing
                  </span>
                )}
              </div>
            </div>

            {/* VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  <code className="text-xs font-mono font-bold text-foreground">
                    {status.hasKey ? status.keyVarName : "VITE_SUPABASE_ANON_KEY / VITE_SUPABASE_PUBLISHABLE_KEY"}
                  </code>
                </div>
                <div className="text-xs text-muted-foreground pl-6">
                  {status.hasKey
                    ? `Configured via ${status.keyVarName}: ${status.maskedKey}`
                    : "Expected: VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY)"}
                </div>
              </div>
              <div className="sm:self-center pl-6 sm:pl-0">
                {status.hasKey ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Present ({status.keyVarName})
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive bg-destructive/10 px-2.5 py-1 rounded-full border border-destructive/20">
                    <XCircle className="h-3.5 w-3.5" /> Missing
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* How to Fix on Vercel */}
        <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <ExternalLink className="h-4 w-4" />
            How to configure in Vercel:
          </div>
          <ol className="space-y-2 text-xs text-muted-foreground list-decimal list-inside leading-relaxed">
            <li>
              Open your project on{" "}
              <a
                href="https://vercel.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline font-medium hover:text-primary/80"
              >
                Vercel Dashboard
              </a>
            </li>
            <li>
              Go to <strong>Settings</strong> → <strong>Environment Variables</strong>
            </li>
            <li>
              Add <code>VITE_SUPABASE_URL</code> and{" "}
              <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> for Production & Preview
            </li>
            <li>
              <strong>Redeploy</strong> your project so Vite embeds the new variables at build time
            </li>
          </ol>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copyTemplate}
            className="gap-2 text-xs"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 text-emerald-500" />
                Copied .env Template
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copy Variables Template
              </>
            )}
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
              className="gap-2 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Recheck & Refresh
            </Button>

            {isDismissable && onDismiss && (
              <Button
                type="button"
                size="sm"
                onClick={onDismiss}
                className="gap-1.5 text-xs bg-foreground text-background hover:bg-foreground/90"
              >
                Continue in Demo Mode
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
