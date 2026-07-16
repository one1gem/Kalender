import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn(
    "Supabase-Umgebungsvariablen fehlen. Bitte VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY setzen."
  );
}

export const supabase = createClient(url || "", anonKey || "");
