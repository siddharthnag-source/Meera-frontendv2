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

const MAX_FILE_SIZE_MB = 25;

export const useDragAndDrop = ({
  maxAttachments,
  currentAttachments,
  setCurrentAttachments,
  showToast,
  inputRef,
}: UseDragAndDropProps) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef<number>(0);

  const uploadToSupabase = async (file: File) => {
    try {
      const ext = file.name.split('.').pop();
      const path = `attachments/${Date.now()}-${Math.random()
        .toString(36)
        .substring(2)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('attachments')
        .upload(path, file, { upsert: false });

      if (uploadError) {
        console.error(uploadError);
        return null;
      }

      const { data } = supabase.storage.from('attachments').getPublicUrl(path);
      return {
        storagePath: path,
        publicUrl: data.publicUrl,
      };
    } catch (err) {
      console.error('Upload failed:', err);
      return null;
    }
  };

  const handleFileAttach = async (files: FileList) => {
    const processed: ChatAttachmentInputState[] = [];
    let rejected = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (currentAttachments.length + processed.length >= maxAttachments) {
        showToast(`You can select a maximum of ${maxAttachments} files.`, {
          type: 'error',
          position: 'conversation',
        });
        break;
      }

      if (file.size / (1024 * 1024) > MAX_FILE_SIZE_MB) {
        rejected++;
        continue;
      }

      const isImage = file.type.startsWith('image/');
      const type: 'image' | 'document' = isImage ? 'image' : 'document';

      // Upload to Supabase
      const uploaded = await uploadToSupabase(file);
      if (!uploaded) {
        rejected++;
        continue;
      }

      processed.push({
        file,
        previewUrl: URL.createObjectURL(file),
        type,
        storagePath: uploaded.storagePath,
        publicUrl: uploaded.publicUrl,
      });
    }

    if (processed.length > 0) {
      setCurrentAttachments([...currentAttachments, ...processed]);

      if (inputRef.current) {
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    }

    if (rejected > 0) {
      showToast(
        `Some files could not be uploaded or exceeded ${MAX_FILE_SIZE_MB} MB.`,
        { type: 'error', position: 'conversation' }
      );
    }
  };

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      handleFileAttach(files);
    },
    [currentAttachments]
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

  return { isDraggingOver };
};
