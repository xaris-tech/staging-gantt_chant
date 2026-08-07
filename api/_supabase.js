const { createClient } = require('@supabase/supabase-js');

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

function client() {
  if (globalThis.__STAGEFLOW_SUPABASE_CLIENT__) return globalThis.__STAGEFLOW_SUPABASE_CLIENT__;
  const config = supabaseConfig();
  if (!config) return null;
  globalThis.__STAGEFLOW_SUPABASE_CLIENT__ = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return globalThis.__STAGEFLOW_SUPABASE_CLIENT__;
}

module.exports = { client, supabaseConfig };
