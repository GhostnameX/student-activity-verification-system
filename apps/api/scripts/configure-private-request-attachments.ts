import { createClient } from "@supabase/supabase-js";

const BUCKET = "request-attachments";
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const expectedProjectRef = Bun.argv
  .find((arg) => arg.startsWith("--project-ref="))
  ?.slice("--project-ref=".length);

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}
if (!expectedProjectRef) {
  throw new Error("--project-ref=<ref> is required");
}

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== expectedProjectRef) {
  throw new Error(`Supabase project mismatch: expected ${expectedProjectRef}, got ${projectRef}`);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

async function findFirstObject(prefix = "", depth = 0): Promise<string | null> {
  if (depth > 5) return null;

  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
    limit: 100,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) throw new Error(`Cannot list ${BUCKET}: ${error.message}`);

  for (const entry of data) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id) return path;

    const nested = await findFirstObject(path, depth + 1);
    if (nested) return nested;
  }
  return null;
}

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

const objectPath = await findFirstObject();
let accessVerification = "no stored object was available for an access check";
if (objectPath) {
  const { data: signed, error: signedError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(objectPath, 60);
  if (signedError || !signed?.signedUrl) {
    throw new Error(`Cannot create signed URL: ${signedError?.message ?? "missing URL"}`);
  }

  const signedResponse = await fetch(signed.signedUrl, {
    headers: { Range: "bytes=0-0" },
  });
  await signedResponse.body?.cancel();
  if (!signedResponse.ok) {
    throw new Error(`Signed URL verification failed with HTTP ${signedResponse.status}`);
  }

  const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
  const publicResponse = await fetch(publicUrl, {
    headers: { Range: "bytes=0-0" },
  });
  await publicResponse.body?.cancel();
  if (publicResponse.ok) {
    throw new Error("Public URL still serves a private attachment");
  }
  accessVerification = "signed access works and public access is blocked";
}

console.log(`${BUCKET} is private; ${accessVerification}; avatars was not modified`);
