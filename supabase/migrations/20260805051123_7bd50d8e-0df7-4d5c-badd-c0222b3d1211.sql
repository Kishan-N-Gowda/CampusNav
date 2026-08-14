DROP POLICY IF EXISTS "Super admins can insert app settings" ON public.app_settings;
DROP POLICY IF EXISTS "Super admins can update app settings" ON public.app_settings;

CREATE POLICY "Super admins can insert app settings"
ON public.app_settings FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (key IN ('campus_map', 'gps_anchors') AND public.has_role(auth.uid(), 'admin'::app_role))
);

CREATE POLICY "Super admins can update app settings"
ON public.app_settings FOR UPDATE TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (key IN ('campus_map', 'gps_anchors') AND public.has_role(auth.uid(), 'admin'::app_role))
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (key IN ('campus_map', 'gps_anchors') AND public.has_role(auth.uid(), 'admin'::app_role))
);