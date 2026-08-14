import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadRoles = async (uid: string) => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid);
      if (!active) return;
      const roles = new Set((data ?? []).map((r) => r.role));
      const superAdmin = roles.has("super_admin" as any);
      setIsSuperAdmin(superAdmin);
      setIsAdmin(superAdmin || roles.has("admin"));
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!active) return;
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        setTimeout(() => loadRoles(newSession.user!.id), 0);
      } else {
        setIsAdmin(false);
        setIsSuperAdmin(false);
      }
    });

    let roleChannel: ReturnType<typeof supabase.channel> | null = null;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      const uid = data.session?.user?.id;
      if (uid) {
        await loadRoles(uid);
        // Live role changes (e.g. an admin promotes this user) apply without a refresh.
        roleChannel = supabase
          .channel(`user-roles-${uid}-${Math.random().toString(36).slice(2)}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "user_roles", filter: `user_id=eq.${uid}` },
            () => loadRoles(uid)
          )
          .subscribe();
      }
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
      if (roleChannel) supabase.removeChannel(roleChannel);
    };
  }, []);

  return { session, user, isAdmin, isSuperAdmin, loading };
}
