ALTER TABLE public.paths
  ADD COLUMN IF NOT EXISTS points jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.paths.points IS 'Optional intermediate waypoints [{x,y}, ...] between source and destination, in 0-100 coords. Empty array = straight line.';