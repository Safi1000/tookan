# Server Architecture & Flow Analysis

## 1. Project Overview
This server application functions as a **middleware and synchronization engine** between the **Tookan Delivery Management Platform** and a custom internal system (backed by Supabase). Its primary goals are to:
- **Synchronize Data**: Keep a local copy of Orders (Tasks), Agents, and Customers from Tookan.
- **Manage Cash on Delivery (COD)**: Track driver cash collections via a FIFO queue system.
- **Automate Tagging**: Apply business rules to assign tags to customers/tasks (driving pricing or allocation).
- **Handle Webhooks**: Reliably process real-time updates from Tookan with retry mechanisms.

## 2. Technology Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: Supabase (PostgreSQL) with a fallback to local JSON files (`server/data/`).
- **External API**: Tookan v2 API
- **Persistence Layer**: Custom `taskStorage` and model wrappers that abstract the DB/File duality.

## 3. Directory Structure
The `server/` directory is organized as follows:

| Directory/File | Purpose |
|---------------|---------|
| `index.js` | **Entry Point**. Sets up Express, middleware, API routes, and starts the server. Contains significant inline controller logic. |
| `services/` | Contains core synchronization logic. |
| &nbsp;&nbsp;`orderSyncService.js` | Fetches historical order data (last 6 months) in batches and syncs to Supabase. Handles rate limiting and SSL retries. |
| &nbsp;&nbsp;`customerSyncService.js` | Syncs customer data from Tookan. |
| &nbsp;&nbsp;`agentSyncService.js` | Syncs driver/agent profiles. |
| `db/` | Database connectivity and models. |
| &nbsp;&nbsp;`models/` | Data access objects (DAOs) for `tasks`, `users`, `codQueue`, etc. |
| &nbsp;&nbsp;`supabase.js` | Supabase client configuration. |
| `data/` | **Fallback Storage**. Contains JSON files (e.g., `tasks.json`, `codQueue.json`) used if Supabase is offline/unconfigured. Also holds `tagConfig.json`. |
| `webhookProcessor.js` | Background job that processes failed webhooks. Implements exponential backoff processing. |
| `codQueue.js` | Manages the "Cash on Delivery" accountability queue for drivers. |
| `tagService.js` | Rules engine for assigning tags based on customer attributes (Plan, Zone, etc.). |

## 4. Key Functional Modules

### A. Synchronization Engine (`services/orderSyncService.js`)
- **Flow**:
  1. Breaks the sync window (default 6 months) into small **batches** (e.g., 1 day) to handle Tookan's pagination limits.
  2. Fetches tasks for all job types (Pickup, Delivery, Appointment, FOS).
  3. Fetches detailed **Job Details** to extract `COD_Amount` and `tags` (custom fields).
  4. **Upserts** (Update/Insert) records into the Supabase `tasks` table.
  5. Updates a `sync_status` table to track progress.

### B. COD Queue System (`codQueue.js`)
- **Purpose**: Tracks how much cash a driver is holding.
- **Mechanism**:
  - **FIFO Queue**: Each driver has a queue of collected payments.
  - **Status**: Transactions move from `PENDING` (Driver collecting cash) → `COMPLETED` (Cash handed over/Settled).
  - **Storage**: Persisted in `cod_queue` table (or `codQueue.json`).
- **Usage**: Used to settle driver accounts at the end of shifts.

### C. Tagging Engine (`tagService.js`)
- **Purpose**: Automates classification of customers/tasks.
- **Configuration**: Uses `server/data/tagConfig.json`.
- **Logic**: Evaluates rules (e.g., `if plan === 'premium'`) to assign tags like `DELIVERY_TIER_A`. These tags likely influence pricing or driver allocation in Tookan.

### D. Webhook Processor (`webhookProcessor.js`)
- **Purpose**: Ensures no data is lost if the server is busy or errors occur during a webhook.
- **Flow**:
  1. Incoming Webhook → Saved to `webhook_events`.
  2. `webhookProcessor` runs internally (or via cron).
  3. Checks for pending/failed events.
  4. Retries up to 3 times with exponential backoff.
  5. Updates the local Task state via `taskStorage.updateTaskFromWebhook`.

## 5. Data Flow Diagram

```mermaid
graph TD
    T[Tookan API/Webhooks] -->|Webhooks| E[Express Server (index.js)]
    T -->|API Response| S[Sync Services]
    
    E -->|Save Event| DB[(Supabase)]
    E -->|Process| WP[Webhook Processor]
    
    S -->|Upsert Data| DB
    
    WP -->|Retry/Update| DB
    
    User[Admin/Client] -->|API Request| E
    E -->|Read| DB
    E -->|Read/Write| CQ[COD Queue]
```

## 6. Main Execution Flow
1. **Server Start**: `index.js` initializes Express and connects to Supabase.
2. **Syncing**: Can be triggered (likely via API endpoint or cron) to pull historical data using `orderSyncService`.
3. **Real-time Updates**: 
   - Tookan sends a webhook.
   - Server validates logic.
   - `webhookProcessor` ensures the local database reflects the change (e.g., Status changed to "Completed").
   - If the order was "Cash on Delivery", the `codQueue` module may update the driver's pending cash balance.
4. **API Interaction**: The frontend (or admin usage) queries this server to get reports, check driver debt (COD), or manage tags, rather than querying Tookan directly for every request.
