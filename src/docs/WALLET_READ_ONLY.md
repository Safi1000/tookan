# Wallet Read-Only Integration Guide

## Overview

This document explains the wallet integration approach for Tookan, where **Tookan is the single source of truth** for all wallet data.

## Key Principles

1. **Tookan is Source of Truth**: All wallet balances and transactions are managed in Tookan
2. **Read-Only Access**: Our system only reads wallet data from Tookan APIs
3. **No Local Calculations**: We do not maintain a local "shadow ledger" that could drift from Tookan
4. **Short Cache TTL**: Wallet data is cached for 5 minutes to reduce API calls while ensuring freshness

## Implementation Details

### Cache Behavior

- **Cache Duration**: 5 minutes (300,000 milliseconds)
- **Cache Scope**: Per wallet (driver or customer/merchant)
- **Cache Invalidation**: Automatic after TTL expires
- **Cache Key Format**: 
  - Driver: `wallet_driver_{driverId}`
  - Customer/Merchant: `wallet_customer_{params}`

### API Functions

#### Driver Wallet

```typescript
import { fetchFleetWalletBalance } from '../services/tookanApi';

const result = await fetchFleetWalletBalance(driverId);
// Result includes metadata:
// {
//   status: 'success',
//   data: {
//     balance: 100.50,
//     _metadata: {
//       source: 'tookan',
//       cached: false  // or true if from cache
//     }
//   }
// }
```

#### Customer/Merchant Wallet

```typescript
import { fetchCustomerWallet } from '../services/tookanApi';

const result = await fetchCustomerWallet(vendorId);
// Result includes metadata indicating source and cache status
```

### Frontend Display

When displaying wallet values in the UI:

1. **Show Source Label**: Display "From Tookan" or "Source: Tookan" near wallet values
2. **Cache Indicator**: Optionally show if data is cached (for debugging)
3. **Refresh Option**: Provide manual refresh button to bypass cache

### Guardrails

1. **No Local Recalculation**: Never calculate wallet balance locally based on transactions
2. **No Shadow Ledger**: Do not maintain a separate wallet balance table
3. **Always Fetch from Tookan**: When in doubt, fetch fresh data from Tookan API
4. **Cache is Optional**: Cache is for performance only, not for data consistency

### Error Handling

- If Tookan API fails, show error message
- Do not fall back to cached data if it's expired
- Clear cache on authentication errors

### Best Practices

1. **Display Fresh Data**: When user explicitly requests wallet info, bypass cache
2. **Background Refresh**: Use cache for background updates, fetch fresh for user-initiated actions
3. **Clear Cache on Updates**: If wallet is updated in Tookan (via our system or externally), clear relevant cache entries
4. **Log Cache Hits**: For debugging, log when cache is used vs. fresh API calls

## Migration Notes

If you need to migrate from a local wallet system:

1. Remove all local wallet balance calculations
2. Remove any "shadow ledger" tables
3. Update all wallet displays to show "From Tookan"
4. Implement cache as described above
5. Test with Tookan API to ensure data matches

## Troubleshooting

### Wallet balance doesn't match Tookan

- Clear cache and refresh
- Verify Tookan API response directly
- Check if there are pending transactions in Tookan

### Cache not working

- Check browser console for errors
- Verify cache TTL is set correctly (5 minutes)
- Check if cache key is being generated correctly

### Performance issues

- Cache should reduce API calls significantly
- If still slow, consider increasing cache TTL (but not beyond 10 minutes)
- Monitor Tookan API rate limits







