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
const STORAGE_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || 'attachments';

interface AttachmentInputAreaProps {
  maxAttachments?: number;
  onAttachmentsChange: (attachments: ChatAttachmentInputState[]) => void;
  messageValue: string; // for resetInputHeightState logic
  resetInputHeightState: () => void;
  children: React.ReactNode;
  existingAttachments?: ChatAttachmentInputState[];
}

// Imperative API used by Conversation
export interface AttachmentInputAreaRef {
  clear: () => void;
  removeAttachment: (index: number) => void;
  processPastedFiles: (files: File[]) => void;
}

// Helper: make a unique path for Supabase Storage
const buildStoragePath = (file: File) => {
  const ext = file.name.split('.').pop() || 'bin';
  const rand = Math.random().toString(36).slice(2);
  return `${Date.now()}-${rand}.${ext}`;
};

// Helper: upload a single file to Supabase Storage
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
      console.error('Supabase upload error', error);
      return null;
    }

    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);

    return {
      storagePath: path,
      publicUrl: data.publicUrl,
    };
  } catch (err) {
    console.error('Unexpected Supabase upload error', err);
    return null;
  }
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
    const attachmentsForCleanupRef =
      useRef<ChatAttachmentInputState[]>(attachments);

    useEffect(() => {
      setIsIosDevice(isIOS());
    }, []);

    // Keep local state in sync if parent provides attachments
    useEffect(() => {
      if (existingAttachments) {
        setAttachments(existingAttachments);
      }
    }, [existingAttachments]);

    useEffect(() => {
      attachmentsForCleanupRef.current = attachments;
    }, [attachments]);

    // Cleanup object URLs on unmount
    useEffect(() => {
      return () => {
        attachmentsForCleanupRef.current.forEach((att) => {
          if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
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
      return file.type.startsWith('image/') || file.type === 'application/pdf';
    };

    // Core handler: validate + upload to Supabase + update state
    const processFiles = async (files: FileList | null) => {
      if (!files?.length) return;

      const newAttachments: ChatAttachmentInputState[] = [];
      let invalidCount = 0;
      let uploadFailedCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

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

        const uploadResult = await uploadFileToStorage(file);
        if (!uploadResult) {
          uploadFailedCount++;
          continue;
        }

        newAttachments.push({
          file,
          previewUrl: URL.createObjectURL(file),
          type: file.type === 'application/pdf' ? 'document' : 'image',
          storagePath: uploadResult.storagePath,
          publicUrl: uploadResult.publicUrl,
        });
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

      if (uploadFailedCount > 0) {
        showToast('Failed to upload some files. Please try again.', {
          type: 'error',
          position: 'conversation',
        });
      }
    };

    const handleFileSelection = (
      event: React.ChangeEvent<HTMLInputElement>,
    ) => {
      void processFiles(event.target.files);
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

      const updated = attachments.filter((_, idx) => idx !== indexToRemove);
      setAttachments(updated);
      onAttachmentsChange(updated);

      if (updated.length === 0 && messageValue === '') {
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

    // Expose helpers to parent via ref
    useImperativeHandle(ref, () => ({
      clear: internalClearAttachments,
      removeAttachment,
      processPastedFiles: (files: File[]) => {
        const fileList = {
          length: files.length,
          item: (i: number) => files[i] ?? null,
          ...files,
        } as unknown as FileList;
        void processFiles(fileList);
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
