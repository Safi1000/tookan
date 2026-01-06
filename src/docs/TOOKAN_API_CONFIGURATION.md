# Tookan API Configuration Guide

## Overview

This project uses a **single Tookan API key** for all operations including:
- Driver/Fleet Wallet operations
- Customer/Merchant Wallet operations
- Task creation (pickup/delivery)

## Configuration

### Environment Variable

Create a `.env` file in the project root:

```env
# Tookan API Key (used for all operations)
VITE_TOOKAN_API_KEY=your_tookan_api_key_here
```

Get your API key from: https://jungleworks.com/tookan/ → Settings → API Keys

### API Base URL

All operations use the same base URL:
- **Base URL**: `https://api.tookanapp.com/v2`

## API Implementation

### Customer/Merchant Wallet Operations

#### Add Customer Payment via Dashboard
- **Endpoint**: `POST /v2/addCustomerPaymentViaDashboard`
- **Documentation**: https://tookanapi.docs.apiary.io/#
- **Function**: `addCustomerWalletPayment(vendorId, amount, description?)`
  - `vendorId`: number | number[] (required, cannot be 0)
  - `amount`: number (required, must be > 0)
  - `description`: string (optional)

#### Fetch Customers' Wallet Details
- **Endpoint**: `POST /v2/fetch_customers_wallet`
- **Documentation**: https://tookanapi.docs.apiary.io/#
- **Function**: `fetchCustomerWallet(vendorIds?, isPagination?, offset?, limit?, totalUsedCredit?, tags?)`
  - `vendorIds`: number | number[] (optional)
  - `isPagination`: number (optional, valid: 0 or 1)
  - `offset`: number (optional, required if is_pagination is present)
  - `limit`: number (optional, required if offset is present)
  - `totalUsedCredit`: number (optional, valid: 0 or 1)
  - `tags`: string[] (optional)

### Driver/Fleet Wallet Operations

#### Create Fleet Wallet Transaction
- **Endpoint**: `POST /v2/create_fleet_wallet_transaction`
- **Function**: `createFleetWalletTransaction(fleetId, amount, description, transactionType)`
  - `fleetId`: string | number (required)
  - `amount`: number (required, must be > 0)
  - `description`: string (required)
  - `transactionType`: 'credit' | 'debit' (default: 'credit')

#### Fetch Fleet Wallet Balance
- **Endpoint**: `POST /v2/get_fleet_wallet_transactions`
- **Function**: `fetchFleetWalletBalance(fleetId)`
  - `fleetId`: string | number (required)

## Code Implementation

All API functions use `getApiKey()` which loads the single API key from:
1. `VITE_TOOKAN_API_KEY` environment variable (recommended)
2. `localStorage.getItem('tookan_api_key')` (development fallback)

### Example Usage

```typescript
import { 
  addCustomerWalletPayment,
  fetchCustomerWallet,
  createFleetWalletTransaction,
  fetchFleetWalletBalance
} from '../services/tookanApi';

// Add payment to customer wallet (description is optional)
const response = await addCustomerWalletPayment(
  123,           // vendor_id
  500,           // amount
  'Wallet recharge'  // description (optional)
);

// Fetch customer wallet (vendorIds is optional)
const wallet = await fetchCustomerWallet(
  123,           // vendorIds (optional)
  1,             // isPagination (optional)
  0,             // offset (optional)
  50             // limit (optional)
);

// Credit driver wallet
const driverResponse = await createFleetWalletTransaction(
  1001,                    // fleet_id
  100,                     // amount
  'Earnings credit',       // description
  'credit'                 // transactionType
);
```

## Validation Rules

### addCustomerPaymentViaDashboard
- ✅ `vendor_id` cannot be 0
- ✅ `vendor_ids` items cannot be 0
- ✅ `amount` must be > 0
- ✅ Must send either `vendor_id` OR `vendor_ids`
- ✅ `description` is optional

### fetch_customers_wallet
- ✅ `vendor_id`/`vendor_ids` are optional
- ✅ If `is_pagination` is 1, `off_set` and `limit` are required
- ✅ `total_used_credit` valid values: 0 or 1
- ✅ `tags` must be array of strings

## Error Handling

All API functions:
- ✅ Handle non-JSON responses (HTML error pages, plain text)
- ✅ Provide clear error messages
- ✅ Detect "session expired" errors
- ✅ Validate input parameters before API calls
- ✅ Return standardized response format

## Security Notes

- ✅ API key is never exposed in logs, UI, or error messages
- ✅ All monetary values are validated (amount > 0)
- ✅ Entity identity is confirmed before wallet operations
- ✅ Clear error messages for API failures
- ✅ Driver wallets kept separate from customer/merchant wallets in code logic

## Troubleshooting

### "Tookan API key not configured" error
- Ensure `.env` file exists with `VITE_TOOKAN_API_KEY` set
- Restart dev server after updating `.env`

### API calls failing
- Verify API key is correct
- Check API key permissions in Tookan dashboard
- Review error messages in browser console

### "Session expired" error
- Verify API key is valid and not expired
- Check API key permissions in Tookan dashboard

