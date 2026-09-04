import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught runtime error caught by ErrorBoundary:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleReset = () => {
    try {
      sessionStorage.clear();
    } catch {
      // Ignore
    }
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  private handleHardReload = () => {
    try {
      // Clear transient local session keys that could cause loop crashes
      sessionStorage.clear();
    } catch {
      // Ignore storage errors
    }
    window.location.reload();
  };

  private handleGoHome = () => {
    try {
      sessionStorage.clear();
    } catch {
      // Ignore storage errors
    }
    window.location.href = "/";
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const errorMessage = this.state.error?.message || "An unexpected error occurred.";

      return (
        <div className="min-h-dvh flex items-center justify-center bg-background px-4 py-8 text-foreground">
          <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 sm:p-8 shadow-card text-center animate-float-in">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive shadow-soft">
              <AlertTriangle className="h-7 w-7" />
            </div>

            <h2 className="font-display text-xl sm:text-2xl font-bold text-foreground">
              Something went wrong
            </h2>

            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Campus Navigator ran into a problem while rendering this view. Don&apos;t worry, your data is safe.
            </p>

            <div className="my-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-left">
              <p className="text-xs font-mono text-destructive break-words line-clamp-3">
                {errorMessage}
              </p>
            </div>

            <div className="flex flex-col gap-2.5 pt-2">
              <Button
                type="button"
                onClick={this.handleReset}
                className="w-full gap-2 bg-gradient-primary text-primary-foreground font-semibold shadow-soft hover:opacity-90"
              >
                <RotateCcw className="h-4 w-4" />
                Try Again
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={this.handleHardReload}
                className="w-full gap-2 border-border text-foreground hover:bg-muted"
              >
                <RefreshCw className="h-4 w-4" />
                Reload Application
              </Button>

              {window.location.pathname !== "/" && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={this.handleGoHome}
                  className="w-full gap-2 text-muted-foreground hover:text-foreground"
                >
                  <Home className="h-4 w-4" />
                  Return to Home
                </Button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
