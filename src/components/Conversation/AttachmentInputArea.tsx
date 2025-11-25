'use client';

import { useToast } from '@/components/ui/ToastProvider';
import { isIOS } from '@/lib/deviceInfo';
import { ChatAttachmentInputState } from '@/types/chat';
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { CgAttachment } from 'react-icons/cg';
import { AttachmentMenuComponent } from './AttachmentMenu';
import { uploadAttachmentToStorage } from '@/lib/uploadAttachment';

const MAX_ATTACHMENTS_DEFAULT = 10;

interface AttachmentInputAreaProps {
  maxAttachments?: number;
  onAttachmentsChange: (attachments: ChatAttachmentInputState[]) => void;
  onClearRequest?: () => void;
  messageValue: string;
  resetInputHeightState: () => void;
  children: React.ReactNode;
  existingAttachments?: ChatAttachmentInputState[];
  // NEW (optional): if not provided we use "anonymous"
  userId?: string;
}

// Imperative ref methods
export interface AttachmentInputAreaRef {
  clear: () => void;
  removeAttachment: (index: number) => void;
  processPastedFiles: (files: File[]) => void;
}

export const AttachmentInputArea = forwardRef<
  AttachmentInputAreaRef,
  AttachmentInputAreaProps
>(
  (
    {
      maxAttachments = MAX_ATTACHMENTS_DEFAULT,
      onAttachmentsChange,
      onClearRequest,
      messageValue,
      resetInputHeightState,
      children,
      existingAttachments,
      userId,
    },
    ref,
  ) => {
    const [attachments, setAttachments] = useState<ChatAttachmentInputState[]>(
      existingAttachments || [],
    );
    const [showAttachMenu, setShowAttachMenu] = useState(false);
    const [isIosDevice, setIsIosDevice] = useState(false);

    const effectiveUserId = userId ?? 'anonymous';

    const { showToast } = useToast();
    const menuRef = useRef<HTMLDivElement>(null);
    const attachButtonRef = useRef<HTMLButtonElement>(null);
    const attachmentsForCleanupRef =
      useRef<ChatAttachmentInputState[]>(attachments);

    useEffect(() => {
      setIsIosDevice(isIOS());
    }, []);

    // Sync attachments when parent changes them
    useEffect(() => {
      if (existingAttachments) {
        setAttachments(existingAttachments);
      }
    }, [existingAttachments]);

    useEffect(() => {
      attachmentsForCleanupRef.current = attachments;
    }, [attachments]);

    useEffect(() => {
      if (onClearRequest) {
        // currently no external trigger used, kept for compatibility
      }
    }, [onClearRequest]);

    // Cleanup preview URLs on unmount
    useEffect(() => {
      return () => {
        attachmentsForCleanupRef.current.forEach((att) => {
          if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
        });
      };
    }, []);

    const internalClearAttachments = () => {
      attachments.forEach((att) => {
        if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
      });
      setAttachments([]);
      onAttachmentsChange([]);
      if (messageValue === '') {
        resetInputHeightState();
      }
    };

    const isValidFileType = (file: File): boolean => {
      return file.type.startsWith('image/') || file.type === 'application/pdf';
    };

    // Core: upload to Supabase + build ChatAttachmentInputState
    const processFiles = async (files: FileList | File[] | null) => {
      if (!files || !('length' in files) || files.length === 0) return;

      const newAttachments: ChatAttachmentInputState[] = [];
      let invalidCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = (files as FileList)[i] ?? (files as File[])[i];
        if (!file) continue;

        if (attachments.length + newAttachments.length >= maxAttachments) {
          showToast(`You can select a maximum of ${maxAttachments} files.`, {
            type: 'error',
            position: 'conversation',
          });
          break;
        }

        if (!isValidFileType(file)) {
          invalidCount++;
          continue;
        }

        try {
          const storagePath = await uploadAttachmentToStorage(
            effectiveUserId,
            file,
          );
          const previewUrl = URL.createObjectURL(file);
          newAttachments.push({
            file,
            previewUrl,
            type: file.type === 'application/pdf' ? 'document' : 'image',
            storagePath,
          });
        } catch (err) {
          console.error('Error uploading file to Supabase', err);
          showToast('Failed to upload file. Please try again.', {
            type: 'error',
            position: 'conversation',
          });
        }
      }

      if (newAttachments.length > 0) {
        const updated = [...attachments, ...newAttachments];
        setAttachments(updated);
        onAttachmentsChange(updated);
      }

      if (invalidCount > 0) {
        showToast('Error uploading file. Only PDF and images are supported.', {
          type: 'error',
          position: 'conversation',
        });
      }
    };

    const handleFileSelection = async (
      event: React.ChangeEvent<HTMLInputElement>,
    ) => {
      const files = event.target.files;
      await processFiles(files);
      setShowAttachMenu(false);
      if (event.target) event.target.value = '';
    };

    const handleDocumentAttachment = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'application/pdf';
      input.onchange = (e) =>
        handleFileSelection(
          e as unknown as React.ChangeEvent<HTMLInputElement>,
        );
      input.click();
    };

    const handleImageAttachment = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'image/*';
      input.onchange = (e) =>
        handleFileSelection(
          e as unknown as React.ChangeEvent<HTMLInputElement>,
        );
      input.click();
    };

    const removeAttachment = (indexToRemove: number) => {
      const attachmentToRemove = attachments[indexToRemove];
      if (attachmentToRemove?.previewUrl) {
        URL.revokeObjectURL(attachmentToRemove.previewUrl);
      }

      const newAttachments = attachments.filter(
        (_, index) => index !== indexToRemove,
      );
      setAttachments(newAttachments);
      onAttachmentsChange(newAttachments);

      if (newAttachments.length === 0 && messageValue === '') {
        resetInputHeightState();
      }
    };

    const toggleAttachMenu = () => {
      if (isIosDevice) {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'application/pdf,image/*';
        input.onchange = (e) =>
          handleFileSelection(
            e as unknown as React.ChangeEvent<HTMLInputElement>,
          );
        input.click();
      } else {
        setShowAttachMenu((prev) => !prev);
      }
    };

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (
          menuRef.current &&
          !menuRef.current.contains(event.target as Node) &&
          attachButtonRef.current &&
          !attachButtonRef.current.contains(event.target as Node)
        ) {
          setShowAttachMenu(false);
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }, []);

    useImperativeHandle(ref, () => ({
      clear: internalClearAttachments,
      removeAttachment,
      processPastedFiles: (files: File[]) => {
        void processFiles(files);
      },
    }));

    return (
      <div className="relative w-full">
        <div className="flex items-end w-full ">
          <div className="flex items-center">
            <div className="relative">
              <button
                ref={attachButtonRef}
                type="button"
                onClick={toggleAttachMenu}
                className="p-2.5 text-primary/70 hover:text-primary focus:outline-none transition-colors cursor-pointer"
                title="Add files and photos"
              >
                <CgAttachment size={20} />
              </button>
              {!isIosDevice && showAttachMenu && (
                <AttachmentMenuComponent
                  menuRef={menuRef}
                  handleDocumentAttachment={handleDocumentAttachment}
                  handleImageAttachment={handleImageAttachment}
                />
              )}
            </div>
          </div>
          {children}
        </div>
      </div>
    );
  },
);

AttachmentInputArea.displayName = 'AttachmentInputArea';
