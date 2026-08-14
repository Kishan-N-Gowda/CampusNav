ALTER TABLE public.locations REPLICA IDENTITY FULL;
ALTER TABLE public.paths REPLICA IDENTITY FULL;
ALTER TABLE public.app_settings REPLICA IDENTITY FULL;
ALTER TABLE public.tts_settings REPLICA IDENTITY FULL;
ALTER TABLE public.user_roles REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.locations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.paths;
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tts_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_roles;