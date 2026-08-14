CREATE POLICY "Anyone can read campus maps"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'campus-maps');

CREATE POLICY "Admins can upload campus maps"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'campus-maps' AND (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid())));

CREATE POLICY "Admins can update campus maps"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'campus-maps' AND (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid())));

CREATE POLICY "Admins can delete campus maps"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'campus-maps' AND (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid())));