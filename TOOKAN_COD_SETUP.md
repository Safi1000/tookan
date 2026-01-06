# Tookan COD Template Fields Setup Guide

This guide walks you through setting up the COD (Cash on Delivery) template fields in your Tookan dashboard. This is **critical** for COD tracking to work properly in the Turbo Bahrain platform.

## Why This Is Needed

According to Tookan:
> "Tookan doesn't provide any separate COD data. It can be handled from custom template field."
> "Template field can be used for this and agent can mark it true or false."
> "Webhooks are triggered only when status of task is changed. They can have a COD amount field and COD collection field separately."

## Step 1: Login to Tookan Dashboard

1. Go to https://app.tookanapp.com
2. Login with your credentials:
   - Email: `ahmedhassan123.ah83@gmail.com`
   - Password: `A*123321*a`

## Step 2: Navigate to Task Templates

1. Click the **Settings** icon (⚙️) in the sidebar
2. Click **Task Settings**
3. Select **Task Template**

## Step 3: Create/Edit Task Template

### Option A: Create New Template

1. Click **"+ Add Template"** button
2. Name your template (e.g., "Delivery with COD")
3. Continue to Step 4

### Option B: Edit Existing Template

1. Find your existing task template
2. Click the **Edit** button (pencil icon)
3. Continue to Step 4

## Step 4: Add COD Custom Fields

Add these two custom fields to your template:

### Field 1: COD Amount

| Property | Value |
|----------|-------|
| **Field Label** | COD Amount |
| **Field Type** | Number |
| **Field Name (slug)** | `cod_amount` |
| **Required** | Yes (recommended) |
| **Visible to Agent** | Yes |
| **Editable by Agent** | No (only staff should modify) |

### Field 2: COD Collected

| Property | Value |
|----------|-------|
| **Field Label** | COD Collected |
| **Field Type** | Checkbox |
| **Field Name (slug)** | `cod_collected` |
| **Required** | No |
| **Visible to Agent** | Yes |
| **Editable by Agent** | Yes (agent marks when collected) |

## Step 5: Save the Template

1. Click **Save** or **Update** button
2. Verify the template appears in your list

## Step 6: Verify Field Names

**IMPORTANT:** The field names (slugs) must match exactly:
- `cod_amount` (not "COD Amount" or "codAmount")
- `cod_collected` (not "COD Collected" or "codCollected")

These are defined in `server/config/tookanConfig.js`:

```javascript
const TEMPLATE_FIELDS = {
  COD_AMOUNT: 'cod_amount',
  COD_COLLECTED: 'cod_collected'
};
```

## Step 7: Assign Template to Tasks

When creating tasks (either via API or Dashboard), use this template to ensure COD fields are included.

### Via Dashboard
- Select your template when creating a new task

### Via API
- Include `template_id` in your task creation request
- Include COD values in `template_data`:

```json
{
  "api_key": "your_api_key",
  "template_id": "your_template_id",
  "template_data": [
    {
      "label": "cod_amount",
      "data": "125.50"
    },
    {
      "label": "cod_collected", 
      "data": "false"
    }
  ]
}
```

## Alternative: Using Built-in Order Payment

If you don't want to use custom template fields, Tookan has a built-in `order_payment` field. The system supports both approaches:

### Using order_payment
- Set `order_payment` when creating tasks
- This shows as "Order Payment" in Tookan dashboard
- The system will read this value for COD amount

### Webhook Data Structure

When a task status changes, the webhook will include:

```json
{
  "job_id": 12345,
  "job_status": 2,
  "order_payment": 125.50,
  "template_fields": {
    "cod_amount": "125.50",
    "cod_collected": "true"
  }
}
```

## How COD Syncing Works

```
┌─────────────────────────────────────────────────────────────┐
│                     COD Data Flow                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Task Created in Tookan                                  │
│     └─> COD Amount set in template fields                   │
│                                                              │
│  2. Webhook Triggered on Status Change                      │
│     └─> Your server receives task data with COD info        │
│     └─> Stored in database                                   │
│                                                              │
│  3. Agent Marks COD as Collected                            │
│     └─> Agent checks cod_collected in app                   │
│     └─> Status change triggers webhook                      │
│     └─> Your server updates COD queue                       │
│                                                              │
│  4. Staff Settles COD                                        │
│     └─> Staff confirms in Balance Panel                     │
│     └─> System updates merchant wallet                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Verifying Setup

After setup, create a test task with COD:

1. Create a task in Tookan with COD amount
2. Assign it to a driver
3. Check that the webhook is received (check server logs)
4. Verify the task appears in your dashboard
5. Complete the task and verify COD status updates

## Troubleshooting

### COD Amount Not Showing
- Verify field name is exactly `cod_amount` (case-sensitive)
- Check webhook payload includes `template_fields`

### COD Not Syncing
- Ensure webhooks are configured (see WEBHOOK_SETUP_GUIDE.md)
- Check server logs for webhook errors

### Agent Can't See COD Fields
- Verify "Visible to Agent" is enabled for both fields
- Agent may need to refresh/reinstall app

## Notes on Tags

According to Tookan documentation:
> "You cannot add tags on customers, only tags based pricing. You can configure the tags on template as well as on agent details."

Tags are used for:
- Agent categorization (e.g., "Gardener", "Plumber")
- Task assignment rules
- Pricing rules

See https://help.jungleworks.com/knowledge-base/tags-on-tookan/ for more on tags.

---

## Summary

1. ✅ Create task template with `cod_amount` and `cod_collected` fields
2. ✅ Use exact field names (lowercase with underscore)
3. ✅ Enable visibility for agents
4. ✅ Assign template to tasks
5. ✅ Configure webhooks to receive status updates

