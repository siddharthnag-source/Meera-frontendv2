'use client';

import { ShowToastOptions } from '@/components/ui/ToastProvider';
import { ChatAttachmentInputState } from '@/types/chat';
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { uploadAttachmentToStorage } from '@/lib/uploadAttachment';

interface UseDragAndDropProps {
  maxAttachments: number;
  currentAttachments: ChatAttachmentInputState[];
  setCurrentAttachments: (attachments: ChatAttachmentInputState[]) => void;
  showToast: (message: string, options: ShowToastOptions) => void;
  inputRef: MutableRefObject<HTMLTextAreaElement | null>;
  // NEW (optional); default "anonymous" if not set
  userId?: string;
}

export const useDragAndDrop = ({
  maxAttachments,
  currentAttachments,
  setCurrentAttachments,
  showToast,
  inputRef,
  userId,
}: UseDragAndDropProps) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef<number>(0);
  const effectiveUserId = userId ?? 'anonymous';

  const processFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      const validFiles: ChatAttachmentInputState[] = [];
      let invalidCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (
          currentAttachments.length + validFiles.length >= maxAttachments
        ) {
          showToast(`You can select a maximum of ${maxAttachments} files.`, {
            type: 'error',
            position: 'conversation',
          });
          break;
        }

        if (
          file.type.startsWith('image/') ||
          file.type === 'application/pdf'
        ) {
          try {
            const storagePath = await uploadAttachmentToStorage(
              effectiveUserId,
              file,
            );
            const type =
              file.type === 'application/pdf' ? 'document' : 'image';
            validFiles.push({
              file,
              previewUrl: URL.createObjectURL(file),
              type,
              storagePath,
            });
          } catch (err) {
            console.error('Drag-and-drop upload error', err);
            showToast('Failed to upload file. Please try again.', {
              type: 'error',
              position: 'conversation',
            });
          }
        } else {
          invalidCount++;
        }
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
      effectiveUserId,
      inputRef,
      maxAttachments,
      setCurrentAttachments,
      showToast,
    ],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);

      const files = e.dataTransfer?.files ?? null;
      void processFiles(files);
    },
    [processFiles],
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
