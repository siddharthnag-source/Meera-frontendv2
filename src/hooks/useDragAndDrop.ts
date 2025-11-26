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

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const validFiles: ChatAttachmentInputState[] = [];
      let rejectedCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (currentAttachments.length + validFiles.length >= maxAttachments) {
          showToast(`You can select a maximum of ${maxAttachments} files.`, {
            type: 'error',
            position: 'conversation',
          });
          break;
        }

        const sizeMb = file.size / (1024 * 1024);
        if (sizeMb > MAX_FILE_SIZE_MB) {
          rejectedCount++;
          continue;
        }

        const isImage = file.type.startsWith('image/');
        const type: 'image' | 'document' = isImage ? 'image' : 'document';

        validFiles.push({
          file,
          previewUrl: URL.createObjectURL(file),
          type,
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

      if (rejectedCount > 0) {
        showToast(
          `Some files were skipped (unsupported type or larger than ${MAX_FILE_SIZE_MB} MB).`,
          {
            type: 'error',
            position: 'conversation',
          },
        );
      }
    },
    [currentAttachments, inputRef, maxAttachments, setCurrentAttachments, showToast],
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
