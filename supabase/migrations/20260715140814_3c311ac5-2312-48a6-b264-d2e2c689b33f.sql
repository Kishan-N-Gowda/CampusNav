CREATE TABLE public.tts_settings (
  lang text PRIMARY KEY,
  provider text NOT NULL DEFAULT 'lovable',
  voice_id text NOT NULL DEFAULT 'onyx',
  model text,
  rate numeric NOT NULL DEFAULT 0.9,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tts_settings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.tts_settings TO authenticated;
GRANT ALL ON public.tts_settings TO service_role;
ALTER TABLE public.tts_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view tts settings" ON public.tts_settings FOR SELECT USING (true);
CREATE POLICY "Admins can insert tts settings" ON public.tts_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update tts settings" ON public.tts_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete tts settings" ON public.tts_settings FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER tts_settings_updated_at BEFORE UPDATE ON public.tts_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
INSERT INTO public.tts_settings (lang, provider, voice_id, model, rate) VALUES
  ('en', 'lovable', 'onyx', 'openai/gpt-4o-mini-tts', 0.9),
  ('kn', 'lovable', 'onyx', 'openai/gpt-4o-mini-tts', 0.9);