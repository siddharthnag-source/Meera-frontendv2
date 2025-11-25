import { supabase } from '@/lib/supabaseClient';

const BUCKET_NAME = 'meera-attachments'; // create this bucket in Supabase Storage

export async function uploadAttachmentToStorage(
  userId: string,
  file: File,
): Promise<string> {
  const safeName = file.name.replace(/\s+/g, '-');
  const objectPath = `user-${userId || 'anonymous'}/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(objectPath, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (error) {
    console.error('Supabase storage upload error', error);
    throw error;
  }

  // We will treat "bucket/path" as the canonical storagePath
  return `${BUCKET_NAME}/${objectPath}`;
}
