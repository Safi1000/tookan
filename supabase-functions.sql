-- =============================================================================
-- Supabase SQL Functions for Customer and Driver Statistics
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- =============================================================================

-- Drop ALL old function versions first to avoid overloading conflicts
DROP FUNCTION IF EXISTS get_customer_statistics(TEXT, INT, TIMESTAMPTZ, TIMESTAMPTZ, INT);
DROP FUNCTION IF EXISTS get_customer_statistics(TEXT, BIGINT, TIMESTAMPTZ, TIMESTAMPTZ, INT);
DROP FUNCTION IF EXISTS get_customer_statistics(TEXT, BIGINT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT);
DROP FUNCTION IF EXISTS get_driver_statistics_v2(INT, TIMESTAMPTZ, TIMESTAMPTZ, INT);
DROP FUNCTION IF EXISTS get_driver_statistics_v2(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ, INT);

-- -----------------------------------------------------------------------------
-- Function: get_customer_statistics
-- Purpose: Calculate customer stats (orders, COD, fees) with date/status filters
-- Supports search by: customer_name, vendor_id, OR customer_phone
-- Usage: SELECT * FROM get_customer_statistics('Customer Name', NULL, NULL, '2024-01-01', '2024-12-31', 2);
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_customer_statistics(
  p_customer_name TEXT DEFAULT NULL,
  p_vendor_id BIGINT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL,
  p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to TIMESTAMPTZ DEFAULT NULL,
  p_status INT DEFAULT NULL
)
RETURNS TABLE (
  vendor_id BIGINT,
  customer_name TEXT,
  total_orders BIGINT,
  cod_received NUMERIC,
  order_fees NUMERIC,
  revenue_distribution NUMERIC,
  avg_delivery_time_minutes NUMERIC(10,2)
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.vendor_id,
    t.customer_name::TEXT,
    COUNT(*) FILTER (WHERE t.status = 2)::BIGINT AS total_orders,
    COALESCE(SUM(CASE WHEN t.status = 2 THEN t.cod_amount ELSE 0 END), 0) AS cod_received,
    COALESCE(SUM(CASE 
      WHEN t.status = 2 AND LOWER(t.tags) LIKE '%same day delivery%' THEN 1.1
      WHEN t.status = 2 AND LOWER(t.tags) LIKE '%express delivery%' THEN 1.65
      ELSE 0 
    END), 0) AS order_fees,
    COALESCE(SUM(CASE WHEN t.status = 2 THEN t.cod_amount ELSE 0 END), 0) - 
    COALESCE(SUM(CASE 
      WHEN t.status = 2 AND LOWER(t.tags) LIKE '%same day delivery%' THEN 1.1
      WHEN t.status = 2 AND LOWER(t.tags) LIKE '%express delivery%' THEN 1.65
      ELSE 0 
    END), 0) AS revenue_distribution,
    COALESCE(
      AVG(
        CASE 
          WHEN t.status = 2 AND t.completed_datetime IS NOT NULL AND t.started_datetime IS NOT NULL 
          THEN EXTRACT(EPOCH FROM (t.completed_datetime - t.started_datetime)) / 60.0
          ELSE NULL 
        END
      ), 
      0
    )::NUMERIC(10,2) AS avg_delivery_time_minutes
  FROM tasks t
  WHERE 
    t.job_type = 1 -- Only Deliveries
    -- Search params: match ANY of name, vendor_id, or phone (OR logic)
    AND (
      (p_customer_name IS NOT NULL AND t.customer_name = p_customer_name)
      OR (p_vendor_id IS NOT NULL AND t.vendor_id = p_vendor_id)
      OR (p_customer_phone IS NOT NULL AND REGEXP_REPLACE(t.customer_phone, '[^0-9]', '', 'g') LIKE '%' || p_customer_phone || '%')
    )
    -- Filter params: apply all (AND logic)
    AND (p_date_from IS NULL OR t.creation_datetime >= p_date_from)
    AND (p_date_to IS NULL OR t.creation_datetime <= p_date_to)
    AND (p_status IS NULL OR t.status = p_status)
  GROUP BY t.vendor_id, t.customer_name;
END;
$$;

-- -----------------------------------------------------------------------------
-- Function: get_driver_statistics_v2
-- Purpose: Calculate driver stats (orders, COD, fees, avg time) with filters
-- Usage: SELECT * FROM get_driver_statistics_v2(12345, '2024-01-01', '2024-12-31', 2);
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_driver_statistics_v2(
  p_fleet_id BIGINT,
  p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to TIMESTAMPTZ DEFAULT NULL,
  p_status INT DEFAULT NULL
)
RETURNS TABLE (
  fleet_id BIGINT,
  total_orders BIGINT,
  cod_total NUMERIC,
  order_fees NUMERIC,
  avg_delivery_time_minutes NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.fleet_id,
    COUNT(*) FILTER (WHERE t.status = 2)::BIGINT AS total_orders,
    COALESCE(SUM(CASE WHEN t.status = 2 THEN t.cod_amount ELSE 0 END), 0) AS cod_total,
    COALESCE(SUM(CASE 
      WHEN t.status = 2 AND LOWER(t.tags) LIKE '%same day delivery%' THEN 1.1
      WHEN t.status = 2 AND LOWER(t.tags) LIKE '%express delivery%' THEN 1.65
      ELSE 0 
    END), 0) AS order_fees,
    COALESCE(
      AVG(
        CASE 
          WHEN t.status = 2 AND t.completed_datetime IS NOT NULL AND t.started_datetime IS NOT NULL 
          THEN EXTRACT(EPOCH FROM (t.completed_datetime - t.started_datetime)) / 60.0
          ELSE NULL 
        END
      ), 
      0
    )::NUMERIC(10,2) AS avg_delivery_time_minutes
  FROM tasks t
  WHERE 
    t.fleet_id = p_fleet_id
    AND t.job_type = 1 -- Only Deliveries
    AND (p_date_from IS NULL OR t.creation_datetime >= p_date_from)
    AND (p_date_to IS NULL OR t.creation_datetime <= p_date_to)
    AND (p_status IS NULL OR t.status = p_status)
  GROUP BY t.fleet_id;
END;
$$;

-- =============================================================================
-- DONE! Both functions are now available.
-- Test them with:
--   SELECT * FROM get_customer_statistics('Test Customer');
--   SELECT * FROM get_driver_statistics_v2(12345);
-- =============================================================================
