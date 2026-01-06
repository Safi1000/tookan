/**
 * Script to create a user in Supabase Auth
 * Usage: node create-user.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase credentials not found in .env file');
  console.error('   Please ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set');
  process.exit(1);
}

// Create Supabase admin client
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function createUser(email, password, name = null, role = 'admin') {
  try {
    console.log(`\n🔐 Creating user: ${email}`);
    console.log(`   Name: ${name || email}`);
    console.log(`   Role: ${role}`);
    
    // Create user in Supabase Auth
    const { data, error } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        name: name || email,
        role: role
      }
    });

    if (error) {
      console.error(`❌ Error creating user: ${error.message}`);
      return { success: false, error: error.message };
    }

    if (!data || !data.user) {
      console.error('❌ Failed to create user: No user data returned');
      return { success: false, error: 'No user data returned' };
    }

    console.log(`✅ User created successfully!`);
    console.log(`   User ID: ${data.user.id}`);
    console.log(`   Email: ${data.user.email}`);
    
    // Try to create user profile in database
    try {
      const { error: profileError } = await supabase
        .from('users')
        .upsert({
          id: data.user.id,
          email: data.user.email,
          name: name || email,
          role: role,
          permissions: role === 'admin' ? {} : {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'id'
        });

      if (profileError) {
        console.warn(`⚠️  Warning: Could not create user profile in database: ${profileError.message}`);
        console.warn(`   User was created in Auth, but profile may need to be created manually`);
      } else {
        console.log(`✅ User profile created in database`);
      }
    } catch (profileErr) {
      console.warn(`⚠️  Warning: Could not create user profile: ${profileErr.message}`);
      console.warn(`   User was created in Auth, but profile may need to be created manually`);
    }

    return { success: true, user: data.user };
  } catch (error) {
    console.error(`❌ Unexpected error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Main execution
async function main() {
  const email = 'hamnatest@example.com'; // Default domain if not specified
  const password = 'test123';
  const name = 'Hamna Test';
  const role = 'admin';

  console.log('='.repeat(60));
  console.log('Creating User in Supabase');
  console.log('='.repeat(60));

  const result = await createUser(email, password, name, role);

  if (result.success) {
    console.log('\n' + '='.repeat(60));
    console.log('✅ SUCCESS!');
    console.log('='.repeat(60));
    console.log(`\nYou can now login with:`);
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${password}`);
    console.log(`\nOpen http://localhost:3000 and login with these credentials.`);
  } else {
    console.log('\n' + '='.repeat(60));
    console.log('❌ FAILED');
    console.log('='.repeat(60));
    console.log(`\nError: ${result.error}`);
    console.log(`\nPlease check:`);
    console.log(`   1. Supabase credentials are correct in .env`);
    console.log(`   2. Supabase project is active`);
    console.log(`   3. User doesn't already exist`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

