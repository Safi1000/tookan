-- RPC function to get daily COD totals for a specific driver
-- This function aggregates COD amounts by date for completed deliveries

CREATE OR REPLACE FUNCTION get_driver_daily_cod(
  p_fleet_id INTEGER,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
)
RETURNS TABLE (
  date DATE,
  cod_received NUMERIC,
  order_count INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    DATE(t.creation_datetime) as date,
    COALESCE(SUM(t.cod_amount), 0)::NUMERIC as cod_received,
    COUNT(*)::INTEGER as order_count
  FROM tasks t
  WHERE t.fleet_id = p_fleet_id
    AND t.status = 2  -- Completed deliveries only
    AND t.pickup_address IS DISTINCT FROM t.delivery_address  -- Real deliveries only
    AND t.cod_amount IS NOT NULL
    AND t.cod_amount > 0
    AND (p_date_from IS NULL OR DATE(t.creation_datetime) >= p_date_from)
    AND (p_date_to IS NULL OR DATE(t.creation_datetime) <= p_date_to)
  GROUP BY DATE(t.creation_datetime)
  ORDER BY DATE(t.creation_datetime);
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_driver_daily_cod(INTEGER, DATE, DATE) TO anon;
GRANT EXECUTE ON FUNCTION get_driver_daily_cod(INTEGER, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_driver_daily_cod(INTEGER, DATE, DATE) TO service_role;

-- Example usage:
-- SELECT * FROM get_driver_daily_cod(12345, '2025-01-01', '2025-01-31');
-- SELECT * FROM get_driver_daily_cod(12345);  -- All dates
