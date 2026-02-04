-- RPC function to get driver payment statistics with date filters
-- Returns COD total, paid total, and balance total for a specific driver
-- Balance is calculated as (cod_amount - paid) per task, then summed

DROP FUNCTION IF EXISTS get_driver_payment_stats(BIGINT, TIMESTAMP, TIMESTAMP);

CREATE OR REPLACE FUNCTION get_driver_payment_stats(
  p_fleet_id BIGINT,
  p_date_from TIMESTAMP DEFAULT NULL,
  p_date_to TIMESTAMP DEFAULT NULL
)
RETURNS TABLE (
  fleet_id BIGINT,
  cod_total NUMERIC,
  paid_total NUMERIC,
  balance_total NUMERIC,
  order_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p_fleet_id as fleet_id,
    COALESCE(SUM(t.cod_amount), 0)::NUMERIC as cod_total,
    COALESCE(SUM(t.paid), 0)::NUMERIC as paid_total,
    COALESCE(SUM(t.balance), 0)::NUMERIC as balance_total,
    COUNT(*)::BIGINT as order_count
  FROM tasks t
  WHERE t.fleet_id = p_fleet_id
    AND t.status = 2  -- Completed deliveries only
    AND t.pickup_address IS DISTINCT FROM t.delivery_address  -- Real deliveries only
    AND t.cod_amount IS NOT NULL
    AND t.cod_amount > 0
    AND (p_date_from IS NULL OR t.creation_datetime >= p_date_from)
    AND (p_date_to IS NULL OR t.creation_datetime <= p_date_to);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_driver_payment_stats(BIGINT, TIMESTAMP, TIMESTAMP) TO anon;
GRANT EXECUTE ON FUNCTION get_driver_payment_stats(BIGINT, TIMESTAMP, TIMESTAMP) TO authenticated;
GRANT EXECUTE ON FUNCTION get_driver_payment_stats(BIGINT, TIMESTAMP, TIMESTAMP) TO service_role;

-- Example usage:
-- SELECT * FROM get_driver_payment_stats(2130118, '2025-01-01'::timestamp, '2025-01-31 23:59:59'::timestamp);
-- SELECT * FROM get_driver_payment_stats(2130118);  -- All dates (lifetime)
