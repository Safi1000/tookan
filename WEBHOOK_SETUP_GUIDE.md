# Tookan Webhook Setup Guide

## Overview
This guide explains how to configure webhooks in Tookan to enable two-way synchronization with the Turbo Bahrain Project.

According to Tookan:
> "Webhooks are triggered only when status of task is changed. They can have a COD amount field and COD collection field separately which can provide data for both amount and whether it is collected or not."

## Webhook Requirements

### Why Webhooks Are Needed
- **Two-way sync**: Receive order updates from Tookan in real-time
- **Conflict detection**: Know when orders are modified externally
- **COD tracking**: Automatically add COD to queue when collected
- **Order status updates**: Keep local data in sync with Tookan

### Webhook Events We Handle
1. **Task Created** - New task/order created in Tookan
2. **Task Updated** - Task details modified
3. **Task Assigned** - Driver assigned to task
4. **Task Completed** - Task delivered/completed (status = 2)
5. **Task Status Changed** - Any status change
6. **Task Cancelled** - Task cancelled

## Setup Instructions

### Step 1: Login to Tookan Dashboard

1. Go to https://app.tookanapp.com
2. Login with your credentials:
   - Email: `ahmedhassan123.ah83@gmail.com`
   - Password: `A*123321*a`

### Step 2: Access Webhook Settings

1. Click the **Settings** icon (⚙️) in the sidebar
2. Navigate to **Integrations** → **Webhooks**
3. If webhook section is not visible, you may need to enable the Webhook extension

### Step 3: Configure Webhook URL

**For Production (After Vercel Deployment):**
```
https://your-vercel-app.vercel.app/api/tookan/webhook
```

**For Local Development:**
```
http://localhost:3001/api/tookan/webhook
```

**Note**: For local testing, you'll need to use a tunneling service like:
- ngrok: `ngrok http 3001`
- localtunnel: `lt --port 3001`
- Then use the provided URL: `https://your-tunnel-url.ngrok.io/api/tookan/webhook`

### Step 3: Enable Webhook Events

Enable the following events in Tookan webhook settings:
- ✅ Task Created
- ✅ Task Updated
- ✅ Task Status Changed
- ✅ Task Assigned
- ✅ Task Completed
- ✅ Task Cancelled
- ✅ COD Collected (if available)

### Step 4: Test Webhook

1. Create a test order in Tookan dashboard
2. Check backend logs for webhook receipt
3. Verify webhook payload is logged correctly

## Webhook Endpoint Details

**Endpoint**: `POST /api/tookan/webhook`

**Expected Payload Structure**:
```json
{
  "event_type": "task_created",
  "job_id": "12345",
  "job_status": "1",
  "fleet_id": "67890",
  "vendor_id": "11111",
  "cod_amount": "50.00"
}
```

**Response**: Always returns `200 OK` to acknowledge receipt (even if processing fails)

## Troubleshooting

### Webhooks Not Received

1. **Check Webhook Extension**: Verify webhook extension is enabled in Tookan
2. **Check URL**: Ensure webhook URL is correct and accessible
3. **Check Firewall**: Ensure backend server allows incoming POST requests
4. **Check Logs**: Review Tookan webhook logs in dashboard
5. **Test Manually**: Use curl or Postman to test webhook endpoint:
   ```bash
   curl -X POST http://localhost:3001/api/tookan/webhook \
     -H "Content-Type: application/json" \
     -d '{"event_type":"test","job_id":"12345"}'
   ```

### Webhook Events Not Processing

1. Check backend logs for webhook processing errors
2. Verify event type handlers are working
3. Check if COD queue is being updated correctly
4. Verify webhook payload structure matches expected format

## Security Considerations

- Webhook endpoint should validate requests (optional: add signature verification)
- Consider rate limiting to prevent abuse
- Log all webhook events for audit purposes
- Handle webhook failures gracefully (always return 200 OK)

## Webhook Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     Webhook Flow                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Task Status Changes in Tookan                           │
│     └─> Webhook triggered                                   │
│                                                              │
│  2. Webhook Sent to Your Server                             │
│     └─> POST /api/tookan/webhook                            │
│     └─> Contains: job_id, status, template_fields           │
│                                                              │
│  3. Server Processes Webhook                                │
│     └─> Stores in webhook_events table (for reliability)    │
│     └─> Updates task in tasks table                         │
│     └─> Updates COD queue if applicable                     │
│                                                              │
│  4. Dashboard Reflects Changes                              │
│     └─> Reports Panel shows updated orders                  │
│     └─> Balance Panel shows COD status                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Webhook Reliability

The system implements webhook reliability features:

1. **Event Persistence**: All webhooks are stored in `webhook_events` table
2. **Status Tracking**: Events are marked as pending/processed/failed
3. **Retry Mechanism**: Failed events can be retried with exponential backoff
4. **Monitoring**: View webhook status via `/api/webhooks/events`

## Next Steps

After webhooks are configured:
1. Test with real orders - create a task in Tookan dashboard
2. Check server logs for webhook receipt: `Webhook received: {...}`
3. Verify task appears in Reports Panel
4. Complete a task and verify COD queue updates
5. Monitor webhook delivery in Tookan dashboard

## Quick Verification

After deployment, test webhook with curl:

```bash
curl -X POST https://your-domain.vercel.app/api/tookan/webhook \
  -H "Content-Type: application/json" \
  -d '{"event_type":"test","job_id":"12345","job_status":1}'
```

Expected response:
```json
{
  "status": "success",
  "message": "Webhook received",
  "data": { "job_id": "12345", "event_type": "test" }
}
```

