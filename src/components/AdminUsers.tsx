import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface RoleRow {
  user_id: string;
  email: string;
  role: string;
}

/** Super-admin only panel — manage admin users. */
export function AdminUsers() {
  const [users, setUsers] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");

  const call = async (action: "list" | "add" | "remove", payload?: { email?: string }) => {
    const { data, error } = await supabase.functions.invoke("manage-admins", {
      body: { action, ...payload },
    });
    if (error) throw new Error(error.message);
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await call("list");
      setUsers(res.users ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const addAdmin = async () => {
    const e = email.trim();
    if (!e) return toast.error("Enter an email");
    setBusy(true);
    try {
      await call("add", { email: e });
      toast.success(`Granted admin to ${e}`);
      setEmail("");
      await refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeAdmin = async (target: RoleRow) => {
    if (target.role === "super_admin") {
      toast.error("Super admins cannot be removed");
      return;
    }
    if (!window.confirm(`Revoke admin from ${target.email}?`)) return;
    setBusy(true);
    try {
      await call("remove", { email: target.email });
      toast.success(`Removed admin from ${target.email}`);
      await refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Group rows by email so a single user with multiple roles renders once.
  const grouped = Object.values(
    users.reduce<Record<string, { email: string; user_id: string; roles: string[] }>>((acc, r) => {
      const key = r.user_id;
      if (!acc[key]) acc[key] = { email: r.email, user_id: r.user_id, roles: [] };
      acc[key].roles.push(r.role);
      return acc;
    }, {})
  ).filter((u) => u.roles.some((r) => r === "admin" || r === "super_admin"));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" /> Grant admin access
        </h3>
        <p className="text-xs text-muted-foreground">
          The user must already have signed up. Super admin status is reserved and cannot be granted or revoked here.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="admin-email">User email</Label>
            <Input
              id="admin-email"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={addAdmin}
              disabled={busy}
              className="gap-1.5 bg-gradient-primary text-primary-foreground hover:opacity-90"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Add admin
            </Button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </td>
              </tr>
            ) : grouped.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                  No admins yet.
                </td>
              </tr>
            ) : (
              grouped.map((u) => {
                const isSuper = u.roles.includes("super_admin");
                return (
                  <tr key={u.user_id} className="border-t border-border">
                    <td className="px-4 py-2">{u.email}</td>
                    <td className="px-4 py-2">
                      {isSuper ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gradient-primary px-2.5 py-0.5 text-[11px] font-bold text-primary-foreground">
                          <ShieldCheck className="h-3 w-3" /> Super Admin
                        </span>
                      ) : (
                        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                          Admin
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={isSuper || busy}
                        onClick={() =>
                          removeAdmin({ email: u.email, user_id: u.user_id, role: "admin" })
                        }
                        title={isSuper ? "Super admin cannot be removed" : "Revoke admin"}
                        aria-label="Remove admin"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
