-- Migration: Add dashboard totals function
-- Only calculates orders and completed deliveries from Supabase
-- Drivers and Customers come from Tookan API calls

CREATE OR REPLACE FUNCTION get_order_stats()
RETURNS TABLE (
  total_orders BIGINT,
  completed_deliveries BIGINT
) AS $$
BEGIN
  RETURN QUERY 
  SELECT 
    (SELECT COUNT(*) FROM tasks)::BIGINT as total_orders,
    (SELECT COUNT(*) FROM tasks WHERE status = 2 AND pickup_address IS DISTINCT FROM delivery_address)::BIGINT as completed_deliveries;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
