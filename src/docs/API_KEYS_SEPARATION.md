# API Keys Separation Guide

## Overview

This project uses **TWO separate API configurations**:

1. **Main Tookan API** - For customer/merchant wallet operations and general operations
2. **Driver Wallet API** - For driver/fleet wallet operations only

## Why Separate APIs?

- Driver wallet operations require specific permissions and endpoints
- Customer/merchant wallet operations use different endpoints
- Separation ensures proper security and access control

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# Main Tookan API Key (for customer/merchant wallets)
VITE_TOOKAN_API_KEY=your_main_api_key_here

# Driver Wallet API Key (for driver/fleet wallet operations)
# If separate from main API key, set it here
# If same as main key, leave empty (will use main key as fallback)
VITE_TOOKAN_DRIVER_API_KEY=your_driver_api_key_here
```

### How It Works

1. **Customer/Merchant Operations** use:
   - `VITE_TOOKAN_API_KEY` (main API key)
   - Base URL: `https://api.tookanapp.com/v2`
   - Endpoints: `addCustomerPaymentViaDashboard`, `fetch_customers_wallet`

2. **Driver/Fleet Operations** use:
   - `VITE_TOOKAN_DRIVER_API_KEY` (driver API key) **OR**
   - Falls back to `VITE_TOOKAN_API_KEY` if driver key not set
   - Base URL: `https://api.tookanapp.com/v2`
   - Endpoints: `create_fleet_wallet_transaction`, `get_fleet_wallet_transactions`

### Fallback Behavior

If `VITE_TOOKAN_DRIVER_API_KEY` is not set:
- Driver wallet operations will use `VITE_TOOKAN_API_KEY` automatically
- This allows using a single API key if both APIs share the same key

## Code Implementation

### Driver Wallet Functions
- `createFleetWalletTransaction()` → Uses `getDriverApiKey()`
- `fetchFleetWalletBalance()` → Uses `getDriverApiKey()`

### Customer/Merchant Wallet Functions
- `addCustomerWalletPayment()` → Uses `getApiKey()` (main)
- `fetchCustomerWallet()` → Uses `getApiKey()` (main)

### Task Operations
- `createPickupTask()` → Uses `getApiKey()` (main)

## Security Notes

✅ Driver wallet operations are **completely isolated** from customer/merchant operations  
✅ Each API key is loaded separately  
✅ Clear separation of concerns in code  
✅ Proper error handling if API keys are missing  

## Troubleshooting

### "Driver Wallet API key not configured" error
- Set `VITE_TOOKAN_DRIVER_API_KEY` in `.env`
- OR ensure `VITE_TOOKAN_API_KEY` is set (will be used as fallback)

### "Tookan API key not configured" error
- Set `VITE_TOOKAN_API_KEY` in `.env` (required for customer/merchant operations)

### Using Same Key for Both
If your main API key works for both operations:
```env
VITE_TOOKAN_API_KEY=your_shared_api_key
# Leave VITE_TOOKAN_DRIVER_API_KEY empty
```

### Using Different Keys
If you have separate keys:
```env
VITE_TOOKAN_API_KEY=your_main_api_key
VITE_TOOKAN_DRIVER_API_KEY=your_driver_api_key
```

