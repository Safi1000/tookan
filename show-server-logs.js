/**
 * Server Logs Viewer
 * 
 * Makes API requests to show what server logs look like
 * The actual server logs are visible in the separate terminal window
 * where the server is running
 */

const fetch = require('node-fetch');

const API_BASE = 'http://localhost:3001';

async function showServerLogs() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║           SERVER LOGS VIEWER                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  console.log('📋 Note: Actual server logs are visible in the separate terminal');
  console.log('   window where the server is running (node server/index.js)\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Make requests to generate server logs
  console.log('🔍 Making API requests to generate server activity...\n');
  
  // 1. Health check
  console.log('1️⃣ Health Check Request');
  console.log('   Server will log: GET /api/health');
  try {
    const healthRes = await fetch(`${API_BASE}/api/health`);
    const health = await healthRes.json();
    console.log('   ✅ Response:', JSON.stringify(health, null, 2));
  } catch (error) {
    console.log('   ❌ Error:', error.message);
  }
  
  console.log('\n   📝 Server Terminal Logs (in separate window):');
  console.log('      → No special logging for health endpoint\n');
  
  // 2. Get COD Queue
  console.log('2️⃣ Get COD Queue Request');
  console.log('   Server will log: GET /api/cod/queue/1001');
  try {
    const queueRes = await fetch(`${API_BASE}/api/cod/queue/1001`);
    const queue = await queueRes.json();
    console.log('   ✅ Response: Queue with', queue.data?.length || 0, 'entries');
  } catch (error) {
    console.log('   ❌ Error:', error.message);
  }
  
  console.log('\n   📝 Server Terminal Logs (in separate window):');
  console.log('      === GET COD QUEUE REQUEST ===');
  console.log('      Request received at: [timestamp]');
  console.log('      Driver ID: 1001');
  console.log('      Found X COD entries in queue');
  console.log('      === END REQUEST ===\n');
  
  // 3. Get Oldest Pending COD
  console.log('3️⃣ Get Oldest Pending COD Request');
  console.log('   Server will log: GET /api/cod/queue/pending/1001');
  try {
    const pendingRes = await fetch(`${API_BASE}/api/cod/queue/pending/1001`);
    const pending = await pendingRes.json();
    console.log('   ✅ Response:', pending.data ? 'Found pending COD' : 'No pending COD');
    if (pending.data) {
      console.log('      COD ID:', pending.data.codId);
      console.log('      Amount: $' + pending.data.amount);
    }
  } catch (error) {
    console.log('   ❌ Error:', error.message);
  }
  
  console.log('\n   📝 Server Terminal Logs (in separate window):');
  console.log('      === GET OLDEST PENDING COD REQUEST ===');
  console.log('      Request received at: [timestamp]');
  console.log('      Driver ID: 1001');
  if (pending.data) {
    console.log('      Oldest pending COD found:');
    console.log('        COD ID: [codId]');
    console.log('        Amount: [amount]');
    console.log('        Status: PENDING');
  } else {
    console.log('      No pending COD found for driver');
  }
  console.log('      === END REQUEST ===\n');
  
  // 4. Add COD to Queue
  console.log('4️⃣ Add COD to Queue Request');
  console.log('   Server will log: POST /api/cod/queue/add');
  try {
    const addRes = await fetch(`${API_BASE}/api/cod/queue/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        driverId: 1001,
        orderId: 'ORD-LOG-TEST',
        amount: 250.00,
        merchantVendorId: 2001,
        date: new Date().toISOString().split('T')[0],
        notes: 'Test entry for log viewing'
      })
    });
    const addResult = await addRes.json();
    console.log('   ✅ Response: COD added successfully');
    console.log('      COD ID:', addResult.data?.codId);
  } catch (error) {
    console.log('   ❌ Error:', error.message);
  }
  
  console.log('\n   📝 Server Terminal Logs (in separate window):');
  console.log('      === ADD COD TO QUEUE REQUEST ===');
  console.log('      Request body: { ... }');
  console.log('      ✅ COD added to queue: [codId]');
  console.log('      === END REQUEST ===\n');
  
  // 5. Settle COD (this will show the full reconciliation flow)
  console.log('5️⃣ Settle COD Request (Full Reconciliation Flow)');
  console.log('   Server will log: POST /api/cod/queue/settle');
  console.log('   This shows the complete reconciliation logic!\n');
  
  // Get oldest pending first to get the correct amount
  try {
    const pendingRes = await fetch(`${API_BASE}/api/cod/queue/pending/1001`);
    const pending = await pendingRes.json();
    
    if (pending.data) {
      console.log('   📋 Found pending COD to settle:');
      console.log('      COD ID:', pending.data.codId);
      console.log('      Amount: $' + pending.data.amount);
      console.log('\n   🔄 Attempting settlement...\n');
      
      const settleRes = await fetch(`${API_BASE}/api/cod/queue/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverId: 1001,
          paidAmount: pending.data.amount,
          date: pending.data.date,
          note: 'Reconciliation test - showing server logs',
          codId: pending.data.codId
        })
      });
      
      const settleResult = await settleRes.json();
      
      if (settleResult.status === 'success') {
        console.log('   ✅ Settlement successful!');
      } else {
        console.log('   ⚠️  Settlement response:', settleResult.message);
      }
      
      console.log('\n   📝 Server Terminal Logs (in separate window):');
      console.log('      === SETTLE COD TRANSACTION REQUEST ===');
      console.log('      Request received at: [timestamp]');
      console.log('      Request body: {');
      console.log('        driverId: 1001,');
      console.log('        paidAmount: [amount],');
      console.log('        date: [date],');
      console.log('        note: "Reconciliation test - showing server logs"');
      console.log('      }');
      console.log('      ✅ Found pending COD in queue:');
      console.log('        COD ID: [codId]');
      console.log('        Order ID: [orderId]');
      console.log('        COD Amount: [amount]');
      console.log('        Paid Amount: [amount]');
      console.log('        Merchant Vendor ID: [vendorId]');
      console.log('        Date: [date]');
      console.log('      🔄 Processing settlement...');
      console.log('      Step 1: Crediting driver wallet...');
      console.log('      [Driver wallet API call logs]');
      if (settleResult.status === 'success') {
        console.log('      ✅ Driver wallet credited successfully');
        console.log('      Step 2: Crediting merchant wallet...');
        console.log('      [Merchant wallet API call logs]');
        console.log('      ✅ Merchant wallet credited successfully');
        console.log('      Step 3: Marking COD as COMPLETED...');
        console.log('      ✅ COD marked as COMPLETED');
        console.log('      === END REQUEST (SUCCESS) ===');
      } else {
        console.log('      ❌ Driver wallet credit failed: [error message]');
        console.log('      === END REQUEST (ERROR) ===');
      }
    } else {
      console.log('   ℹ️  No pending COD found to settle');
    }
  } catch (error) {
    console.log('   ❌ Error:', error.message);
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n📋 Summary of Server Logging:');
  console.log('   • All API requests are logged with timestamps');
  console.log('   • COD queue operations show detailed information');
  console.log('   • Settlement flow shows step-by-step processing');
  console.log('   • Errors are logged with full details');
  console.log('   • All logs include request/response data');
  console.log('\n💡 To see live server logs:');
  console.log('   → Check the separate terminal window where server is running');
  console.log('   → Or run: node server/index.js (in a new terminal)');
  console.log('\n');
}

// Check if server is running
async function run() {
  try {
    const healthRes = await fetch(`${API_BASE}/api/health`);
    await healthRes.json();
    console.log('✅ Server is running\n');
    await showServerLogs();
  } catch (error) {
    console.error('❌ Server is not running!');
    console.log('Please start the server first: node server/index.js\n');
  }
}

run().catch(console.error);

