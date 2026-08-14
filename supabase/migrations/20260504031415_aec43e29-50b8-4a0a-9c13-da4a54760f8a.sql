
-- 1. Paths: add floor / type / to_floor
ALTER TABLE public.paths
  ADD COLUMN IF NOT EXISTS floor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'walk',
  ADD COLUMN IF NOT EXISTS to_floor integer;

ALTER TABLE public.paths
  DROP CONSTRAINT IF EXISTS paths_type_floor_check;
ALTER TABLE public.paths
  ADD CONSTRAINT paths_type_floor_check CHECK (
    (type = 'walk' AND to_floor IS NULL)
    OR (type = 'connector' AND to_floor IS NOT NULL)
  );

-- 2. is_super_admin helper
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'super_admin'
  )
$$;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon, authenticated;

-- 3. First-user-becomes-super-admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO user_count FROM auth.users;
  IF user_count <= 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Protect super_admin rows
CREATE OR REPLACE FUNCTION public.protect_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.role = 'super_admin' THEN
    RAISE EXCEPTION 'Super admin roles cannot be removed';
  ELSIF TG_OP = 'UPDATE' AND OLD.role = 'super_admin' AND NEW.role <> 'super_admin' THEN
    RAISE EXCEPTION 'Super admin role cannot be downgraded';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.protect_super_admin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_super_admin_trigger ON public.user_roles;
CREATE TRIGGER protect_super_admin_trigger
  BEFORE UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_super_admin();

-- 5. Replace admin-manage-roles policy with super-admin-only management
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Super admins can manage roles" ON public.user_roles;
CREATE POLICY "Super admins can manage roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()) AND role <> 'super_admin');
