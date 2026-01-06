# Tookan API Integration Guide

This document explains how to configure and use the Tookan API integration for Turbo Bahrain.

## API Key Configuration

### Option 1: Environment Variable (Recommended for Production)

1. Create a `.env` file in the project root:
```bash
VITE_TOOKAN_API_KEY=your_actual_api_key_here
```

2. The API key will be automatically loaded from `import.meta.env.VITE_TOOKAN_API_KEY`

### Option 2: LocalStorage (Development Only)

For development/testing, you can temporarily store the API key in localStorage:
```javascript
localStorage.setItem('tookan_api_key', 'your_api_key_here');
```

⚠️ **Warning**: Never commit API keys to version control. Always use environment variables in production.

## Available API Functions

### Driver Wallet Operations

#### Create Fleet Wallet Transaction
Credits or debits a driver's wallet.

```typescript
import { createFleetWalletTransaction } from '../services/tookanApi';

// Credit driver wallet
const response = await createFleetWalletTransaction(
  driverId,        // Driver/Fleet ID (string or number)
  amount,          // Amount (positive number)
  description,     // Transaction description
  'credit'         // Transaction type: 'credit' or 'debit'
);
```

#### Fetch Fleet Wallet Balance
Retrieves a driver's current wallet balance.

```typescript
import { fetchFleetWalletBalance } from '../services/tookanApi';

const response = await fetchFleetWalletBalance(driverId);
```

### Customer/Merchant Wallet Operations

#### Add Payment to Customer/Merchant Wallet
Adds money to a customer or merchant wallet.

```typescript
import { addCustomerWalletPayment } from '../services/tookanApi';

// Single vendor
const response = await addCustomerWalletPayment(
  vendorId,        // Customer/Merchant vendor ID
  amount,          // Amount to add (must be positive)
  description      // Reason (e.g., "Order refund", "Wallet top-up")
);

// Multiple vendors
const response = await addCustomerWalletPayment(
  [vendorId1, vendorId2],  // Array of vendor IDs
  amount,
  description
);
```

#### Fetch Customer/Merchant Wallet
Retrieves wallet details for one or more customers/merchants.

```typescript
import { fetchCustomerWallet } from '../services/tookanApi';

const response = await fetchCustomerWallet(
  vendorIds,       // Single ID or array of IDs
  isPagination,    // 0 or 1 (default: 1)
  offset,          // Pagination offset (default: 0)
  limit            // Records per page (default: 50)
);
```

## Response Format

All API functions return a standardized response:

```typescript
{
  status: 'success' | 'error',
  action: 'wallet_credit' | 'wallet_debit' | 'fetch_wallet' | 'create_task',
  entity: 'driver' | 'customer' | 'merchant',
  message: 'Human readable explanation',
  data: {} // API-specific response data
}
```

## Error Handling

All functions include built-in validation:

- **Amount validation**: Must be greater than 0
- **ID validation**: Required and must be valid
- **Description validation**: Required for wallet transactions
- **Network error handling**: Catches and reports network failures

Example error handling:

```typescript
const response = await createFleetWalletTransaction(driverId, amount, description);

if (response.status === 'error') {
  console.error(response.message);
  toast.error(response.message);
  return;
}

// Success
toast.success(response.message);
```

## Security Best Practices

1. **Never expose API keys** in logs, UI, or error messages
2. **Use environment variables** for API keys in production
3. **Validate all inputs** before making API calls
4. **Never double-charge wallets** - always confirm transaction success before updating UI
5. **Keep wallet types separate** - Driver wallets ≠ Customer/Merchant wallets

## API Documentation References

- Main Tookan API: https://jungleworks.com/tookan/
- Driver Wallet API: https://tookanapi.docs.apiary.io/#reference/agent/create-fleet-wallet-transaction/create-a-pickup-task
- Custom Wallet API: See Tookan Custom Wallet API documentation

## Decision Logic

When processing wallet operations, follow this order:

1. **Identify Actor**: Driver → Fleet Wallet API | Customer/Merchant → Custom Wallet API
2. **Identify Intent**: Credit, Debit, or Fetch
3. **Validate Inputs**: IDs exist, Amount > 0, Correct wallet type
4. **Execute API**: One API call per action
5. **Return Response**: Success confirmation with updated balance (if available)

## Testing

To test the integration:

1. Set up your API key (environment variable or localStorage)
2. Use the Financial Panel in the UI to test wallet operations
3. Check the browser console for API responses
4. Verify transactions in your Tookan dashboard

## Troubleshooting

### "Tookan API key not configured" error
- Ensure `.env` file exists with `VITE_TOOKAN_API_KEY` set
- Or set API key in localStorage: `localStorage.setItem('tookan_api_key', 'your_key')`

### API calls failing
- Verify your API key is valid
- Check network connectivity
- Review Tookan API status
- Check browser console for detailed error messages

### Wallet balance not updating
- Verify the transaction was successful (check response.status)
- Refresh wallet data after successful transaction
- Check Tookan dashboard for transaction confirmation

