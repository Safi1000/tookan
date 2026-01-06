# Order Editor Panel Testing Guide

## Overview
This guide covers testing the complete Order Editor Panel two-way sync functionality with Tookan API integration.

## Prerequisites
1. Backend server running on `http://localhost:3001`
2. Tookan API key configured in `.env` file
3. Valid Tookan order IDs for testing
4. Frontend application running

## Testing Flow

### 1. Order Search and Load
**Test Steps:**
1. Open Order Editor Panel
2. Enter a valid Order ID in the search field
3. Click "Search" or press Enter
4. Verify order data loads correctly

**Expected Results:**
- Order details display correctly
- All fields display order data
- Loading state shows during fetch
- Success toast notification appears

**Test Script:** `test-order-fetch.js`

---

### 2. Edit Order Fields
**Test Steps:**
1. Load an order (status must be "ongoing" or "pending")
2. Modify COD amount
3. Modify Order fees
4. Change assigned driver
5. Update notes
6. Click "Save Changes"

**Expected Results:**
- Fields are editable for ongoing orders
- Fields are disabled for delivered/completed orders
- Save button shows loading state
- Success toast appears after save
- Order data refreshes with new timestamp

**Test Script:** `test-order-update.js`

---

### 3. Conflict Detection
**Test Steps:**
1. Load an order
2. Make local changes (don't save)
3. Manually update the same order in Tookan dashboard
4. Wait for conflict check (or trigger manually)
5. Verify conflict warning appears

**Expected Results:**
- Conflict warning banner appears
- Shows local vs Tookan timestamps
- "Refresh from Tookan" button works
- "Keep Local Changes" dismisses warning

**Test Script:** `test-order-conflicts.js`

---

### 4. Re-Order Functionality
**Test Steps:**
1. Load an existing order
2. Click "Re-order" button
3. Verify new order is created
4. Check new order ID in success modal
5. Click "Load New Order" to view the new order

**Expected Results:**
- New order created in Tookan
- Success modal shows new order ID
- New order has same data as original
- No linking between original and new order

**Test Script:** `test-order-reorder.js`

---

### 5. Return Order Functionality
**Test Steps:**
1. Load an existing order
2. Note the pickup and delivery addresses
3. Click "Return Order" button
4. Verify return order is created
5. Load the return order and verify:
   - Pickup address = original delivery address
   - Delivery address = original pickup address
   - COD amount = 0

**Expected Results:**
- Return order created successfully
- Addresses are reversed
- COD is automatically removed (set to 0)
- Success modal shows return order ID

**Test Script:** `test-order-return.js`

---

### 6. Delete Order Functionality
**Test Steps:**

**A. Delete Ongoing Order:**
1. Load an order with status "ongoing" or "pending"
2. Click "Delete Order"
3. Enter deletion note
4. Click "Delete Order" button
5. Verify order is deleted

**B. Delete Successful Order:**
1. Load an order with status "delivered" or "completed"
2. Click "Delete Order"
3. Enter deletion note
4. Click "Delete Order" button
5. Verify note is added instead of deletion

**Expected Results:**
- Ongoing orders: Full deletion via API
- Successful orders: Note added, deletion prevented
- Appropriate messages shown to user
- Order cleared from UI after successful deletion

**Test Script:** `test-order-delete.js`

---

### 7. Webhook Integration
**Test Steps:**
1. Set up webhook URL in Tookan dashboard pointing to: `http://your-server.com/api/tookan/webhook`
2. Make changes to an order in Tookan dashboard
3. Verify webhook is received
4. Check server logs for webhook processing

**Expected Results:**
- Webhook received and logged
- 200 OK response sent to Tookan
- Webhook events processed correctly

**Test Script:** `test-webhook-receiver.js`

---

## Manual Testing Checklist

### Order Search
- [ ] Valid order ID loads successfully
- [ ] Invalid order ID shows error
- [ ] Empty search shows validation error
- [ ] Loading state displays during fetch
- [ ] Error messages are user-friendly

### Order Editing
- [ ] COD amount can be edited (ongoing orders)
- [ ] Order fees can be edited (ongoing orders)
- [ ] Driver can be changed (ongoing orders)
- [ ] Notes can be updated (ongoing orders)
- [ ] Fields are disabled for delivered orders
- [ ] Save button disabled for delivered orders
- [ ] Validation prevents negative amounts
- [ ] Save shows loading state
- [ ] Success toast appears after save

### Conflict Detection
- [ ] Conflict warning appears when order updated externally
- [ ] Timestamps displayed correctly
- [ ] "Refresh from Tookan" loads latest data
- [ ] "Keep Local Changes" dismisses warning
- [ ] Conflict check runs automatically every 30 seconds

### Re-Order
- [ ] Re-order creates new task in Tookan
- [ ] New order ID is generated
- [ ] Original order data is copied
- [ ] Success modal displays correctly
- [ ] Can load new order from modal

### Return Order
- [ ] Return order creates new task
- [ ] Addresses are reversed correctly
- [ ] COD is set to 0
- [ ] Success modal displays return order ID
- [ ] Can load return order from modal

### Delete Order
- [ ] Ongoing orders can be deleted
- [ ] Successful orders cannot be deleted
- [ ] Deletion note is required
- [ ] Note is added for successful orders
- [ ] Order cleared from UI after deletion

### Error Handling
- [ ] Network errors show user-friendly messages
- [ ] API errors display correctly
- [ ] Validation errors prevent invalid submissions
- [ ] Loading states prevent duplicate requests
- [ ] Retry options available for failed requests

---

## Automated Test Scripts

Run the following test scripts to verify functionality:

```bash
# Test order fetch
node test-order-fetch.js

# Test order update
node test-order-update.js

# Test conflict detection
node test-order-conflicts.js

# Test re-order
node test-order-reorder.js

# Test return order
node test-order-return.js

# Test delete order
node test-order-delete.js

# Test webhook receiver
node test-webhook-receiver.js
```

---

## Test Data Requirements

### Valid Test Order IDs
- One order with status "ongoing" or "pending" (for editing/deletion)
- One order with status "delivered" or "completed" (for delete restriction test)
- Orders with COD amounts > 0 (for return order test)

### Test Drivers
- At least 2-3 valid driver IDs from Tookan
- Driver IDs should match format used in Tookan

---

## Common Issues and Solutions

### Issue: Order not loading
**Solution:** 
- Verify Order ID exists in Tookan
- Check backend server is running
- Verify API key is configured correctly
- Check browser console for errors

### Issue: Save fails
**Solution:**
- Verify order status allows editing
- Check all required fields are filled
- Verify amounts are valid (non-negative)
- Check network connection

### Issue: Conflict detection not working
**Solution:**
- Verify order was actually updated in Tookan
- Check conflict check interval is running
- Verify timestamps are being compared correctly

### Issue: Webhook not received
**Solution:**
- Verify webhook URL is configured in Tookan
- Check server is accessible from internet (use ngrok for local testing)
- Verify webhook endpoint is returning 200 OK
- Check server logs for webhook attempts

---

## Performance Testing

### Load Testing
- Test with multiple concurrent order searches
- Test conflict detection with many orders
- Verify webhook processing doesn't block other requests

### Stress Testing
- Test with invalid order IDs
- Test with network failures
- Test with API rate limits

---

## Security Testing

### Input Validation
- Test with SQL injection attempts in order ID
- Test with XSS in notes field
- Test with extremely large numbers in amounts

### Authentication
- Verify API key is not exposed in frontend
- Test webhook signature validation (if implemented)
- Verify CORS is configured correctly

---

## Integration Testing

### End-to-End Flow
1. Create order in Tookan
2. Load order in Order Editor Panel
3. Edit order fields
4. Save changes
5. Verify changes in Tookan dashboard
6. Update order in Tookan dashboard
7. Verify conflict detection in Order Editor Panel
8. Refresh order to get latest data
9. Create re-order
10. Create return order
11. Delete order (if ongoing)

---

## Notes

- All test scripts use the backend API proxy
- Test scripts include error handling and logging
- Manual testing is recommended for UI/UX validation
- Automated tests verify API functionality
- Webhook testing requires external tool or Tookan dashboard

