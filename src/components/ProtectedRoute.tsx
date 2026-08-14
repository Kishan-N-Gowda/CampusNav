import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export function ProtectedRoute({ children, requireAdmin = true }: { children: React.ReactNode; requireAdmin?: boolean }) {
  const { session, isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!session) return <Navigate to="/auth" replace />;
  if (requireAdmin && !isAdmin) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
        <h1 className="font-display text-2xl font-bold">Not authorised</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account is signed in but doesn't have admin access. Ask an existing admin
          to grant the role, or contact support.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
