// Super-admin-only endpoint to add or remove admin role by email.
// CORS-friendly. Validates JWT and that the caller is a super_admin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  action: "list" | "add" | "remove" | "add-super-admin";
  email?: string;
  role?: "admin" | "super_admin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return new Response(JSON.stringify({ error: "Missing auth" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verify caller
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData.user) {
    return new Response(JSON.stringify({ error: "Invalid auth" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // Confirm caller is super_admin
  const { data: roleRows } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id);
  const isSuper = (roleRows ?? []).some((r: any) => r.role === "super_admin");
  if (!isSuper) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (body.action === "list") {
    const { data: rows, error } = await admin
      .from("user_roles")
      .select("user_id, role");
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.user_id)));
    const result: Array<{ user_id: string; email: string; role: string }> = [];
    for (const id of ids) {
      const { data: u } = await admin.auth.admin.getUserById(id);
      const email = u?.user?.email ?? "(unknown)";
      for (const r of rows!.filter((x: any) => x.user_id === id)) {
        result.push({ user_id: id, email, role: (r as any).role });
      }
    }
    return new Response(JSON.stringify({ users: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email) {
    return new Response(JSON.stringify({ error: "Email required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Find target user by email (service role)
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) {
    return new Response(JSON.stringify({ error: listErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const target = list.users.find((u) => u.email?.toLowerCase() === email);
  if (!target) {
    return new Response(JSON.stringify({ error: "No user with that email" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (body.action === "add") {
    // Check existing
    const { data: existing } = await admin
      .from("user_roles")
      .select("id")
      .eq("user_id", target.id)
      .eq("role", "admin")
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ ok: true, message: "Already admin" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { error: insErr } = await admin
      .from("user_roles")
      .insert({ user_id: target.id, role: "admin" });
    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (body.action === "add-super-admin") {
    // Check existing super_admin role
    const { data: existing } = await admin
      .from("user_roles")
      .select("id")
      .eq("user_id", target.id)
      .eq("role", "super_admin")
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ ok: true, message: "Already super_admin" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { error: insErr } = await admin
      .from("user_roles")
      .insert({ user_id: target.id, role: "super_admin" });
    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (body.action === "remove") {
    // Trigger blocks deletion of super_admin rows; only delete admin role rows.
    const { error: delErr } = await admin
      .from("user_roles")
      .delete()
      .eq("user_id", target.id)
      .eq("role", "admin");
    if (delErr) {
      return new Response(JSON.stringify({ error: delErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Unknown action" }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
