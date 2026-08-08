import { uploadFile } from "$lib/api";

export async function uploadImageToSupabase(
  file: File,
  _path: string,
): Promise<string> {
  const res = await uploadFile(file);
  return res.storagePath;
}
