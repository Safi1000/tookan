# Withdrawal Request Receiver API Documentation

## Endpoint
`POST /api/withdrawal/request`

## Authentication
Bearer token in Authorization header:
```
Authorization: Bearer <EXTERNAL_API_KEY>
```

## Request Payload
```json
{
  "id": 12345,
  "email": "customer@example.com",
  "type": 1,
  "requested_amount": 100.500,
  "tax_applied": 5.025,
  "final_amount": 95.475,
  "iban_number": "BH67ABCD12345678901234"
}
```

### Field Descriptions
| Field | Type | Description |
|-------|------|-------------|
| id | number | Fleet ID (type=1) or Vendor ID (type=2) |
| email | string | Customer email address |
| type | number | 1 = Fleet, 2 = Vendor |
| requested_amount | number | Withdrawal amount (must be > 0) |
| tax_applied | number | Tax calculated by partner |
| final_amount | number | Amount after tax (must be >= 0) |
| iban_number | string | IBAN (15-34 alphanumeric) |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Success - request stored |
| 400 | Validation error |
| 401 | Unauthorized |
| 500 | Server error |

**Note:** No body is returned. Partner shows generic error for non-200.

## Postman Example

```javascript
// POST {{base_url}}/api/withdrawal/request
// Headers:
//   Authorization: Bearer your-api-key-here
//   Content-Type: application/json

{
  "id": 12345,
  "email": "fleet@example.com",
  "type": 1,
  "requested_amount": 50.000,
  "tax_applied": 2.500,
  "final_amount": 47.500,
  "iban_number": "BH67ABCD1234567890"
}
```

## Database Schema
Run migration: `server/db/migrations/012_create_withdrawals_table.sql`

Creates `withdrawals` table with:
- UUID primary key
- fleet_id / vendor_id (mutually exclusive)
- email, amounts, IBAN, status
- Constraints for data integrity
