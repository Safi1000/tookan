-- Drop existing function if it exists
DROP FUNCTION IF EXISTS get_driver_tasks;

-- Create function to fetch driver tasks with SECURITY DEFINER to bypass RLS
CREATE OR REPLACE FUNCTION get_driver_tasks(
  p_fleet_id INTEGER,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE (
  job_id BIGINT,
  fleet_id INTEGER,
  fleet_name TEXT,
  customer_name TEXT,
  cod_amount NUMERIC,
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
    t.job_id,
    t.fleet_id,
    t.fleet_name,
    t.customer_name,
    -- Handle cod_amount casting safely if it's stored as text
    CASE 
      WHEN typeof(t.cod_amount) = 'character varying' OR typeof(t.cod_amount) = 'text' 
      THEN CASe WHEN t.cod_amount ~ '^[0-9\.]+$' THEN CAST(t.cod_amount AS NUMERIC) ELSE 0 END
      ELSE CAST(t.cod_amount AS NUMERIC)
    END as cod_amount,
    t.pickup_address,
    t.delivery_address,
    t.creation_datetime
  FROM tasks t
  WHERE t.fleet_id = p_fleet_id
    AND t.status = 2 -- Completed
    AND t.creation_datetime >= p_date_from
    AND t.creation_datetime <= p_date_to;
END;
$$;
