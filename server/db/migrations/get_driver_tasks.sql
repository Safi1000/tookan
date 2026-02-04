-- Drop existing function if it exists
DROP FUNCTION IF EXISTS get_driver_tasks(BIGINT, TIMESTAMP, TIMESTAMP);
DROP FUNCTION IF EXISTS get_driver_tasks(INTEGER, TIMESTAMP, TIMESTAMP);

-- Create function to fetch driver tasks with SECURITY DEFINER to bypass RLS
-- Updated: Now includes paid, balance, and cod_collected for task-level payment tracking
CREATE OR REPLACE FUNCTION get_driver_tasks(
  p_fleet_id BIGINT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE (
  job_id BIGINT,
  fleet_id BIGINT,
  fleet_name TEXT,
  customer_name TEXT,
  cod_amount NUMERIC,
  paid NUMERIC,
  balance NUMERIC,
  cod_collected BOOLEAN,
  pickup_address TEXT,
  delivery_address TEXT,
  creation_datetime TIMESTAMP 
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.job_id::BIGINT,
    t.fleet_id::BIGINT,
    t.fleet_name::TEXT,
    t.customer_name::TEXT,
    COALESCE(t.cod_amount::NUMERIC, 0) as cod_amount,
    COALESCE(t.paid::NUMERIC, 0) as paid,
    COALESCE(t.balance::NUMERIC, 0) as balance,
    COALESCE(t.cod_collected::BOOLEAN, false) as cod_collected,
    t.pickup_address::TEXT,
    t.delivery_address::TEXT,
    t.creation_datetime::TIMESTAMP
  FROM tasks t
  WHERE t.fleet_id = p_fleet_id
    AND t.status = 2 -- Completed
    AND t.creation_datetime >= p_date_from
    AND t.creation_datetime <= p_date_to
    AND t.pickup_address IS DISTINCT FROM t.delivery_address
    AND t.cod_amount IS NOT NULL
    AND t.cod_amount > 0;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_driver_tasks(BIGINT, TIMESTAMP, TIMESTAMP) TO anon;
GRANT EXECUTE ON FUNCTION get_driver_tasks(BIGINT, TIMESTAMP, TIMESTAMP) TO authenticated;
GRANT EXECUTE ON FUNCTION get_driver_tasks(BIGINT, TIMESTAMP, TIMESTAMP) TO service_role;
