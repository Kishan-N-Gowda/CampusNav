INSERT INTO public.user_roles (user_id, role)
SELECT id, 'super_admin'::app_role FROM auth.users WHERE lower(email) = 'k.i.s.h.a.n.n.8.0.0.5@gmail.com'
ON CONFLICT DO NOTHING;