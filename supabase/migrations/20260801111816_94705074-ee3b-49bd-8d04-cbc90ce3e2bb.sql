CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view app settings"
  ON public.app_settings FOR SELECT USING (true);

CREATE POLICY "Super admins can insert app settings"
  ON public.app_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()) OR (key = 'campus_map' AND public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Super admins can update app settings"
  ON public.app_settings FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR (key = 'campus_map' AND public.has_role(auth.uid(), 'admin')))
  WITH CHECK (public.is_super_admin(auth.uid()) OR (key = 'campus_map' AND public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Super admins can delete app settings"
  ON public.app_settings FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE TRIGGER app_settings_set_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.app_settings (key, value) VALUES
  ('quick_access', '{"count": 4, "location_ids": []}'::jsonb),
  ('campus_map', '{"url": null}'::jsonb);