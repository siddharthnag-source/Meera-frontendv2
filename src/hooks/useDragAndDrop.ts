'use client';

import { ShowToastOptions } from '@/components/ui/ToastProvider';
import { ChatAttachmentInputState } from '@/types/chat';
import { supabase } from '@/lib/supabaseClient';
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

interface UseDragAndDropProps {
  maxAttachments: number;
  currentAttachments: ChatAttachmentInputState[];
  setCurrentAttachments: (attachments: ChatAttachmentInputState[]) => void;
  showToast: (message: string, options: ShowToastOptions) => void;
  inputRef: MutableRefObject<HTMLTextAreaElement | null>;
}

const STORAGE_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || 'attachments';

const buildStoragePath = (file: File) => {
  const ext = file.name.split('.').pop() || 'bin';
  const rand = Math.random().toString(36).slice(2);
  return `${Date.now()}-${rand}.${ext}`;
};

async function uploadFileToStorage(file: File): Promise<{
  storagePath: string;
  publicUrl: string;
} | null> {
  try {
    const path = buildStoragePath(file);

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || undefined,
      });

    if (error) {
      console.error('Supabase upload error (drag-drop)', error);
      return null;
    }

    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);

    return {
      storagePath: path,
      publicUrl: data.publicUrl,
    };
  } catch (err) {
    console.error('Unexpected Supabase upload error (drag-drop)', err);
    return null;
  }
}

export const useDragAndDrop = ({
  maxAttachments,
  currentAttachments,
  setCurrentAttachments,
  showToast,
  inputRef,
}: UseDragAndDropProps) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef<number>(0);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const newAttachments: ChatAttachmentInputState[] = [];
      let invalidCount = 0;
      let uploadFailedCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (currentAttachments.length + newAttachments.length >= maxAttachments) {
          showToast(`You can select a maximum of ${maxAttachments} files.`, {
            type: 'error',
            position: 'conversation',
          });
          break;
        }

        const isValid =
          file.type.startsWith('image/') || file.type === 'application/pdf';

        if (!isValid) {
          invalidCount++;
          continue;
        }

        const uploadResult = await uploadFileToStorage(file);
        if (!uploadResult) {
          uploadFailedCount++;
          continue;
        }

        const type =
          file.type === 'application/pdf' ? 'document' : 'image';

        newAttachments.push({
          file,
          previewUrl: URL.createObjectURL(file),
          type,
          storagePath: uploadResult.storagePath,
          publicUrl: uploadResult.publicUrl,
        });
      }

      if (newAttachments.length > 0) {
        const updated = [...currentAttachments, ...newAttachments];
        setCurrentAttachments(updated);

        if (inputRef.current) {
          setTimeout(() => {
            inputRef.current?.focus();
          }, 100);
        }
      }

      if (invalidCount > 0) {
        showToast('Error uploading file. Only PDF and images are supported.', {
          type: 'error',
          position: 'conversation',
        });
      }

      if (uploadFailedCount > 0) {
        showToast('Failed to upload some files. Please try again.', {
          type: 'error',
          position: 'conversation',
        });
      }
    },
    [
      currentAttachments,
      inputRef,
      maxAttachments,
      setCurrentAttachments,
      showToast,
    ],
  );

  useEffect(() => {
    const preventDefaults = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDragEnter = (e: DragEvent) => {
      preventDefaults(e);
      dragCounterRef.current += 1;
      setIsDraggingOver(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      preventDefaults(e);
      dragCounterRef.current -= 1;
      if (dragCounterRef.current === 0) {
        setIsDraggingOver(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      preventDefaults(e);
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [handleDrop]);

  return {
    isDraggingOver,
  };
};
