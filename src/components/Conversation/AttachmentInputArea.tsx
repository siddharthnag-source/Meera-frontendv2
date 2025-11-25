'use client';

import { useToast } from '@/components/ui/ToastProvider';
import { isIOS } from '@/lib/deviceInfo';
import { supabase } from '@/lib/supabaseClient';
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

// Public bucket name for Supabase Storage
const STORAGE_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || 'attachments';

interface AttachmentInputAreaProps {
  maxAttachments?: number;
  onAttachmentsChange: (attachments: ChatAttachmentInputState[]) => void;
  onClearRequest?: () => void;
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
      onClearRequest,
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
    const attachmentsForCleanupRef =
      useRef<ChatAttachmentInputState[]>(attachments);

    useEffect(() => {
      setIsIosDevice(isIOS());
    }, []);

    // Sync attachments when parent changes them externally
    useEffect(() => {
      if (existingAttachments) {
        setAttachments(existingAttachments);
      }
    }, [existingAttachments]);

    useEffect(() => {
      attachmentsForCleanupRef.current = attachments;
    }, [attachments]);

    // Clean up object URLs on unmount
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
      setAttachments([]);
      onAttachmentsChange([]);
      if (messageValue === '') {
        resetInputHeightState();
      }
    };

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
          console.error('Supabase upload error', error);
          showToast('Failed to upload file. Please try again.', {
            type: 'error',
            position: 'conversation',
          });
          return null;
        }

        // storagePath = bucket + "/" + objectKey, used by edge function
        return `${STORAGE_BUCKET}/${objectKey}`;
      } catch (err) {
        console.error('Unexpected upload error', err);
        showToast('Failed to upload file. Please try again.', {
          type: 'error',
          position: 'conversation',
        });
        return null;
      }
    };

    const processFiles = async (files: FileList | File[] | null) => {
      if (!files || !('length' in files) || files.length === 0) return;

      const fileArray = Array.from(files);
      const newAttachments: ChatAttachmentInputState[] = [];
      let invalidCount = 0;

      for (const file of fileArray) {
        if (attachments.length + newAttachments.length >= maxAttachments) {
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
          // upload failed, skip this file
          continue;
        }

        newAttachments.push({
          file,
          previewUrl: URL.createObjectURL(file),
          type:
            file.type === 'application/pdf' ? 'document' : 'image',
          storagePath,
        });
      }

      if (newAttachments.length > 0) {
        const updatedAttachments = [...attachments, ...newAttachments];
        setAttachments(updatedAttachments);
        onAttachmentsChange(updatedAttachments);
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
      const { files } = event.target;
      await processFiles(files);
      setShowAttachMenu(false);
      if (event.target) {
        event.target.value = '';
      }
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
        // Fire and forget; upload + state update handled inside
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
