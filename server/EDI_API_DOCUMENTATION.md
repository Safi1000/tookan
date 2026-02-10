# EDI & API Token Integration Guide

This document outlines the usage of the new API Token management system for Administrators and the Electronic Data Interchange (EDI) endpoints for integrating external systems with Tookan.

## 1. Authentication Overview

The system uses two types of authentication:
*   **Admin API**: Standard session/cookie authentication (same as the dashboard).
*   **EDI API**: Bearer Token authentication. External systems must include `Authorization: Bearer <API_TOKEN>` in headers.

---

## 2. Admin: Managing API Tokens

These endpoints are for administrators to generate and manage credentials for merchants/external partners.

**Base URL**: `https://<server-domain>/api/admin/tokens`

### A. Create a New Token
Generates a secure API token. 
**Note:** The full token is only returned *once* upon creation.

*   **Endpoint**: `POST /create`
*   **Headers**: 
    *   `Content-Type: application/json`
    *   `Authorization`: (Standard Admin Auth)
*   **Body**:
    ```json
    {
      "merchant_id": "merchant_123",
      "name": "Lazada Integration"
    }
    ```
*   **Response**:
    ```json
    {
      "status": "success",
      "data": {
        "id": "uuid-...",
        "name": "Lazada Integration",
        "token": "edi_a1b2c3d4...",  
        "prefix": "edi_a1b2",
        "created_at": "..."
      }
    }
    ```

### B. List Tokens
View all active tokens for a specific merchant.

*   **Endpoint**: `GET /list?merchant_id=<merchant_id>`
*   **Response**:
    ```json
    {
      "status": "success",
      "data": [
        {
          "id": "uuid-...",
          "name": "Lazada Integration",
          "prefix": "edi_a1b2",
          "created_at": "...",
          "last_used_at": "..."
        }
      ]
    }
    ```

### C. Revoke a Token
Invalidate a compromised or unused token.

*   **Endpoint**: `POST /revoke`
*   **Body**: `{"token_id": "uuid-..."}`
*   **Response**: `{ "status": "success", "message": "Token revoked successfully" }`

---

## 3. EDI: Order Integration

External systems use these endpoints to create orders and check status.

**Base URL**: `https://<server-domain>/api/edi`
**Authentication**: `Authorization: Bearer edi_a1b2c3d4...`

### A. Create Order
Push a new delivery task to the system.

*   **Endpoint**: `POST /orders/create`
*   **Headers**: `Authorization: Bearer <TOKEN>`
*   **Body**:
    ```json
    {
      "order_reference": "ORD-555-ABC",        // (Required) Unique ID from external system
      "pickup_address": "123 Warehouse St, City", // (Required)
      "pickup_name": "Central Depot",
      "pickup_phone": "+60123456789",
      "pickup_datetime": "2023-10-25 14:00:00",
      
      "dropoff_address": "456 Customer Ave, City",
      "contact_name": "John Doe",
      "contact_phone": "+60198765432",
      "contact_email": "john@example.com",
      "delivery_datetime": "2023-10-25 16:00:00",
      
      "delivery_instructions": "Leave at front desk",
      "cod_amount": 50.00  // Optional: If Cash on Delivery is required
    }
    ```
*   **Response (Success)**:
    ```json
    {
      "status": "success",
      "data": {
        "job_id": 123456,
        "tracking_link": "https://tookanapp.com/track/...",
        "message": "Order created successfully"
      }
    }
    ```

### B. Check Order Status
Retrieve the current status of an order using the external reference or Tookan Job ID.

*   **Endpoint**: `GET /orders/status/:referenceId`
*   **Query Params**: 
    *   `type=job_id` (Optional, if querying by Tookan Job ID instead of order reference)
*   **Example**: `GET /orders/status/ORD-555-ABC`
*   **Response**:
    ```json
    {
      "status": "success",
      "data": {
        "status": "In Progress",
        "status_code": 4,
        "job_id": 123456,
        "tracking_link": "..."
      }
    }
    ```



## 4. Status Codes Map

| Value | Status | Description |
| :--- | :--- | :--- |
| **0** | Assigned | The task has been assigned to an agent. |
| **1** | Started | The task has been started and the agent is on the way. |
| **2** | Successful | The task has been completed successfully. |
| **3** | Failed | The task has been completed unsuccessfully. |
| **4** | InProgress/Arrived | The task is being performed and the agent has reached the destination. |
| **6** | Unassigned | The task has not been assigned to any agent. |
| **7** | Accepted/Acknowledged | The task has been accepted by the agent. |
| **8** | Decline | The task has been declined by the agent. |
| **9** | Cancel | The task has been cancelled. |
| **10** | Deleted | The task is deleted from the Dashboard. |

## 5. Error Handling

All endpoints return standard JSON error responses:

```json
{
  "status": "error",
  "message": "Description of the error"
}
```

Common errors:
*   `401 Unauthorized`: Invalid or missing Token.
*   `400 Bad Request`: Missing required fields (e.g. `order_reference`).
*   `404 Not Found`: Order ID not found.
