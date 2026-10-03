CREATE OR REPLACE FUNCTION public.get_booked_slot_ids()
RETURNS TABLE(slot_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT slot_id FROM bookings WHERE status = 'confirmed';
$$;
REVOKE EXECUTE ON FUNCTION public.get_booked_slot_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_booked_slot_ids() TO authenticated, service_role;