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

// Same bucket name as in AttachmentInputArea
const STORAGE_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || 'attachments';

export const useDragAndDrop = ({
  maxAttachments,
  currentAttachments,
  setCurrentAttachments,
  showToast,
  inputRef,
}: UseDragAndDropProps) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef<number>(0);

  const isValidFileType = (file: File): boolean => {
    return (
      file.type.startsWith('image/') || file.type === 'application/pdf'
    );
  };

  const uploadFileToStorage = async (
    file: File,
  ): Promise<string | null> => {
    try {
      const objectKey = `chat-uploads/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}-${file.name}`;

      const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(objectKey, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (error) {
        console.error('Supabase upload error (drag & drop)', error);
        showToast('Failed to upload file. Please try again.', {
          type: 'error',
          position: 'conversation',
        });
        return null;
      }

      return `${STORAGE_BUCKET}/${objectKey}`;
    } catch (err) {
      console.error('Unexpected upload error (drag & drop)', err);
      showToast('Failed to upload file. Please try again.', {
        type: 'error',
        position: 'conversation',
      });
      return null;
    }
  };

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const validFiles: ChatAttachmentInputState[] = [];
      let invalidCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (
          currentAttachments.length + validFiles.length >=
          maxAttachments
        ) {
          showToast(
            `You can select a maximum of ${maxAttachments} files.`,
            {
              type: 'error',
              position: 'conversation',
            },
          );
          break;
        }

        if (!isValidFileType(file)) {
          invalidCount++;
          continue;
        }

        const storagePath = await uploadFileToStorage(file);
        if (!storagePath) {
          continue;
        }

        const type =
          file.type === 'application/pdf' ? 'document' : 'image';

        validFiles.push({
          file,
          previewUrl: URL.createObjectURL(file),
          type,
          storagePath,
        });
      }

      if (validFiles.length > 0) {
        const newAttachments = [...currentAttachments, ...validFiles];
        setCurrentAttachments(newAttachments);

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
