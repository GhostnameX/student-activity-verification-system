import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "request-attachments";
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const { data: before, error: readError } = await supabase.storage.getBucket(BUCKET);
if (readError || !before) {
  throw new Error(`Cannot read ${BUCKET} bucket: ${readError?.message ?? "not found"}`);
}

if (before.public) {
  const { error: updateError } = await supabase.storage.updateBucket(BUCKET, {
    public: false,
    fileSizeLimit: before.file_size_limit ?? null,
    allowedMimeTypes: before.allowed_mime_types ?? null,
  });
  if (updateError) {
    throw new Error(`Cannot make ${BUCKET} private: ${updateError.message}`);
  }
}

const { data: after, error: verifyError } = await supabase.storage.getBucket(BUCKET);
if (verifyError || !after || after.public) {
  throw new Error(`Failed to verify ${BUCKET} as private: ${verifyError?.message ?? "bucket is still public"}`);
}
if (
  after.file_size_limit !== before.file_size_limit
  || JSON.stringify(after.allowed_mime_types ?? null) !== JSON.stringify(before.allowed_mime_types ?? null)
) {
  throw new Error(`${BUCKET} upload limits changed unexpectedly`);
}

console.log(`${BUCKET} is private; avatars was not modified`);
