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

const MAX_ATTACHMENTS_DEFAULT = 10;
const MAX_FILE_SIZE_MB = 25;

interface AttachmentInputAreaProps {
  maxAttachments?: number;
  onAttachmentsChange: (attachments: ChatAttachmentInputState[]) => void;
  messageValue: string;
  resetInputHeightState: () => void;
  children: React.ReactNode;
  existingAttachments?: ChatAttachmentInputState[];
}

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
      messageValue,
      resetInputHeightState,
      children,
      existingAttachments,
    },
    ref,
  ) => {
    const [attachments, setAttachments] = useState<ChatAttachmentInputState[]>(
      existingAttachments || [],
    );
    const [showAttachMenu, setShowAttachMenu] = useState(false);
    const [isIosDevice, setIsIosDevice] = useState(false);

    const { showToast } = useToast();
    const menuRef = useRef<HTMLDivElement>(null);
    const attachButtonRef = useRef<HTMLButtonElement>(null);
    const attachmentsForCleanupRef = useRef<ChatAttachmentInputState[]>(attachments);

    useEffect(() => {
      setIsIosDevice(isIOS());
    }, []);

    // Keep internal state in sync if parent passes in attachments
    useEffect(() => {
      if (existingAttachments) {
        setAttachments(existingAttachments);
      }
    }, [existingAttachments]);

    useEffect(() => {
      attachmentsForCleanupRef.current = attachments;
    }, [attachments]);

    // Cleanup any object URLs on unmount
    useEffect(() => {
      return () => {
        attachmentsForCleanupRef.current.forEach((att) => {
          if (att.previewUrl) {
            URL.revokeObjectURL(att.previewUrl);
          }
        });
      };
    }, []);

    const internalClearAttachments = () => {
      attachments.forEach((att) => {
        if (att.previewUrl) {
          URL.revokeObjectURL(att.previewUrl);
        }
      });

      setAttachments([]);
      onAttachmentsChange([]);

      if (messageValue === '') {
        resetInputHeightState();
      }
    };

    const processFiles = (filesInput: FileList | File[] | null | undefined) => {
      if (!filesInput) return;

      const files = filesInput instanceof FileList ? Array.from(filesInput) : filesInput;

      const newAttachments: ChatAttachmentInputState[] = [];
      let rejectedCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (attachments.length + newAttachments.length >= maxAttachments) {
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

        newAttachments.push({
          file,
          previewUrl: URL.createObjectURL(file),
          type,
        });
      }

      if (newAttachments.length > 0) {
        const updatedAttachments = [...attachments, ...newAttachments];
        setAttachments(updatedAttachments);
        onAttachmentsChange(updatedAttachments);
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
    };

    const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
      processFiles(event.target.files);
      setShowAttachMenu(false);
      if (event.target) {
        event.target.value = '';
      }
    };

    const handleDocumentAttachment = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.onchange = (e) =>
        handleFileSelection(
          e as unknown as React.ChangeEvent<HTMLInputElement>,
        );
      input.click();
    };

    const handleImageAttachment = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
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
        processFiles(files);
      },
    }));

    return (
      <div className="relative w-full">
        <div className="flex items-end w-full">
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
