const supabaseUrl =
  "https://ixeeperktitbzmnvcaqz.supabase.co";

const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4ZWVwZXJrdGl0YnptbnZjYXF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3Njg1MTEsImV4cCI6MjA5NDM0NDUxMX0.E4nC-w8XRpk_X7vghkGfbXuJUHQneLUJy2DLw9NsuVQ";

window.supabaseClient =
  window.supabase.createClient(
    supabaseUrl,
    supabaseKey
  );
