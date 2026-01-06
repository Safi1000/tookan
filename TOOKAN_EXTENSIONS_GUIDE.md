# Tookan Extensions Setup Guide

## Overview
This guide documents the required Tookan extensions for the Turbo Bahrain Project and how to enable them.

## Required Extensions

### ✅ Already Enabled
- **Merchant Extension** - Required for merchant management and multi-merchant support

### Required Free Extensions (Based on SRS & Code Requirements)

#### 1. **Agent/Fleet Extension** (Core Feature)
- **Status**: Usually included in base Tookan plan
- **Why Needed**: 
  - Code uses `/v2/get_all_fleets` API endpoint
  - Order Editor Panel needs driver/agent list
  - Reports Panel displays driver summaries
- **SRS Requirement**: "Fetch from Tookan: Drivers (Agents)"
- **Action**: Verify agents can be added via dashboard or API

#### 2. **Wallet Extension** (May be Free)
- **Status**: Check if available as free extension
- **Why Needed**:
  - Code uses `/v2/customer_wallet_transaction` API
  - Code uses `/v2/fleet_wallet_transaction` API
  - Financial Panel manages driver and customer wallets
  - Withdrawal requests update wallets
- **SRS Requirement**: Wallet management for merchants and drivers
- **Action**: Enable if available in extensions marketplace

#### 3. **Webhook Extension** (May be Free)
- **Status**: Check if available as free extension
- **Why Needed**:
  - Code has webhook receiver at `/api/tookan/webhook`
  - Two-way sync requires webhook events
  - Order updates need to be received from Tookan
- **SRS Requirement**: "Receive Tookan webhook events"
- **Action**: Enable if available, configure webhook URL

#### 4. **API Extension** (Core Feature)
- **Status**: Should already be enabled (core Tookan feature)
- **Why Needed**: All API calls require API access
- **Action**: Verify API key is active

## How to Enable Extensions

### Step 1: Access Tookan Extensions Marketplace
1. Log in to your Tookan Admin Dashboard
2. Navigate to **Extensions** (usually in top-right corner or Settings menu)
3. Go to **Addons** or **Extensions Marketplace**
4. Filter by **Free** extensions

### Step 2: Enable Required Extensions
1. Search for "Wallet" extension - enable if free
2. Search for "Webhook" extension - enable if free
3. Verify Merchant extension is enabled
4. Verify API access is enabled (check Settings > API)

### Step 3: Configure Extensions
- **Wallet Extension**: No special configuration needed (APIs should work automatically)
- **Webhook Extension**: 
  - Set webhook URL to: `https://your-domain.com/api/tookan/webhook` (or `http://localhost:3001/api/tookan/webhook` for local testing)
  - Enable events: Order Created, Order Updated, Order Completed, Driver Assigned, COD Collected

## Adding Merchants and Agents

### Option 1: Via Tookan Dashboard (Recommended for Initial Setup)

#### Adding Merchants:
1. Go to **Merchants** section in Tookan dashboard
2. Click **Add Merchant**
3. Fill in:
   - Full Name
   - Phone Number (unique)
   - Email (unique)
   - Company Address
   - Password
   - Company Name
   - Assign Role (if Merchant ACL is configured)
4. Save merchant
5. Note the `vendor_id` from the merchant details (needed for API calls)

#### Adding Agents (Drivers):
1. Go to **Agents** section in Tookan dashboard
2. Click **Add Agent**
3. Fill in:
   - Full Name
   - Phone Number (unique)
   - Email (unique)
   - Password
   - Assign Team (if applicable)
4. Save agent
5. Note the `fleet_id` from the agent details (needed for API calls)

### Option 2: Via API (Use Scripts Provided)

See `add-merchants-and-agents.js` script for programmatic addition.

## Verification

After enabling extensions and adding merchants/agents:

1. **Test Merchant API**:
   ```bash
   node test-merchants-agents.js
   ```

2. **Test Agent API**:
   - Verify `/api/tookan/fleets` returns agents
   - Verify `/api/tookan/customers` returns merchants

3. **Test Wallet APIs**:
   - Verify wallet transactions work
   - Test withdrawal approval flow

4. **Test Webhooks**:
   - Create a test order in Tookan
   - Verify webhook is received at `/api/tookan/webhook`

## Troubleshooting

### Merchants/Agents Not Showing in API
- Verify Merchant extension is enabled
- Check that merchants/agents are created in the correct Tookan account
- Verify API key has proper permissions

### Wallet APIs Not Working
- Check if Wallet extension is enabled
- Verify API key permissions include wallet access
- Check Tookan account plan includes wallet features

### Webhooks Not Received
- Verify Webhook extension is enabled (if required)
- Check webhook URL is correctly configured in Tookan dashboard
- Verify backend server is accessible from internet (for production)
- Check webhook URL in Tookan: Settings > Webhooks

## Notes

- **Merchants = Customers** in Tookan API (use `vendor_id`)
- **Agents = Drivers = Fleets** in Tookan API (use `fleet_id`)
- Some features may be included in base Tookan plan and not require separate extensions
- Check Tookan documentation for latest extension availability

